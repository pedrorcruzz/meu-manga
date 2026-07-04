package cookies

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"meumanga/internal/domain"

	_ "modernc.org/sqlite"
)

// Browser descreve um navegador Chromium: onde ficam seus perfis e a referência
// da chave de criptografia (serviço de Keychain no macOS / Secret Service no
// Linux; no Windows a chave vem do arquivo Local State).
type Browser struct {
	Name     string
	DataDir  string // pasta com os perfis (Default, Profile 1, …)
	Keychain string
}

// DefaultBrowsers lista os navegadores Chromium do sistema atual (por-OS).
func DefaultBrowsers(home string) []Browser { return osBrowsers(home) }

// Provider descobre e descriptografa os cookies do Cloudflare no navegador real
// do usuário. A leitura de chave/valor varia por sistema (arquivos por-OS).
type Provider struct {
	browsers  []Browser
	userAgent string
	// passwordFn busca a senha "Safe Storage" (Keychain/Secret Service); injetável
	// para testes. No Windows não é usada (a chave vem do Local State).
	passwordFn func(service string) (string, error)
}

// New builds a Provider over the given candidate browsers.
func New(browsers []Browser, userAgent string) *Provider {
	return &Provider{browsers: browsers, userAgent: userAgent, passwordFn: defaultPasswordFn}
}

// Session finds the first browser holding a valid Cloudflare session for host.
func (p *Provider) Session(ctx context.Context, host string) (domain.Session, error) {
	for _, b := range p.browsers {
		key, err := browserKey(b, p.passwordFn)
		if err != nil {
			continue // navegador não instalado / sem chave
		}
		for _, db := range findCookieDBs(b.DataDir) {
			cookies, err := readCookies(ctx, db, host, key)
			if err != nil {
				continue
			}
			s := domain.Session{Cookies: cookies, UserAgent: p.userAgent}
			if s.Valid() {
				return s, nil
			}
		}
	}
	return domain.Session{}, domain.ErrNoSession
}

// findCookieDBs lista os arquivos "Cookies" de todos os perfis (inclui o caminho
// novo Network/Cookies dos Chromium recentes).
func findCookieDBs(dataDir string) []string {
	profiles := map[string]bool{"Default": true}
	if entries, err := os.ReadDir(dataDir); err == nil {
		for _, e := range entries {
			if e.IsDir() && (e.Name() == "Default" || strings.HasPrefix(e.Name(), "Profile")) {
				profiles[e.Name()] = true
			}
		}
	}
	var out []string
	for prof := range profiles {
		for _, sub := range []string{"Cookies", filepath.Join("Network", "Cookies")} {
			path := filepath.Join(dataDir, prof, sub)
			if _, err := os.Stat(path); err == nil {
				out = append(out, path)
			}
		}
	}
	return out
}

func readCookies(ctx context.Context, cookieDB, host string, key []byte) (map[string]string, error) {
	tmp, err := copyToTemp(cookieDB)
	if err != nil {
		return nil, fmt.Errorf("copy cookie db: %w", err)
	}
	defer os.Remove(tmp)

	db, err := sql.Open("sqlite", "file:"+tmp+"?mode=ro&immutable=1")
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.QueryContext(ctx,
		`SELECT name, encrypted_value FROM cookies WHERE host_key LIKE ?`, "%"+host+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]string{}
	for rows.Next() {
		var name string
		var enc []byte
		if err := rows.Scan(&name, &enc); err != nil {
			return nil, err
		}
		val, err := decryptValue(enc, key) // implementação por-OS (CBC no mac/linux, GCM no windows)
		if err != nil {
			continue
		}
		out[name] = string(val)
	}
	return out, rows.Err()
}

func copyToTemp(src string) (string, error) {
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	f, err := os.CreateTemp("", "mm-cookies-*.db")
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, in); err != nil {
		return "", err
	}
	return f.Name(), nil
}
