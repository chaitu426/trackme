package queue

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/trackme/ingestion-go/internal/enrich"
)

// ErrWALFull means the spill directory reached its byte budget; the caller then sheds as before.
var ErrWALFull = errors.New("wal is full")

const segmentMax = 8 << 20

// WAL is the overflow path of the async publisher: batches that Kafka cannot take right now are
// appended to disk and replayed oldest-first when it recovers, instead of being dropped (which
// also stranded their dedupe claims) or answered with 429.
//
// Layout: segment files of frames, each frame = 4-byte big-endian length + gzip(JSON array of
// events). Only the open segment is written; it is closed (and becomes replayable) when it
// reaches segmentMax or on Roll. A segment left open by a crash is simply a closed segment to
// the next process, which is how recovery works. Writes are not fsynced: a process crash loses
// nothing, a machine crash can lose the last few OS-buffered frames.
type WAL struct {
	dir      string
	maxBytes int64

	mu    sync.Mutex
	f     *os.File
	name  string
	size  int64
	total int64
}

// OpenWAL creates dir if needed and accounts for segments left by a previous run.
func OpenWAL(dir string, maxBytes int64) (*WAL, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	w := &WAL{dir: dir, maxBytes: maxBytes}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		// os.Stat, not the directory entry: on some systems (Windows) an entry's size is stale while another
		// handle still has the file open, which would under-count what a crashed process left behind.
		if info, err := os.Stat(filepath.Join(dir, e.Name())); err == nil && strings.HasSuffix(e.Name(), ".seg") {
			w.total += info.Size()
		}
	}
	return w, nil
}

// Bytes is the disk currently used by segments.
func (w *WAL) Bytes() int64 {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.total
}

// Append writes one frame. It never blocks on Kafka.
func (w *WAL) Append(events []enrich.EnrichedEvent) error {
	var payload bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&payload, gzip.BestSpeed)
	if err := json.NewEncoder(zw).Encode(events); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	frame := make([]byte, 4, 4+payload.Len())
	binary.BigEndian.PutUint32(frame, uint32(payload.Len()))
	frame = append(frame, payload.Bytes()...)

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.total+int64(len(frame)) > w.maxBytes {
		return ErrWALFull
	}
	if w.f == nil {
		w.name = fmt.Sprintf("wal-%020d.seg", time.Now().UnixNano())
		f, err := os.OpenFile(filepath.Join(w.dir, w.name), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return err
		}
		w.f, w.size = f, 0
	}
	n, err := w.f.Write(frame)
	w.size += int64(n)
	w.total += int64(n)
	if err != nil || w.size >= segmentMax {
		w.closeLocked()
	}
	return err
}

// Close releases the open segment. Call it on shutdown, after the publisher has drained into it.
func (w *WAL) Close() error {
	w.Roll()
	return nil
}

// Roll closes the open segment so small spills become replayable too.
func (w *WAL) Roll() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closeLocked()
}

func (w *WAL) closeLocked() {
	if w.f != nil {
		_ = w.f.Close()
		w.f = nil
	}
}

// Segments lists closed segments, oldest first.
func (w *WAL) Segments() []string {
	w.mu.Lock()
	open := w.name
	if w.f == nil {
		open = ""
	}
	w.mu.Unlock()
	names, _ := filepath.Glob(filepath.Join(w.dir, "*.seg"))
	sort.Strings(names)
	out := names[:0]
	for _, n := range names {
		if filepath.Base(n) != open {
			out = append(out, n)
		}
	}
	return out
}

// Frames decodes every frame of a closed segment. A torn final frame (crash mid-write) is ignored.
func (w *WAL) Frames(path string) ([][]enrich.EnrichedEvent, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var frames [][]enrich.EnrichedEvent
	for len(raw) >= 4 {
		n := int(binary.BigEndian.Uint32(raw))
		if len(raw) < 4+n {
			break
		}
		zr, err := gzip.NewReader(bytes.NewReader(raw[4 : 4+n]))
		if err != nil {
			break
		}
		var events []enrich.EnrichedEvent
		err = json.NewDecoder(zr).Decode(&events)
		_, _ = io.Copy(io.Discard, zr)
		if err != nil {
			break
		}
		frames = append(frames, events)
		raw = raw[4+n:]
	}
	return frames, nil
}

// Remove deletes a fully replayed segment and releases its bytes.
func (w *WAL) Remove(path string) {
	info, err := os.Stat(path)
	if err != nil || os.Remove(path) != nil {
		return
	}
	w.mu.Lock()
	w.total -= info.Size()
	w.mu.Unlock()
}
