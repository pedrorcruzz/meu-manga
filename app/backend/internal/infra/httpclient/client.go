package httpclient

import (
	"context"
	"io"
	"sort"
	"strings"

	"meumanga/internal/domain"

	fhttp "github.com/bogdanfinn/fhttp"
	tls_client "github.com/bogdanfinn/tls-client"
	"github.com/bogdanfinn/tls-client/profiles"
)

// Client is a Chrome-fingerprinted HTTP client that replays the browser session.
type Client struct {
	host    string
	session domain.SessionProvider
	inner   tls_client.HttpClient
}

// New builds a Client for the given host using its reused session.
func New(host string, session domain.SessionProvider) (*Client, error) {
	inner, err := tls_client.NewHttpClient(tls_client.NewNoopLogger(),
		tls_client.WithTimeoutSeconds(30),
		tls_client.WithClientProfile(profiles.Chrome_146),
	)
	if err != nil {
		return nil, err
	}
	return &Client{host: host, session: session, inner: inner}, nil
}

// Get fetches url with the session cookies + user-agent applied.
func (c *Client) Get(ctx context.Context, url string) ([]byte, int, error) {
	sess, err := c.session.Session(ctx, c.host)
	if err != nil {
		return nil, 0, err
	}
	req, err := fhttp.NewRequestWithContext(ctx, fhttp.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header = fhttp.Header{
		"accept":           {"*/*"},
		"accept-language":  {"pt-BR,pt;q=0.9,en;q=0.8"},
		"cookie":           {cookieHeader(sess.Cookies)},
		"user-agent":       {sess.UserAgent},
		"x-requested-with": {"XMLHttpRequest"},
		"referer":          {"https://" + c.host + "/"},
		fhttp.HeaderOrderKey: {
			"accept", "accept-language", "cookie", "user-agent", "x-requested-with", "referer",
		},
	}
	resp, err := c.inner.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	return body, resp.StatusCode, err
}

func cookieHeader(cookies map[string]string) string {
	parts := make([]string, 0, len(cookies))
	for name, value := range cookies {
		parts = append(parts, name+"="+value)
	}
	sort.Strings(parts)
	return strings.Join(parts, "; ")
}
