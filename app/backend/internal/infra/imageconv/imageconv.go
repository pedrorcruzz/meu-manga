package imageconv

import (
	"bytes"
	"image"
	"image/jpeg"

	"golang.org/x/image/draw"

	// registra os decoders usados nas capas enviadas pelo usuário
	_ "image/gif"
	_ "image/png"
)

// ToJPEG decodes any supported image and re-encodes it as JPEG.
// Se já for JPEG, ainda assim normaliza (re-encoda) para garantir formato.
func ToJPEG(data []byte) ([]byte, error) {
	return ToJPEGSized(data, 0, 0)
}

// ToJPEGSized decodifica qualquer imagem suportada, opcionalmente redimensiona
// para w×h e re-encoda como JPEG. Com w<=0 ou h<=0 não redimensiona (só
// normaliza o formato, como ToJPEG).
//
// O resize usa o kernel CatmullRom (bicúbico), que dá o melhor resultado tanto
// para ampliar quanto para reduzir — bordas nítidas, sem serrilhado nem blocos.
// Redimensiona para as dimensões exatas pedidas (como um imageresizer), sem
// cortar nem adicionar barras.
func ToJPEGSized(data []byte, w, h int) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}

	img := image.Image(src)
	if w > 0 && h > 0 {
		dst := image.NewRGBA(image.Rect(0, 0, w, h))
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
		img = dst
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 92}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
