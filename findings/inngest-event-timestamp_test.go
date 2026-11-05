// inngest/inngest at 3a3588a. Copy to pkg/event/, then run:
//   go test ./pkg/event -run '^TestNormalizeInboundRejectsOutOfRangeTimestamp$'

package event

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNormalizeInboundRejectsOutOfRangeTimestamp(t *testing.T) {
	r := require.New(t)
	raw := []byte(`{"name":"0","ts":3616724959280246832}`)
	evt, err := NewEvent(raw)
	r.NoError(err)
	r.NotNil(evt)
	_, err = NormalizeInbound(context.Background(), evt, time.Now())
	r.Error(err)
}
