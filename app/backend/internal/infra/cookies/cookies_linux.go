//go:build linux

package cookies

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// osBrowsers lista os navegadores Chromium no Linux (~/.config).
func osBrowsers(home string) []Browser {
	cfg := filepath.Join(home, ".config")
	// Keychain = valor do atributo "application" no Secret Service (secret-tool).
	return []Browser{
		{"Google Chrome", filepath.Join(cfg, "google-chrome"), "chrome"},
		{"Chromium", filepath.Join(cfg, "chromium"), "chromium"},
		{"Brave", filepath.Join(cfg, "BraveSoftware", "Brave-Browser"), "brave"},
		{"Microsoft Edge", filepath.Join(cfg, "microsoft-edge"), "chrome"},
		{"Vivaldi", filepath.Join(cfg, "vivaldi"), "vivaldi"},
		{"Opera", filepath.Join(cfg, "opera"), "chrome"},
	}
}

var defaultPasswordFn = secretPassword

// browserKey no Linux: senha do Secret Service (ou "peanuts" de fallback),
// PBKDF2 com 1 iteração.
func browserKey(b Browser, passwordFn func(string) (string, error)) ([]byte, error) {
	pw := "peanuts" // padrão do Chromium quando não há keyring
	if passwordFn != nil {
		if p, err := passwordFn(b.Keychain); err == nil && p != "" {
			pw = p
		}
	}
	return DeriveKey(pw, 1)
}

// decryptValue no Linux: v10/v11 = AES-128-CBC.
func decryptValue(enc, key []byte) ([]byte, error) { return DecryptCBC(enc, key) }

// secretPassword busca a senha "Safe Storage" no Secret Service via secret-tool.
func secretPassword(app string) (string, error) {
	out, err := exec.Command("secret-tool", "lookup", "application", app).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(out), "\n"), nil
}
