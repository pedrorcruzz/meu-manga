//go:build darwin

package cookies

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// osBrowsers lista os navegadores Chromium no macOS.
func osBrowsers(home string) []Browser {
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

var defaultPasswordFn = keychainPassword

// browserKey deriva a chave AES a partir da senha do Keychain (PBKDF2, 1003 iter).
func browserKey(b Browser, passwordFn func(string) (string, error)) ([]byte, error) {
	pw, err := passwordFn(b.Keychain)
	if err != nil || pw == "" {
		return nil, errNoKey
	}
	return DeriveKey(pw, 1003) // macOS: 1003 iterações
}

// decryptValue no macOS: v10 = AES-128-CBC.
func decryptValue(enc, key []byte) ([]byte, error) { return DecryptCBC(enc, key) }

// keychainPassword lê a senha "Safe Storage" do Keychain do macOS.
func keychainPassword(service string) (string, error) {
	out, err := exec.Command("security", "find-generic-password", "-s", service, "-w").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
