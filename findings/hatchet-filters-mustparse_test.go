// hatchet-dev/hatchet at b0dd2fb. Copy to sdks/go/features/, then run:
//   go test ./sdks/go/features -run '^TestFiltersUpdateEmptyIDRefuzz97245e4145$'

package features

import (
	"context"
	"testing"

	"github.com/hatchet-dev/hatchet/pkg/client/rest"
)

func TestFiltersUpdateEmptyIDRefuzz97245e4145(t *testing.T) {
	api, err := rest.NewClientWithResponses("http://example.com")
	if err != nil {
		t.Fatalf("failed to create rest client: %v", err)
	}

	c := NewFiltersClient(api, "00000000-0000-0000-0000-000000000000")

	_, err = c.Update(context.Background(), "", rest.V1FilterUpdateJSONRequestBody{})
	if err == nil {
		t.Fatalf("expected error for empty filterID, got nil")
	}
}
