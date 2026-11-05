// temporalio/temporal at 36c879e. Copy to service/frontend/, then run:
//   go test ./service/frontend -run '^TestRefuzzUnexpiredRuleIsKept$'

package frontend

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	rulespb "go.temporal.io/api/rules/v1"
	"go.temporal.io/server/common/clock"
	"go.temporal.io/server/common/log"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRefuzzUnexpiredRuleIsKept(t *testing.T) {
	handler := &namespaceHandler{timeSource: clock.NewRealTimeSource(), logger: log.NewNoopLogger()}
	rules := map[string]*rulespb.WorkflowRule{
		"rule 1": {Spec: &rulespb.WorkflowRuleSpec{Id: "rule 1", ExpirationTime: timestamppb.New(time.Now().Add(24 * time.Hour))}},
	}
	handler.removeOldestExpiredWorkflowRule("ns", rules)
	require.Len(t, rules, 1)
}
