// Package limit adapts the number of requests the edge works on at once to how fast it is
// actually answering them: a gradient limiter in the style of Netflix's concurrency-limits.
//
// A fixed cap is wrong in both directions: too high and a slow dependency lets the queue (and
// latency) grow until every request times out and the SDK retries into the pile; too low and
// capacity is wasted. Here the cap shrinks when recent latency rises above its long-run level
// and grows back while latency is steady, so overload turns into cheap early rejections.
package limit

import (
	"math"
	"sync"
	"sync/atomic"
	"time"
)

type Limiter struct {
	inflight atomic.Int64
	limit    atomic.Uint64 // float64 bits, read on every request

	mu         sync.Mutex
	f, min, mx float64
	short      float64 // fast EWMA of request time, seconds (about 10 samples)
	long       float64 // slow EWMA, the "unloaded" level (about 500 samples)
}

func New(initial, min, max int) *Limiter {
	l := &Limiter{f: float64(initial), min: float64(min), mx: float64(max)}
	l.limit.Store(math.Float64bits(l.f))
	return l
}

// Limit is the current cap, for the metrics gauge.
func (l *Limiter) Limit() float64 { return math.Float64frombits(l.limit.Load()) }

// Acquire admits a request or refuses it. The returned func must be called when the request
// ends; its duration feeds the limit.
func (l *Limiter) Acquire() (done func(), ok bool) {
	if float64(l.inflight.Add(1)) > l.Limit() {
		l.inflight.Add(-1)
		return nil, false
	}
	start := time.Now()
	return func() {
		l.inflight.Add(-1)
		l.observe(time.Since(start).Seconds())
	}, true
}

func (l *Limiter) observe(rtt float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.short == 0 {
		l.short, l.long = rtt, rtt
	}
	l.short += (rtt - l.short) * 0.1
	l.long += (rtt - l.long) * 0.002
	// Judge the limit only while it is being used; an idle edge says nothing about capacity.
	if float64(l.inflight.Load()) < l.f/2 {
		return
	}
	// gradient 1 = steady; below 1 = recent requests are slower than normal (tolerance 2x).
	g := math.Max(0.5, math.Min(1, 2*l.long/l.short))
	next := l.f*g + math.Sqrt(l.f) // sqrt(limit) is the queue allowance that lets it probe upward
	l.f = math.Max(l.min, math.Min(l.mx, l.f*0.8+next*0.2))
	l.limit.Store(math.Float64bits(l.f))
}
