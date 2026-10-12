// Package cluster connects a game node to the data service's internal API:
// heartbeat registration, cluster-wide nickname presence, node leave, and
// the transport the settlement outbox delivers through.
package cluster

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
)

// maxResponse bounds how much of a data service response is read.
const maxResponse = 1 << 20

// DataClient posts JSON to the data service's internal API with the
// cluster key, or with the node's own key (NODE.md "后台添加节点").
type DataClient struct {
	baseURL string
	header  string // contract.ClusterKeyHeader or contract.NodeKeyHeader
	key     string
	prefix  string // contract.NodePathPrefix for a node key
	http    *http.Client
}

// NewDataClient returns a client for baseURL (e.g. http://127.0.0.1:8790)
// that authenticates with the cluster secret.
func NewDataClient(baseURL string, secret []byte) *DataClient {
	return newDataClient(baseURL, contract.ClusterKeyHeader, string(secret), "")
}

// NewKeyedDataClient returns a client that authenticates with a node key.
// It calls the API under /multiplayer, so baseURL may be the data
// service's public origin (behind its reverse proxy) or its internal one.
func NewKeyedDataClient(baseURL, nodeKey string) *DataClient {
	return newDataClient(baseURL, contract.NodeKeyHeader, nodeKey, contract.NodePathPrefix)
}

func newDataClient(baseURL, header, key, prefix string) *DataClient {
	return &DataClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		header:  header,
		key:     key,
		prefix:  prefix,
		http: &http.Client{
			Timeout: 15 * time.Second,
			Transport: &http.Transport{
				Proxy:               nil,
				MaxIdleConnsPerHost: 8,
				IdleConnTimeout:     60 * time.Second,
			},
		},
	}
}

// Send posts a raw JSON body and returns the HTTP status. A non-nil error
// means the request did not complete (network failure or ctx).
func (c *DataClient) Send(ctx context.Context, path string, body []byte) (int, error) {
	status, _, err := c.post(ctx, path, body)
	return status, err
}

// Call posts request as JSON and decodes a 2xx response into response.
// Other statuses return an *apierr.Error carrying the status and the
// {"error": code} of the body (or HTTP_<status> when there is none); the
// body's other members (ACCOUNT_BANNED's until and reason) are its Fields,
// so a refusal passed on to the player keeps them.
func (c *DataClient) Call(ctx context.Context, path string, request, response any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	status, data, err := c.post(ctx, path, body)
	if err != nil {
		return err
	}
	if status < 200 || status > 299 {
		return refusal(status, data)
	}
	if response == nil {
		return nil
	}
	if err := json.Unmarshal(data, response); err != nil {
		return fmt.Errorf("decode %s response: %w", path, err)
	}
	return nil
}

// refusal turns a data service error body into an *apierr.Error.
func refusal(status int, data []byte) *apierr.Error {
	var members map[string]json.RawMessage
	var code string
	if json.Unmarshal(data, &members) != nil || json.Unmarshal(members["error"], &code) != nil || code == "" {
		return apierr.New(status, fmt.Sprintf("HTTP_%d", status))
	}
	rejected := apierr.New(status, code)
	if len(members) > 1 {
		fields := make(map[string]any, len(members)-1)
		for name, value := range members {
			if name != "error" {
				fields[name] = value
			}
		}
		rejected = rejected.With(fields)
	}
	return rejected
}

func (c *DataClient) post(ctx context.Context, path string, body []byte) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+c.prefix+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(c.header, c.key)
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse))
	if err != nil {
		return 0, nil, err
	}
	return resp.StatusCode, data, nil
}
