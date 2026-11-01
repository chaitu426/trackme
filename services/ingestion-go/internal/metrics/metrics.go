package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	Registry             *prometheus.Registry
	HTTPRequests         *prometheus.HistogramVec
	HTTPRequestsInFlight prometheus.Gauge
	EdgeEvents           *prometheus.CounterVec
	RedisErrors          *prometheus.CounterVec
	KafkaPublishDuration prometheus.Histogram
	KafkaPublishErrors   prometheus.Counter
	SiteCache            *prometheus.CounterVec
}

func New() *Metrics {
	m := &Metrics{
		Registry: prometheus.NewRegistry(),
		HTTPRequests: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request duration in seconds.",
			Buckets: []float64{0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1},
		}, []string{"route", "status_class"}),
		HTTPRequestsInFlight: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "http_requests_in_flight",
			Help: "Current number of HTTP requests being processed.",
		}),
		EdgeEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "edge_events_total",
			Help: "Tracker events classified by ingestion outcome.",
		}, []string{"outcome"}),
		RedisErrors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "edge_redis_errors_total",
			Help: "Redis operation errors on the ingestion path.",
		}, []string{"op"}),
		KafkaPublishDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "edge_kafka_publish_duration_seconds",
			Help:    "Kafka publish duration in seconds.",
			Buckets: []float64{0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1},
		}),
		KafkaPublishErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "edge_kafka_publish_errors_total",
			Help: "Kafka publish failures.",
		}),
		SiteCache: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "edge_site_cache_total",
			Help: "Site resolver cache lookups by result.",
		}, []string{"result"}),
	}
	m.Registry.MustRegister(
		m.HTTPRequests,
		m.HTTPRequestsInFlight,
		m.EdgeEvents,
		m.RedisErrors,
		m.KafkaPublishDuration,
		m.KafkaPublishErrors,
		m.SiteCache,
		prometheus.NewGoCollector(),
		prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
	)
	for _, outcome := range []string{"accepted", "rejected", "duplicate", "dropped_bot", "clamped"} {
		m.EdgeEvents.WithLabelValues(outcome)
	}
	for _, op := range []string{"gate", "dedupe"} {
		m.RedisErrors.WithLabelValues(op)
	}
	for _, result := range []string{"hit", "miss", "negative"} {
		m.SiteCache.WithLabelValues(result)
	}
	return m
}

var Default = New()

func Handler() http.Handler {
	return promhttp.HandlerFor(Default.Registry, promhttp.HandlerOpts{})
}
