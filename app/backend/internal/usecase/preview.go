package usecase

import (
	"context"
	"encoding/base64"
	"fmt"
	"sync"
	"time"

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

type previewKey struct {
	url   string
	count int
}

// previewResult guarda as thumbnails (data URLs) das primeiras e das últimas
// páginas de um capítulo.
type previewResult struct {
	head []string
	tail []string
}

// chapterPreviewer é a interface opcional de uma Source que sabe fazer um
// preview leve (captura rápida das primeiras/últimas páginas). Quando a fonte a
// implementa, o Previewer a usa no lugar de DownloadChapter (bem mais pesado).
type chapterPreviewer interface {
	PreviewChapter(ctx context.Context, ch domain.Chapter, count int) (head, tail [][]byte, err error)
}

// Previewer fetches the first few pages of a chapter and returns them as
// downscaled JPEG thumbnails encoded as data URLs.
type Previewer struct {
	reg   SourceRegistry
	thumb Thumbnailer
	gate  *domain.RateGate // nil = sem gate de rate-limit

	mu    sync.Mutex
	cache map[previewKey]previewResult // cache evita requisições repetidas ao browser
	order []previewKey                 // ordem FIFO para evicção quando o cache enche
}

// NewPreviewer creates a Previewer backed by the given registry and thumbnailer.
func NewPreviewer(reg SourceRegistry, thumb Thumbnailer) *Previewer {
	return &Previewer{
		reg:   reg,
		thumb: thumb,
		cache: make(map[previewKey]previewResult),
	}
}

// SetGate liga o Previewer ao RateGate compartilhado.
func (p *Previewer) SetGate(g *domain.RateGate) { p.gate = g }

// Preview returns thumbnail data-URLs for the first and last `count` pages of
// ch. count defaults to previewDefaultCount when ≤0 and is capped at
// previewMaxCount.
func (p *Previewer) Preview(ctx context.Context, sourceID string, ch domain.Chapter, count int) (head, tail []string, err error) {
	if count <= 0 {
		count = previewDefaultCount
	}
	if count > previewMaxCount {
		count = previewMaxCount
	}

	if p.gate != nil {
		if be := p.gate.Blocked(time.Now()); be != nil {
			return nil, nil, be
		}
	}

	src, err := p.reg.Get(sourceID)
	if err != nil {
		return nil, nil, err
	}

	key := previewKey{url: ch.URL, count: count}

	// verifica o cache antes de acionar o browser
	p.mu.Lock()
	if res, ok := p.cache[key]; ok {
		p.mu.Unlock()
		return res.head, res.tail, nil
	}
	p.mu.Unlock()

	res, err := p.fetch(ctx, src, ch, count)
	if err != nil {
		if p.gate != nil {
			err = p.gate.Record(err)
		}
		return nil, nil, err
	}

	p.mu.Lock()
	p.store(key, res)
	p.mu.Unlock()

	return res.head, res.tail, nil
}

// fetch busca as primeiras/últimas páginas do capítulo. Usa o preview leve da
// fonte quando disponível; caso contrário cai no DownloadChapter completo.
func (p *Previewer) fetch(ctx context.Context, src domain.Source, ch domain.Chapter, count int) (previewResult, error) {
	if fast, ok := src.(chapterPreviewer); ok {
		h, t, err := fast.PreviewChapter(ctx, ch, count)
		if err != nil {
			return previewResult{}, err
		}
		return previewResult{head: p.encode(h), tail: p.encode(t)}, nil
	}

	// fallback: captura o capítulo inteiro e recorta as pontas
	var raw [][]byte
	if err := src.DownloadChapter(ctx, ch, func(pg domain.Page) error {
		raw = append(raw, pg.Data)
		return nil
	}); err != nil {
		return previewResult{}, fmt.Errorf("preview fetch: %w", err)
	}
	headRaw := raw[:min(count, len(raw))]
	start := max(len(raw)-count, min(count, len(raw)))
	tailRaw := raw[start:]
	return previewResult{head: p.encode(headRaw), tail: p.encode(tailRaw)}, nil
}

// encode redimensiona cada imagem e a serializa como data URL JPEG base64.
func (p *Previewer) encode(raw [][]byte) []string {
	imgs := make([]string, 0, len(raw))
	for _, data := range raw {
		thumb, terr := p.thumb(data, previewThumbSide, previewThumbQuality)
		if terr != nil {
			continue // pula páginas com bytes inválidos
		}
		imgs = append(imgs, "data:image/jpeg;base64,"+base64.StdEncoding.EncodeToString(thumb))
	}
	return imgs
}

// store insere uma entrada no cache usando evicção FIFO quando o limite é atingido.
func (p *Previewer) store(key previewKey, res previewResult) {
	if _, exists := p.cache[key]; exists {
		p.cache[key] = res
		return
	}
	if len(p.order) >= previewMaxCache {
		oldest := p.order[0]
		p.order = p.order[1:]
		delete(p.cache, oldest)
	}
	p.cache[key] = res
	p.order = append(p.order, key)
}
