//go:build windows

package cookies

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

// osBrowsers lista os navegadores Chromium no Windows (%LOCALAPPDATA%).
func osBrowsers(home string) []Browser {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		local = filepath.Join(home, "AppData", "Local")
	}
	roaming := os.Getenv("APPDATA")
	if roaming == "" {
		roaming = filepath.Join(home, "AppData", "Roaming")
	}
	return []Browser{
		{"Google Chrome", filepath.Join(local, "Google", "Chrome", "User Data"), ""},
		{"Microsoft Edge", filepath.Join(local, "Microsoft", "Edge", "User Data"), ""},
		{"Brave", filepath.Join(local, "BraveSoftware", "Brave-Browser", "User Data"), ""},
		{"Chromium", filepath.Join(local, "Chromium", "User Data"), ""},
		{"Vivaldi", filepath.Join(local, "Vivaldi", "User Data"), ""},
		{"Opera", filepath.Join(roaming, "Opera Software", "Opera Stable"), ""},
	}
}

// no Windows a chave vem do Local State (DPAPI), não do Keychain.
var defaultPasswordFn func(string) (string, error)

// browserKey no Windows: lê a chave AES do Local State (protegida por DPAPI).
func browserKey(b Browser, _ func(string) (string, error)) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(b.DataDir, "Local State"))
	if err != nil {
		return nil, errNoKey
	}
	var ls struct {
		OSCrypt struct {
			EncryptedKey string `json:"encrypted_key"`
		} `json:"os_crypt"`
	}
	if err := json.Unmarshal(data, &ls); err != nil || ls.OSCrypt.EncryptedKey == "" {
		return nil, errNoKey
	}
	raw, err := base64.StdEncoding.DecodeString(ls.OSCrypt.EncryptedKey)
	if err != nil || len(raw) < 5 || string(raw[:5]) != "DPAPI" {
		return nil, errNoKey
	}
	return dpapiDecrypt(raw[5:])
}

// decryptValue no Windows: v10 = AES-256-GCM; senão DPAPI direto (legado).
func decryptValue(enc, key []byte) ([]byte, error) {
	if len(enc) >= 3 && (string(enc[:3]) == "v10" || string(enc[:3]) == "v11") {
		if len(enc) < 3+12+16 {
			return nil, errNoKey
		}
		nonce := enc[3:15]
		ct := enc[15:]
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		out, err := gcm.Open(nil, nonce, ct, nil)
		if err != nil {
			return nil, err
		}
		if len(out) > domainHashPrefix {
			out = out[domainHashPrefix:]
		}
		return out, nil
	}
	// valor legado protegido diretamente por DPAPI
	return dpapiDecrypt(enc)
}

var (
	crypt32           = syscall.NewLazyDLL("crypt32.dll")
	procUnprotectData = crypt32.NewProc("CryptUnprotectData")
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procLocalFree     = kernel32.NewProc("LocalFree")
)

type dataBlob struct {
	cbData uint32
	pbData *byte
}

// dpapiDecrypt chama CryptUnprotectData (crypt32.dll).
func dpapiDecrypt(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, errNoKey
	}
	in := dataBlob{cbData: uint32(len(data)), pbData: &data[0]}
	var out dataBlob
	r, _, err := procUnprotectData.Call(
		uintptr(unsafe.Pointer(&in)), 0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, err
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	res := make([]byte, out.cbData)
	copy(res, unsafe.Slice(out.pbData, out.cbData))
	return res, nil
}
