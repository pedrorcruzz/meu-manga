package imageconv

import (
	"bytes"
	"image"
	"image/jpeg"

	// registra os decoders usados nas capas enviadas pelo usuário
	_ "image/gif"
	_ "image/png"
)

// ToJPEG decodes any supported image and re-encodes it as JPEG.
// Se já for JPEG, ainda assim normaliza (re-encoda) para garantir formato.
func ToJPEG(data []byte) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 92}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
