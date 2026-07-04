package cookies

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"meumanga/internal/domain"

	_ "modernc.org/sqlite"
)

// Browser descreve um navegador Chromium: onde ficam seus perfis e o serviço
// "Safe Storage" no Keychain do macOS que guarda a chave de criptografia.
type Browser struct {
	Name     string
	DataDir  string // pasta com os perfis (Default, Profile 1, …)
	Keychain string
}

// DefaultBrowsers lista os navegadores Chromium suportados no macOS. A sessão é
// descoberta automaticamente naquele que tiver o cookie do Cloudflare.
func DefaultBrowsers(home string) []Browser {
	base := filepath.Join(home, "Library", "Application Support")
	return []Browser{
		{"Dia", filepath.Join(base, "Dia", "User Data"), "Dia Safe Storage"},
		{"Google Chrome", filepath.Join(base, "Google", "Chrome"), "Chrome Safe Storage"},
		{"Brave", filepath.Join(base, "BraveSoftware", "Brave-Browser"), "Brave Safe Storage"},
		{"Microsoft Edge", filepath.Join(base, "Microsoft Edge"), "Microsoft Edge Safe Storage"},
		{"Vivaldi", filepath.Join(base, "Vivaldi"), "Vivaldi Safe Storage"},
		{"Opera", filepath.Join(base, "com.operasoftware.Opera"), "Opera Safe Storage"},
		{"Arc", filepath.Join(base, "Arc", "User Data"), "Arc"},
		{"Chromium", filepath.Join(base, "Chromium"), "Chromium Safe Storage"},
	}
}

// Provider descobre e descriptografa os cookies do Cloudflare no navegador real
// do usuário (qualquer Chromium suportado).
type Provider struct {
	browsers  []Browser
	userAgent string
	// passwordFn é injetável para testes (evita tocar no Keychain real).
	passwordFn func(service string) (string, error)
}

// New builds a Provider over the given candidate browsers.
func New(browsers []Browser, userAgent string) *Provider {
	return &Provider{browsers: browsers, userAgent: userAgent, passwordFn: keychainPassword}
}

// Session finds the first browser holding a valid Cloudflare session for host.
func (p *Provider) Session(ctx context.Context, host string) (domain.Session, error) {
	for _, b := range p.browsers {
		pw, err := p.passwordFn(b.Keychain)
		if err != nil || pw == "" {
			continue // navegador não instalado / sem chave no Keychain
		}
		key, err := DeriveKey(pw)
		if err != nil {
			continue
		}
		for _, db := range findCookieDBs(b.DataDir) {
			cookies, err := readCookies(ctx, db, host, key)
			if err != nil {
				continue
			}
			s := domain.Session{Cookies: cookies, UserAgent: p.userAgent}
			if s.Valid() {
				return s, nil // achamos cf_clearance
			}
		}
	}
	return domain.Session{}, domain.ErrNoSession
}

// findCookieDBs lista os arquivos "Cookies" de todos os perfis de um navegador
// (inclui o caminho novo Network/Cookies dos Chromium recentes).
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
		val, err := DecryptV10(enc, key)
		if err != nil {
			continue // pula cookies que não descriptografam
		}
		out[name] = string(val)
	}
	return out, rows.Err()
}

// keychainPassword lê a senha de criptografia do Keychain do macOS.
func keychainPassword(service string) (string, error) {
	out, err := exec.Command("security", "find-generic-password", "-s", service, "-w").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
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
