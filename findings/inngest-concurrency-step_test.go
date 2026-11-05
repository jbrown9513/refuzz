// inngest/inngest at 3a3588a. Copy to pkg/inngest/, then run:
//   go test ./pkg/inngest -run '^TestRefuzzConcurrencyNumericBackfillsStep$'

package inngest

import (
"testing"

"github.com/stretchr/testify/require"
)

func TestRefuzzConcurrencyNumericBackfillsStep(t *testing.T) {
c := &ConcurrencyLimits{}
err := c.UnmarshalJSON([]byte("5"))
require.NoError(t, err)
require.Equal(t, c.Limits, c.Step)
}
