// modelcontextprotocol/go-sdk at fa799c5. Copy to auth/extauth/, then run:
//   go test ./auth/extauth -run '^TestEnterpriseAuthorizeRefuzzB7bbc98ae2$'

package extauth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/oauthex"
	"golang.org/x/oauth2"
)

func TestEnterpriseAuthorizeRefuzzB7bbc98ae2(t *testing.T) {
	idpIssuer := "https://idp.example"
	mcpIssuer := "https://mcp.example"

	handler, err := NewEnterpriseHandler(&EnterpriseHandlerConfig{
		HTTPClient: &http.Client{
			Transport: &refuzzB7bbc98ae2Transport{
				idpIssuer: idpIssuer,
				mcpIssuer: mcpIssuer,
			},
		},
		IDTokenFetcher: func(context.Context) (*oauth2.Token, error) {
			return (&oauth2.Token{}).WithExtra(map[string]interface{}{
				"id_token": "fuzz-id-token",
			}), nil
		},
		IdPIssuerURL:     idpIssuer,
		MCPAuthServerURL: mcpIssuer,
		MCPResourceURI:   mcpIssuer + "/resource",
		IdPCredentials:   &oauthex.ClientCredentials{ClientID: "fuzz-idp-client"},
		MCPCredentials:   &oauthex.ClientCredentials{ClientID: "fuzz-mcp-client"},
	})
	if err != nil {
		t.Fatalf("NewEnterpriseHandler() error: %v", err)
	}

	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		mcpIssuer+"/resource",
		nil,
	)
	if err != nil {
		t.Fatalf("NewRequestWithContext() error: %v", err)
	}

	resp := &http.Response{
		StatusCode: http.StatusUnauthorized,
		Body:       io.NopCloser(strings.NewReader("")),
		Header:     make(http.Header),
		Request:    req,
	}

	if err := handler.Authorize(context.Background(), req, resp); err != nil {
		t.Fatalf("Authorize() error for complete managed flow: %v", err)
	}
}

type refuzzB7bbc98ae2Transport struct {
	idpIssuer string
	mcpIssuer string
}

func (rt *refuzzB7bbc98ae2Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	if strings.Contains(req.URL.Path, ".well-known") {
		issuer := rt.idpIssuer
		if req.URL.Host == "mcp.example" {
			issuer = rt.mcpIssuer
		}

		body, err := json.Marshal(map[string]interface{}{
			"issuer":                 issuer,
			"token_endpoint":         issuer + "/token",
			"authorization_endpoint": issuer + "/authorize",
			"response_types_supported": []string{
				"code",
			},
			"grant_types_supported": []string{
				"authorization_code",
				"urn:ietf:params:oauth:grant-type:token-exchange",
				"urn:ietf:params:oauth:grant-type:jwt-bearer",
			},
		})
		if err != nil {
			return nil, err
		}
		return refuzzB7bbc98ae2Response(req, http.StatusOK, string(body)), nil
	}

	if req.URL.Path == "/token" {
		if req.URL.Host == "mcp.example" {
			return refuzzB7bbc98ae2Response(req, http.StatusOK, `{
				"access_token":"fuzz-mcp-access-token",
				"token_type":"Bearer",
				"expires_in":3600
			}`), nil
		}
		return refuzzB7bbc98ae2Response(req, http.StatusOK, `{
			"access_token":"fuzz-access-token",
			"token_type":"Bearer",
			"expires_in":3600,
			"issued_token_type":"`+oauthex.TokenTypeIDJAG+`"
		}`), nil
	}

	return refuzzB7bbc98ae2Response(req, http.StatusNotFound, `{"error":"not found"}`), nil
}

func refuzzB7bbc98ae2Response(req *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode:    status,
		Body:          io.NopCloser(strings.NewReader(body)),
		Header:        http.Header{"Content-Type": []string{"application/json"}},
		ContentLength: int64(len(body)),
		Request:       req,
	}
}
