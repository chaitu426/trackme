package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func probe(s *Server, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestReadyIsOKWhenEveryDependencyAnswers(t *testing.T) {
	s := &Server{ReadyChecks: []ReadyCheck{
		{Name: "postgres", Check: func(context.Context) error { return nil }},
		{Name: "redis", Check: func(context.Context) error { return nil }},
	}}
	if w := probe(s, "/ready"); w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestReadyNamesTheFailingDependencyWithoutLeakingTheError(t *testing.T) {
	s := &Server{ReadyChecks: []ReadyCheck{
		{Name: "postgres", Check: func(context.Context) error { return nil }},
		{Name: "kafka", Check: func(context.Context) error { return errors.New("dial tcp 10.0.0.7:9092: refused") }},
	}}
	w := probe(s, "/ready")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "kafka") || strings.Contains(body, "10.0.0.7") || strings.Contains(body, "postgres") {
		t.Fatalf("body = %s", body)
	}
}

func TestHealthStaysUpWhenADependencyIsDown(t *testing.T) {
	s := &Server{ReadyChecks: []ReadyCheck{{Name: "redis", Check: func(context.Context) error { return errors.New("down") }}}}
	if w := probe(s, "/health"); w.Code != http.StatusOK {
		t.Fatalf("liveness status = %d, want 200", w.Code)
	}
}

func TestReadyResultsAreReusedBetweenProbes(t *testing.T) {
	var calls atomic.Int32
	s := &Server{ReadyChecks: []ReadyCheck{{Name: "redis", Check: func(context.Context) error {
		calls.Add(1)
		return nil
	}}}}
	probe(s, "/ready")
	probe(s, "/ready")
	probe(s, "/ready")
	if calls.Load() != 1 {
		t.Fatalf("checks ran %d times, want 1", calls.Load())
	}
}

func TestMetricsRouteCanBeRemovedFromThePublicPort(t *testing.T) {
	s := &Server{HideMetrics: true}
	if w := probe(s, "/metrics"); w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when metrics are served elsewhere", w.Code)
	}
}
