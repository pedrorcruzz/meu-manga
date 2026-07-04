package cookies

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/sha1"
	"errors"
)

// domainHashPrefix é o SHA256 do host que o Chromium recente prefixa no valor.
const domainHashPrefix = 32

// errNoKey indica que não foi possível obter a chave de criptografia do navegador.
var errNoKey = errors.New("cookie encryption key unavailable")

// DeriveKey reproduz a derivação de chave do Chromium (PBKDF2-SHA1, saltysalt).
// iterations = 1003 no macOS, 1 no Linux.
func DeriveKey(password string, iterations int) ([]byte, error) {
	return pbkdf2.Key(sha1.New, password, []byte("saltysalt"), iterations, 16)
}

// DecryptCBC descriptografa um valor de cookie AES-128-CBC (prefixos v10/v11 do
// Chromium no macOS e Linux).
func DecryptCBC(encrypted, key []byte) ([]byte, error) {
	if len(encrypted) < 3 || (string(encrypted[:3]) != "v10" && string(encrypted[:3]) != "v11") {
		// valor em texto puro (cookie não criptografado)
		return encrypted, nil
	}
	body := encrypted[3:]
	if len(body) == 0 || len(body)%aes.BlockSize != 0 {
		return nil, errors.New("invalid ciphertext length")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	iv := []byte("                ") // 16 espaços
	out := make([]byte, len(body))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, body)

	out, err = pkcs7Unpad(out, aes.BlockSize)
	if err != nil {
		return nil, err
	}
	if len(out) > domainHashPrefix {
		out = out[domainHashPrefix:]
	}
	return out, nil
}

func pkcs7Unpad(b []byte, blockSize int) ([]byte, error) {
	n := len(b)
	if n == 0 || n%blockSize != 0 {
		return nil, errors.New("invalid padding")
	}
	pad := int(b[n-1])
	if pad == 0 || pad > blockSize || pad > n {
		return nil, errors.New("invalid padding size")
	}
	return b[:n-pad], nil
}
