package limit

import "testing"

func TestRefusesBeyondTheLimitAndFreesSlotsAsRequestsEnd(t *testing.T) {
	l := New(2, 1, 100)
	done1, ok1 := l.Acquire()
	_, ok2 := l.Acquire()
	if !ok1 || !ok2 {
		t.Fatal("the first two requests fit")
	}
	if _, ok := l.Acquire(); ok {
		t.Fatal("a third in-flight request must be refused immediately")
	}
	done1()
	if _, ok := l.Acquire(); !ok {
		t.Fatal("a finished request must free its slot")
	}
}

// hold keeps n requests in flight, which is what makes the limiter treat itself as "in use".
func hold(t *testing.T, l *Limiter, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if _, ok := l.Acquire(); !ok {
			t.Fatalf("could not hold slot %d", i)
		}
	}
}

func TestLimitShrinksWhenRequestsGetSlowerThanUsual(t *testing.T) {
	l := New(100, 10, 1000)
	hold(t, l, 100) // fully busy, so the limiter judges itself even after it has grown
	for i := 0; i < 2000; i++ {
		l.observe(0.010) // steady 10 ms: establishes "normal"
	}
	steady := l.Limit()
	// A slower backend holds requests longer, so more of them are in flight at once (Little's law). That is what
	// brings the limiter back to judging: it ignores latency while far below its limit, because rejecting
	// nothing is the right answer there.
	hold(t, l, int(steady/2)+1-100)
	for i := 0; i < 200; i++ {
		l.observe(0.500) // suddenly 50x slower: the backend is struggling
	}
	if got := l.Limit(); got >= steady {
		t.Fatalf("limit %.0f did not shrink from %.0f when latency rose", got, steady)
	}
}

func TestLimitGrowsWhileLatencyIsSteadyAndTheLimitIsInUse(t *testing.T) {
	l := New(100, 10, 1000)
	hold(t, l, 80)
	before := l.Limit()
	for i := 0; i < 500; i++ {
		l.observe(0.010)
	}
	if got := l.Limit(); got <= before {
		t.Fatalf("limit %.0f should have probed upward from %.0f", got, before)
	}
}

func TestAnIdleLimiterDoesNotDriftUpward(t *testing.T) {
	l := New(100, 10, 1000)
	for i := 0; i < 5000; i++ {
		l.observe(0.010) // nothing in flight: says nothing about capacity
	}
	if got := l.Limit(); got != 100 {
		t.Fatalf("an idle limiter must keep its limit, got %.0f", got)
	}
}

func TestLimitStaysWithinItsBounds(t *testing.T) {
	l := New(50, 20, 60)
	hold(t, l, 40)
	for i := 0; i < 5000; i++ {
		l.observe(0.001)
	}
	if got := l.Limit(); got > 60 {
		t.Fatalf("limit %.0f exceeded the maximum 60", got)
	}
	for i := 0; i < 5000; i++ {
		l.observe(1.0)
	}
	if got := l.Limit(); got < 20 {
		t.Fatalf("limit %.0f fell below the minimum 20", got)
	}
}
