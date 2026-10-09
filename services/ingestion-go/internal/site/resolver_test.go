package site

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newTestResolver(load loadFunc) (*Resolver, *clock) {
	c := &clock{t: time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)}
	return newResolver(load, c.now), c
}

func found(id string) loadFunc {
	return func(context.Context, string) (ResolvedSite, error) {
		return ResolvedSite{ID: id, WorkspaceID: "ws"}, nil
	}
}

func TestHitIsServedFromCacheUntilTTL(t *testing.T) {
	var loads atomic.Int32
	r, clk := newTestResolver(func(ctx context.Context, h string) (ResolvedSite, error) {
		loads.Add(1)
		return ResolvedSite{ID: "s1"}, nil
	})

	for i := 0; i < 5; i++ {
		if _, err := r.Resolve(context.Background(), "key"); err != nil {
			t.Fatal(err)
		}
	}
	if loads.Load() != 1 {
		t.Fatalf("loads = %d, want 1", loads.Load())
	}

	clk.advance(cacheTTL + time.Second)
	if _, err := r.Resolve(context.Background(), "key"); err != nil {
		t.Fatal(err)
	}
	if loads.Load() != 2 {
		t.Fatalf("loads after expiry = %d, want 2", loads.Load())
	}
}

func TestUnknownKeyIsRememberedSoJunkDoesNotReachTheDatabase(t *testing.T) {
	var loads atomic.Int32
	r, clk := newTestResolver(func(context.Context, string) (ResolvedSite, error) {
		loads.Add(1)
		return ResolvedSite{}, ErrNotFound
	})

	for i := 0; i < 50; i++ {
		if _, err := r.Resolve(context.Background(), "nope"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
	}
	if loads.Load() != 1 {
		t.Fatalf("loads = %d, want 1 for 50 lookups of the same unknown key", loads.Load())
	}

	clk.advance(negativeTTL + time.Second)
	_, _ = r.Resolve(context.Background(), "nope")
	if loads.Load() != 2 {
		t.Fatalf("a remembered miss must expire; loads = %d, want 2", loads.Load())
	}
}

func TestInvalidationClearsARememberedMiss(t *testing.T) {
	exists := false
	r, _ := newTestResolver(func(context.Context, string) (ResolvedSite, error) {
		if exists {
			return ResolvedSite{ID: "new"}, nil
		}
		return ResolvedSite{}, ErrNotFound
	})
	if _, err := r.Resolve(context.Background(), "key"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}

	exists = true // the site is created and the dashboard publishes site:invalidate
	r.InvalidateByHash(HashPublicKey("key"))

	got, err := r.Resolve(context.Background(), "key")
	if err != nil || got.ID != "new" {
		t.Fatalf("got %+v, %v; want the new site immediately after invalidation", got, err)
	}
}

func TestDatabaseErrorsAreNotCached(t *testing.T) {
	var loads atomic.Int32
	boom := errors.New("connection refused")
	r, _ := newTestResolver(func(context.Context, string) (ResolvedSite, error) {
		if loads.Add(1) == 1 {
			return ResolvedSite{}, boom
		}
		return ResolvedSite{ID: "s1"}, nil
	})

	if _, err := r.Resolve(context.Background(), "key"); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the database error", err)
	}
	if got, err := r.Resolve(context.Background(), "key"); err != nil || got.ID != "s1" {
		t.Fatalf("a transient failure must not poison the key: %+v, %v", got, err)
	}
}

func TestConcurrentLookupsShareOneQuery(t *testing.T) {
	var loads atomic.Int32
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	r, _ := newTestResolver(func(context.Context, string) (ResolvedSite, error) {
		loads.Add(1)
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
		return ResolvedSite{ID: "s1"}, nil
	})

	const callers = 100
	var wg sync.WaitGroup
	results := make([]string, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got, err := r.Resolve(context.Background(), "key")
			if err == nil {
				results[i] = got.ID
			}
		}(i)
	}
	<-started
	time.Sleep(50 * time.Millisecond) // let the other callers queue behind the first
	close(release)
	wg.Wait()

	if loads.Load() != 1 {
		t.Fatalf("loads = %d, want 1 shared query for %d callers", loads.Load(), callers)
	}
	for i, id := range results {
		if id != "s1" {
			t.Fatalf("caller %d got %q", i, id)
		}
	}
}

func TestACallerGivingUpDoesNotFailTheOthers(t *testing.T) {
	release := make(chan struct{})
	r, _ := newTestResolver(func(context.Context, string) (ResolvedSite, error) {
		<-release
		return ResolvedSite{ID: "s1"}, nil
	})

	impatient, cancel := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		_, err := r.Resolve(impatient, "key")
		firstDone <- err
	}()
	time.Sleep(20 * time.Millisecond)

	patient := make(chan *ResolvedSite, 1)
	go func() {
		got, _ := r.Resolve(context.Background(), "key")
		patient <- got
	}()
	time.Sleep(20 * time.Millisecond)

	cancel()
	if err := <-firstDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("impatient caller err = %v, want context.Canceled", err)
	}
	close(release)
	if got := <-patient; got == nil || got.ID != "s1" {
		t.Fatalf("patient caller got %+v; the shared lookup must survive one caller leaving", got)
	}
}

func TestJunkKeysCannotEvictRealSites(t *testing.T) {
	r, _ := newTestResolver(func(_ context.Context, h string) (ResolvedSite, error) {
		if h == HashPublicKey("real") {
			return ResolvedSite{ID: "real"}, nil
		}
		return ResolvedSite{}, ErrNotFound
	})
	var loads atomic.Int32
	counted := r.load
	r.load = func(ctx context.Context, h string) (ResolvedSite, error) {
		loads.Add(1)
		return counted(ctx, h)
	}

	if _, err := r.Resolve(context.Background(), "real"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < negativeMax*2+10; i++ {
		_, _ = r.Resolve(context.Background(), fmt.Sprintf("junk-%d", i))
	}
	before := loads.Load()
	if _, err := r.Resolve(context.Background(), "real"); err != nil {
		t.Fatal(err)
	}
	if loads.Load() != before {
		t.Fatal("a real site was evicted by a flood of unknown keys")
	}
	r.mu.Lock()
	size := len(r.missing)
	r.mu.Unlock()
	if size > negativeMax {
		t.Fatalf("negative cache grew to %d, cap is %d", size, negativeMax)
	}
}
