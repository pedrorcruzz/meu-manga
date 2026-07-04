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

// Thumbnail decodes any supported image, downscales it so the longest side is
// at most maxSide (preserving aspect ratio), and re-encodes as JPEG at quality.
// Se a imagem já cabe em maxSide, apenas reencoda sem redimensionar.
func Thumbnail(data []byte, maxSide int, quality int) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	tw, th := thumbnailSize(w, h, maxSide)

	var out image.Image
	if tw == w && th == h {
		out = img
	} else {
		dst := image.NewNRGBA(image.Rect(0, 0, tw, th))
		scaleNearest(dst, img, bounds)
		out = dst
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// thumbnailSize calcula as dimensões alvo preservando proporção.
func thumbnailSize(w, h, maxSide int) (int, int) {
	if w <= maxSide && h <= maxSide {
		return w, h
	}
	if w >= h {
		tw := maxSide
		th := max((h*maxSide)/w, 1)
		return tw, th
	}
	th := maxSide
	tw := max((w*maxSide)/h, 1)
	return tw, th
}

// scaleNearest copia pixels de src para dst usando interpolação nearest-neighbor.
func scaleNearest(dst *image.NRGBA, src image.Image, srcBounds image.Rectangle) {
	dw := dst.Bounds().Dx()
	dh := dst.Bounds().Dy()
	sw := srcBounds.Dx()
	sh := srcBounds.Dy()
	for y := range dh {
		srcY := srcBounds.Min.Y + (y*sh)/dh
		for x := range dw {
			srcX := srcBounds.Min.X + (x*sw)/dw
			dst.Set(x, y, src.At(srcX, srcY))
		}
	}
}
