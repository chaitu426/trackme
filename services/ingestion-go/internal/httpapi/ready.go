package httpapi

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// ReadyCheck is one dependency the service cannot work without.
type ReadyCheck struct {
	Name  string
	Check func(ctx context.Context) error
}

const (
	readyTimeout = 2 * time.Second
	// A load balancer probes often and several instances may share a dependency.
	// Results are reused for a few seconds so probes do not become load of their own.
	readyCacheTTL = 3 * time.Second
)

type readyState struct {
	mu      sync.Mutex
	at      time.Time
	failing []string
}

// handleReady answers 200 only when every dependency responds. /health stays a plain
// liveness answer: restarting a healthy process because Postgres is down fixes nothing,
// but taking it out of rotation does.
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	failing := s.readyFailures(r.Context())
	if len(failing) > 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable", "failing": failing})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "ingestion-go"})
}

func (s *Server) readyFailures(ctx context.Context) []string {
	s.ready.mu.Lock()
	defer s.ready.mu.Unlock()
	if !s.ready.at.IsZero() && time.Since(s.ready.at) < readyCacheTTL {
		return s.ready.failing
	}

	ctx, cancel := context.WithTimeout(ctx, readyTimeout)
	defer cancel()

	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		down []string
	)
	for _, c := range s.ReadyChecks {
		wg.Add(1)
		go func(c ReadyCheck) {
			defer wg.Done()
			if err := c.Check(ctx); err != nil {
				s.warn("ready-"+c.Name, "readiness: %s unavailable: %v", c.Name, err)
				mu.Lock()
				down = append(down, c.Name)
				mu.Unlock()
			}
		}(c)
	}
	wg.Wait()

	s.ready.at = time.Now()
	s.ready.failing = down
	return down
}
