package netutil

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestClientIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/ws", nil)
	r.RemoteAddr = "172.22.0.5:51234"
	if got := ClientIP(r); got != "172.22.0.5" {
		t.Errorf("no header: ClientIP = %q, want the peer address", got)
	}
	r.Header.Set("CF-Connecting-IP", " 203.0.113.7 ")
	if got := ClientIP(r); got != "203.0.113.7" {
		t.Errorf("behind Cloudflare: ClientIP = %q, want 203.0.113.7", got)
	}
}

func TestTokenBucket(t *testing.T) {
	b := NewTokenBucket(10, 3)
	now := time.Now()
	for i := 0; i < 3; i++ {
		if !b.Allow(now) {
			t.Fatalf("burst token %d refused", i+1)
		}
	}
	if b.Allow(now) {
		t.Fatal("allowed past the burst")
	}
	if !b.Allow(now.Add(100 * time.Millisecond)) {
		t.Error("no token after 100 ms at 10/s")
	}
	if b.Allow(now.Add(100 * time.Millisecond)) {
		t.Error("two tokens from one refill")
	}
	// A long idle refills only to the burst, not beyond.
	later := now.Add(time.Hour)
	n := 0
	for b.Allow(later) {
		n++
	}
	if n != 3 {
		t.Errorf("after an hour idle allowed %d, want burst 3", n)
	}
}
