package cookies

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/sha1"
	"errors"
)

// domainHashPrefix é o SHA256 do host que o Chromium 150 prefixa no valor v10.
const domainHashPrefix = 32

// DeriveKey reproduz a derivação de chave do Chromium no macOS.
func DeriveKey(keychainPassword string) ([]byte, error) {
	return pbkdf2.Key(sha1.New, keychainPassword, []byte("saltysalt"), 1003, 16)
}

// DecryptV10 descriptografa um valor de cookie no formato v10 do Chromium/macOS.
func DecryptV10(encrypted, key []byte) ([]byte, error) {
	if len(encrypted) < 3 || string(encrypted[:3]) != "v10" {
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
