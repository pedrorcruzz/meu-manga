package usecase

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"

	"meumanga/internal/domain"
)

// Thumbnailer converte bytes brutos de imagem em um thumbnail JPEG.
type Thumbnailer func(data []byte, maxSide, quality int) ([]byte, error)

const (
	previewDefaultCount = 3
	previewMaxCount     = 5
	previewMaxCache     = 50
	previewThumbSide    = 400
	previewThumbQuality = 80
)

// errEnoughPages é sinal interno: o sink já coletou páginas suficientes.
// Não indica falha — apenas interrompe o streaming do capítulo mais cedo.
var errEnoughPages = errors.New("preview: enough pages collected")

type previewKey struct {
	url   string
	count int
}

// Previewer fetches the first few pages of a chapter and returns them as
// downscaled JPEG thumbnails encoded as data URLs.
type Previewer struct {
	reg   SourceRegistry
	thumb Thumbnailer

	mu    sync.Mutex
	cache map[previewKey][]string // cache evita requisições repetidas ao browser
	order []previewKey            // ordem FIFO para evicção quando o cache enche
}

// NewPreviewer creates a Previewer backed by the given registry and thumbnailer.
func NewPreviewer(reg SourceRegistry, thumb Thumbnailer) *Previewer {
	return &Previewer{
		reg:   reg,
		thumb: thumb,
		cache: make(map[previewKey][]string),
	}
}

// Preview returns up to count thumbnail data-URLs for the first pages of ch.
// count defaults to previewDefaultCount when ≤0 and is capped at previewMaxCount.
func (p *Previewer) Preview(ctx context.Context, sourceID string, ch domain.Chapter, count int) ([]string, error) {
	if count <= 0 {
		count = previewDefaultCount
	}
	if count > previewMaxCount {
		count = previewMaxCount
	}

	src, err := p.reg.Get(sourceID)
	if err != nil {
		return nil, err
	}

	key := previewKey{url: ch.URL, count: count}

	// verifica o cache antes de acionar o browser
	p.mu.Lock()
	if imgs, ok := p.cache[key]; ok {
		p.mu.Unlock()
		return imgs, nil
	}
	p.mu.Unlock()

	imgs, err := p.fetch(ctx, src, ch, count)
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	p.store(key, imgs)
	p.mu.Unlock()

	return imgs, nil
}

// fetch drives DownloadChapter and stops early after count pages.
func (p *Previewer) fetch(ctx context.Context, src domain.Source, ch domain.Chapter, count int) ([]string, error) {
	var raw [][]byte
	err := src.DownloadChapter(ctx, ch, func(pg domain.Page) error {
		raw = append(raw, pg.Data)
		if len(raw) >= count {
			return errEnoughPages // interrompe o streaming após coletar o suficiente
		}
		return nil
	})
	// errEnoughPages é sinal interno, não falha real
	if err != nil && !errors.Is(err, errEnoughPages) {
		return nil, fmt.Errorf("preview fetch: %w", err)
	}

	imgs := make([]string, 0, len(raw))
	for _, data := range raw {
		thumb, terr := p.thumb(data, previewThumbSide, previewThumbQuality)
		if terr != nil {
			continue // pula páginas com bytes inválidos
		}
		imgs = append(imgs, "data:image/jpeg;base64,"+base64.StdEncoding.EncodeToString(thumb))
	}
	return imgs, nil
}

// store insere uma entrada no cache usando evicção FIFO quando o limite é atingido.
func (p *Previewer) store(key previewKey, imgs []string) {
	if _, exists := p.cache[key]; exists {
		p.cache[key] = imgs
		return
	}
	if len(p.order) >= previewMaxCache {
		oldest := p.order[0]
		p.order = p.order[1:]
		delete(p.cache, oldest)
	}
	p.cache[key] = imgs
	p.order = append(p.order, key)
}
