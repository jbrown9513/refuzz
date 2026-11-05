// dapr/dapr at c10b835. Copy to pkg/actors/api/, then run:
//   go test ./pkg/actors/api -run '^TestCreateTimerRequestUnmarshalJSONNullRefuzzF66D6B4BA9$'

package api

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCreateTimerRequestUnmarshalJSONNullRefuzzF66D6B4BA9(t *testing.T) {
	var req CreateTimerRequest
	_ = req.UnmarshalJSON([]byte("null"))
	assert.NotNil(t, &req)
}
