// dapr/dapr at c10b835. Copy to pkg/expr/, then run:
//   go test ./pkg/expr -run '^TestRefuzzA0b81302c5$'

package expr_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/dapr/dapr/pkg/expr"
)

func TestRefuzzA0b81302c5(t *testing.T) {
	input := ".s" + "%s" + "8n"
	var e expr.Expr
	errCh := make(chan error, 1)
	go func() {
		errCh <- e.DecodeString(input)
	}()
	select {
	case err := <-errCh:
		require.Error(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("DecodeString did not return within timeout")
	}
}
