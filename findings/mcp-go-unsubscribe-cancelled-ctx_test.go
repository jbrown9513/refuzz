// modelcontextprotocol/go-sdk at fa799c5. Copy to mcp/, then run:
//   go test ./mcp -run TestReproUnsubscribeCancelledCtx

package mcp

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestReproUnsubscribeCancelledCtx(t *testing.T) {
	var mu sync.Mutex
	var calls int
	var ctxErr error
	cs, ss, cleanup := basicClientServerConnection(t, nil, nil, func(s *Server) {
		s.opts.SubscribeHandler = func(context.Context, *SubscribeRequest) error { return nil }
		s.opts.UnsubscribeHandler = func(ctx context.Context, _ *UnsubscribeRequest) error {
			mu.Lock(); defer mu.Unlock()
			calls++
			ctxErr = ctx.Err()
			return ctx.Err() // a handler doing ctx-aware cleanup (a DB call) fails like this
		}
		s.AddResource(&Resource{Name: "r", URI: "file:///r"}, nil)
	})
	defer cleanup()
	_ = ss
	lctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- cs.subscriptionsListen(lctx, &SubscriptionsListenParams{Notifications: &NotificationSubscriptions{ResourceSubscriptions: []string{"file:///r"}}})
	}()
	time.Sleep(200 * time.Millisecond)
	cancel()
	<-done
	time.Sleep(300 * time.Millisecond)
	srv := ss.server
	srv.mu.Lock()
	left := len(srv.resourceSubscriptions["file:///r"])
	srv.mu.Unlock()
	mu.Lock()
	t.Logf("unsubscribe calls=%d ctx.Err in handler=%v; sessions still subscribed to file:///r = %d", calls, ctxErr, left)
	mu.Unlock()
}
