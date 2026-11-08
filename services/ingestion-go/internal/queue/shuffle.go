package queue

import (
	"hash/fnv"
	"strings"
	"sync"

	"github.com/segmentio/kafka-go"
)

// Shuffle is shuffle sharding for Kafka partitions (AWS Builders' Library). Each site is given a
// stable subset of K partitions, chosen by highest-random-weight hashing, and its events are
// spread over just those. A site that floods the topic can then back up only its own K
// partitions; another site shares on average K*K/N of them instead of all of them, and the
// chance two sites share every partition is 1/C(N,K).
//
// Within a site the partition still depends only on the message key (site:session), so one
// session's events stay ordered on one partition. The subset for a site changes only if the
// partition count changes (highest-random-weight moves the fewest sites).
type Shuffle struct {
	K int

	mu    sync.Mutex
	cache map[string][]int // site -> subset, valid for a partition count of len(subset's source)
	n     int
}

// Balance implements kafka.Balancer.
func (s *Shuffle) Balance(msg kafka.Message, partitions ...int) int {
	key := string(msg.Key)
	site, _, _ := strings.Cut(key, ":")
	subset := s.subset(site, partitions)
	h := fnv.New32a()
	_, _ = h.Write(msg.Key)
	return subset[int(h.Sum32()%uint32(len(subset)))]
}

func (s *Shuffle) subset(site string, partitions []int) []int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache == nil || s.n != len(partitions) {
		s.cache, s.n = map[string][]int{}, len(partitions)
	}
	if sub, ok := s.cache[site]; ok {
		return sub
	}
	k := min(s.K, len(partitions))
	type scored struct {
		p int
		w uint64
	}
	top := make([]scored, 0, k+1)
	for _, p := range partitions {
		h := fnv.New64a()
		_, _ = h.Write([]byte(site))
		_, _ = h.Write([]byte{0, byte(p), byte(p >> 8), byte(p >> 16), byte(p >> 24)})
		w := h.Sum64()
		// insertion into a descending list of at most k entries
		i := len(top)
		for i > 0 && top[i-1].w < w {
			i--
		}
		if i < k {
			top = append(top, scored{})
			copy(top[i+1:], top[i:])
			top[i] = scored{p, w}
			if len(top) > k {
				top = top[:k]
			}
		}
	}
	sub := make([]int, len(top))
	for i, t := range top {
		sub[i] = t.p
	}
	if len(s.cache) > 100_000 {
		clear(s.cache)
	}
	s.cache[site] = sub
	return sub
}
