// Package netutil holds small request helpers shared by the WebSocket and
// admin handlers: the visitor IP behind Cloudflare, and a token bucket.
package netutil

import (
	"net"
	"net/http"
	"strings"
	"time"
)

// ClientIP returns the visitor's IP. Behind the Cloudflare Tunnel every
// request arrives from cloudflared, so the real address is the
// CF-Connecting-IP header. Without it (local dev, the LAN port) the TCP peer
// address is used. On the LAN port a client can set the header itself; that
// only lets it pick which per-IP bucket it lands in, never raise a limit.
func ClientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// TokenBucket allows a sustained rate with a burst. Not safe for concurrent
// use: each WebSocket client owns its buckets and touches them only from its
// read goroutine.
type TokenBucket struct {
	rate   float64 // tokens per second
	burst  float64
	tokens float64
	last   time.Time
}

// NewTokenBucket starts full.
func NewTokenBucket(rate, burst float64) *TokenBucket {
	return &TokenBucket{rate: rate, burst: burst, tokens: burst}
}

// Allow spends one token at time now, refilling first.
func (b *TokenBucket) Allow(now time.Time) bool {
	if !b.last.IsZero() {
		b.tokens += now.Sub(b.last).Seconds() * b.rate
		if b.tokens > b.burst {
			b.tokens = b.burst
		}
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
