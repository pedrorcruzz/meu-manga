package domain

import "context"

// Session holds the browser session reused to pass Cloudflare.
type Session struct {
	Cookies   map[string]string
	UserAgent string
}

// Valid reports whether the session carries a Cloudflare clearance cookie.
func (s Session) Valid() bool {
	return s.Cookies["cf_clearance"] != ""
}

// SessionProvider yields the current browser session for a host.
// A implementação lê os cookies do navegador real do usuário (qualquer Chromium).
type SessionProvider interface {
	Session(ctx context.Context, host string) (Session, error)
}
