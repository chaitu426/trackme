package main

import (
	"fmt"
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	proxyRegistry = prometheus.NewRegistry()
	proxyRequests = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request duration in seconds.",
		Buckets: []float64{0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1},
	}, []string{"route", "status_class"})
	proxyRequestsInFlight = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "http_requests_in_flight",
		Help: "Current number of HTTP requests being processed.",
	})
)

func init() {
	proxyRegistry.MustRegister(
		proxyRequests,
		proxyRequestsInFlight,
		prometheus.NewGoCollector(),
		prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
	)
}

func metricsHandler() http.Handler {
	return promhttp.HandlerFor(proxyRegistry, promhttp.HandlerOpts{})
}

func proxyRouteLabel(method, path string) string {
	switch method + " " + path {
	case "GET /health", "GET /metrics", "POST /v1/batch", "OPTIONS /v1/batch":
		return method + " " + path
	default:
		return "other"
	}
}

func observeProxyRequest(route string, status int, seconds float64) {
	proxyRequests.WithLabelValues(route, fmt.Sprintf("%dxx", status/100)).Observe(seconds)
}
