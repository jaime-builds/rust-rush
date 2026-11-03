package netutil

import (
	"sync"
	"time"
)

// WindowLimiter counts events per key (a visitor IP) inside a sliding time
// window, e.g. "10 failed logins per 15 minutes". Safe for concurrent use.
// Old entries are pruned on every call, so the map can't grow without bound.
type WindowLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	events map[string][]time.Time
	Now    func() time.Time // clock; tests move it
}

// NewWindowLimiter allows max events per key per window.
func NewWindowLimiter(max int, window time.Duration) *WindowLimiter {
	return &WindowLimiter{max: max, window: window, events: make(map[string][]time.Time), Now: time.Now}
}

func (l *WindowLimiter) pruneLocked(now time.Time) {
	cutoff := now.Add(-l.window)
	for key, times := range l.events {
		kept := times[:0]
		for _, t := range times {
			if t.After(cutoff) {
				kept = append(kept, t)
			}
		}
		if len(kept) == 0 {
			delete(l.events, key)
		} else {
			l.events[key] = kept
		}
	}
}

// Blocked reports whether key has used up its allowance.
func (l *WindowLimiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(l.Now())
	return len(l.events[key]) >= l.max
}

// Add records one event for key and returns the count inside the window.
func (l *WindowLimiter) Add(key string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	l.pruneLocked(now)
	l.events[key] = append(l.events[key], now)
	return len(l.events[key])
}

// Reset forgets key's events (a successful login clears its failures).
func (l *WindowLimiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.events, key)
}

// Window is the limiter's window, for Retry-After headers.
func (l *WindowLimiter) Window() time.Duration { return l.window }
