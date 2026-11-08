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
	PublishQueueDepth    prometheus.Gauge
	PublishQueueOverflow prometheus.Counter
	PublishOutcomes      *prometheus.CounterVec
	PublishBatchSize     prometheus.Histogram
	AdmissionFailClosed  *prometheus.CounterVec
	EdgeStage            *prometheus.HistogramVec
	WALBytes             prometheus.Gauge
	Shed                 *prometheus.CounterVec
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
		PublishQueueDepth: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "edge_publish_queue_depth",
			Help: "Events waiting in the bounded in-process produce queue.",
		}),
		PublishQueueOverflow: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "edge_publish_queue_overflow_total",
			Help: "Batches shed with 429 because the produce queue was full.",
		}),
		PublishOutcomes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "edge_publish_outcomes_total",
			Help: "Background produce outcomes: published, retried, dropped.",
		}, []string{"outcome"}),
		PublishBatchSize: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "edge_publish_batch_size",
			Help:    "Events per background Kafka publish call.",
			Buckets: []float64{1, 50, 250, 500, 1000, 2500, 5000, 10000},
		}),
		AdmissionFailClosed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "edge_admission_fail_closed_total",
			Help: "Requests rejected with 503 because admission could not be verified.",
		}, []string{"stage"}),
		WALBytes: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "edge_wal_bytes",
			Help: "Bytes of events spilled to the local write-ahead log and not yet replayed to Kafka.",
		}),
		Shed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "edge_shed_total",
			Help: "Work refused or reduced to protect the edge, by reason (concurrency, sampled_web_vital).",
		}, []string{"reason"}),
		EdgeStage: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "edge_stage_duration_seconds",
			Help:    "Time spent in each phase of processing one accepted batch (validate, resolve, enrich, admit, publish, confirm).",
			Buckets: []float64{0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1},
		}, []string{"stage"}),
	}
	m.Registry.MustRegister(
		m.HTTPRequests,
		m.HTTPRequestsInFlight,
		m.EdgeEvents,
		m.RedisErrors,
		m.KafkaPublishDuration,
		m.KafkaPublishErrors,
		m.SiteCache,
		m.PublishQueueDepth,
		m.PublishQueueOverflow,
		m.PublishOutcomes,
		m.PublishBatchSize,
		m.AdmissionFailClosed,
		m.EdgeStage,
		m.WALBytes,
		m.Shed,
		prometheus.NewGoCollector(),
		prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
	)
	for _, outcome := range []string{"accepted", "rejected", "duplicate", "dropped_bot", "clamped"} {
		m.EdgeEvents.WithLabelValues(outcome)
	}
	for _, op := range []string{"ip", "gate", "dedupe"} {
		m.RedisErrors.WithLabelValues(op)
	}
	for _, outcome := range []string{"published", "retried", "dropped", "spilled", "replayed"} {
		m.PublishOutcomes.WithLabelValues(outcome)
	}
	for _, stage := range []string{"gate", "quota"} {
		m.AdmissionFailClosed.WithLabelValues(stage)
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
