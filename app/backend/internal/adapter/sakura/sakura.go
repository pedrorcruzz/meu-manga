package sakura

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"time"

	"meumanga/internal/domain"
)

const (
	// SourceID is the registry id of this adapter.
	SourceID = "sakura"
	// Host is the cookie/session host for Cloudflare.
	Host      = "sakuramangas.org"
	baseURL   = "https://sakuramangas.org"
	searchAPI = baseURL + "/dist/sakura/global/sidebar/sidebar.core.php?q="
	imagePath = "/imagens/"
)

// Fetcher performs an HTTP GET carrying the reused Cloudflare session.
type Fetcher interface {
	Get(ctx context.Context, url string) ([]byte, int, error)
}

// Page is the subset of browser controls the adapter needs.
type Page interface {
	Goto(ctx context.Context, url string) error
	Eval(js string) (string, error)
	CaptureImages(ctx context.Context, chapterURL, urlContains string, idle time.Duration, onImage func(url string, data []byte) error) error
	CapturePreview(ctx context.Context, chapterURL, urlContains string, idle time.Duration, onImage func(url string, data []byte) error) error
	Close()
}

// OpenPage opens a browser page bound to the given host session.
type OpenPage func(ctx context.Context, host string) (Page, error)

// Adapter implements domain.Source for Sakura Mangás.
type Adapter struct {
	fetch Fetcher
	open  OpenPage
}

// New builds the Sakura adapter from its IO dependencies.
func New(fetch Fetcher, open OpenPage) *Adapter {
	return &Adapter{fetch: fetch, open: open}
}

// Info identifies the source.
func (a *Adapter) Info() domain.SourceInfo {
	return domain.SourceInfo{ID: SourceID, Name: "Sakura Mangás"}
}

// Search queries the JSON search endpoint (pure HTTP, no browser needed).
func (a *Adapter) Search(ctx context.Context, query string) ([]domain.Manga, error) {
	body, status, err := a.fetch.Get(ctx, searchAPI+url.QueryEscape(query))
	if err != nil {
		return nil, err
	}
	if status != 200 {
		return nil, fmt.Errorf("search status %d", status)
	}
	return parseSearch(body)
}

// Chapters loads the obra page in the browser and scrapes every chapter.
func (a *Adapter) Chapters(ctx context.Context, slug string) (domain.ChapterList, error) {
	page, err := a.open(ctx, Host)
	if err != nil {
		return domain.ChapterList{}, err
	}
	defer page.Close()

	obraURL := baseURL + "/obras/" + slug + "/"
	if err := page.Goto(ctx, obraURL); err != nil {
		return domain.ChapterList{}, err
	}

	a.loadAllChapters(ctx, page)

	raw, err := page.Eval(chapterExtractJS)
	if err != nil {
		return domain.ChapterList{}, err
	}
	chapters, err := parseChapters([]byte(raw))
	if err != nil {
		return domain.ChapterList{}, err
	}
	title, _ := page.Eval(`() => document.title.replace(/ - Sakura.*/, '').replace(/^\s*Ler\s+/i, '').trim()`)
	manga := domain.Manga{
		Source: SourceID,
		Slug:   slug,
		Title:  trimJSON(title),
		URL:    obraURL,
	}
	return domain.ChapterList{Manga: manga, Chapters: chapters}, nil
}

// maxDownloadAttempts limita as re-navegações de um capítulo. O anti-leech do
// Sakura falha ~poucas páginas aleatórias por passada; re-navegar e mesclar
// converge para 100% (cada passada erra páginas diferentes).
const maxDownloadAttempts = 3

// DownloadChapter navigates the reader and streams every page image in order.
func (a *Adapter) DownloadChapter(ctx context.Context, ch domain.Chapter, sink domain.PageSink) error {
	pages := map[int][]byte{}
	for attempt := 0; attempt < maxDownloadAttempts && ctx.Err() == nil; attempt++ {
		err := a.captureOnce(ctx, ch, pages)
		if err == domain.ErrReaderCaptcha {
			return err // captcha não some com retry
		}
		if err != nil && len(pages) == 0 {
			return err
		}
		if len(pages) > 0 && !hasGaps(pages) {
			break // completo, sem lacunas
		}
	}
	if len(pages) == 0 {
		return domain.ErrNoPages
	}

	idxs := make([]int, 0, len(pages))
	for idx := range pages {
		idxs = append(idxs, idx)
	}
	sort.Ints(idxs)
	total := len(idxs)
	for _, idx := range idxs {
		if err := sink(domain.Page{
			Index: idx,
			Total: total,
			Name:  fmt.Sprintf("%03d.jpg", idx),
			Data:  pages[idx],
		}); err != nil {
			return err
		}
	}
	return nil
}

// previewIdle é o silêncio (sem novas páginas) que encerra a varredura de
// preview. Curto de propósito: o preview aceita faltar página em troca de ser
// rápido, diferente do download que persegue 100%.
const previewIdle = 4 * time.Second

// PreviewChapter faz uma captura leve (uma passada só, para frente) e devolve os
// bytes das primeiras e das últimas `count` páginas do capítulo. Bem mais rápido
// que DownloadChapter: não faz o passe reverso nem re-navega atrás de lacunas.
func (a *Adapter) PreviewChapter(ctx context.Context, ch domain.Chapter, count int) (head, tail [][]byte, err error) {
	if count <= 0 {
		count = 1
	}
	page, err := a.open(ctx, Host)
	if err != nil {
		return nil, nil, err
	}
	defer page.Close()

	pages := map[int][]byte{}
	cerr := page.CapturePreview(ctx, ch.URL, imagePath, previewIdle, func(u string, data []byte) error {
		if idx := pageIndex(u); idx > 0 && isImage(data) {
			if _, ok := pages[idx]; !ok {
				pages[idx] = data
			}
		}
		return nil
	})
	if cerr == domain.ErrReaderCaptcha {
		return nil, nil, cerr
	}
	if len(pages) == 0 {
		if cerr != nil {
			return nil, nil, cerr
		}
		return nil, nil, domain.ErrNoPages
	}

	idxs := make([]int, 0, len(pages))
	for idx := range pages {
		idxs = append(idxs, idx)
	}
	sort.Ints(idxs)

	// primeiras `count`
	for _, idx := range idxs[:min(count, len(idxs))] {
		head = append(head, pages[idx])
	}
	// últimas `count`, sem repetir as já incluídas no head
	start := max(len(idxs)-count, min(count, len(idxs)))
	for _, idx := range idxs[start:] {
		tail = append(tail, pages[idx])
	}
	return head, tail, nil
}

// loadAllChapters clica o botão "ver mais" até carregar todos os capítulos.
// Escala para obras grandes (centenas/milhares) via budget de tempo + detecção
// de fim (botão some) e de estagnação.
func (a *Adapter) loadAllChapters(ctx context.Context, page Page) {
	// espera a carga inicial aparecer
	for i := 0; i < 25 && ctx.Err() == nil; i++ {
		if a.chapterCount(page) > 0 {
			break
		}
		time.Sleep(700 * time.Millisecond)
	}
	time.Sleep(700 * time.Millisecond) // deixa o #ver-mais renderizar

	deadline := time.Now().Add(5 * time.Minute)
	prev, stable, gone := -1, 0, 0
	for ctx.Err() == nil && time.Now().Before(deadline) {
		res, _ := page.Eval(verMaisJS)
		if res == `"gone"` {
			// pode ser fim de verdade ou o botão ainda não renderizou
			if gone++; gone >= 4 {
				break
			}
			time.Sleep(600 * time.Millisecond)
			continue
		}
		gone = 0
		cnt := a.chapterCount(page)
		if cnt == prev {
			if stable++; stable >= 5 {
				break
			}
		} else {
			stable = 0
		}
		prev = cnt
		time.Sleep(700 * time.Millisecond)
	}
}

// captureOnce navega o capítulo uma vez e mescla as páginas novas em `pages`.
func (a *Adapter) captureOnce(ctx context.Context, ch domain.Chapter, pages map[int][]byte) error {
	page, err := a.open(ctx, Host)
	if err != nil {
		return err
	}
	defer page.Close()
	// ignora respostas que não são imagem (o leitor devolve HTML após a última página)
	return page.CaptureImages(ctx, ch.URL, imagePath, 8*time.Second, func(u string, data []byte) error {
		if idx := pageIndex(u); idx > 0 && isImage(data) {
			if _, ok := pages[idx]; !ok {
				pages[idx] = data
			}
		}
		return nil
	})
}

// hasGaps reporta se faltam páginas na sequência 1..max já capturada.
func hasGaps(pages map[int][]byte) bool {
	maxIdx := 0
	for i := range pages {
		if i > maxIdx {
			maxIdx = i
		}
	}
	return maxIdx == 0 || len(pages) < maxIdx
}

func (a *Adapter) chapterCount(page Page) int {
	raw, err := page.Eval(chapterCountJS)
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(trimJSON(raw))
	return n
}

// trimJSON remove aspas de um valor string serializado em JSON.
func trimJSON(s string) string {
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}

// chapterExtractJS coleta os capítulos dos elementos .chapter-item (data-id = chapter_id),
// rastreando os .volume-header em ordem de documento para marcar o volume de cada capítulo.
const chapterExtractJS = `() => {
  const seen = {}, out = [];
  let currentVol = '';
  document.querySelectorAll('.volume-header, .chapter-item, [class*="chapter-item"]').forEach(el => {
    const cls = el.className || '';
    if (/volume-header/.test(cls)) {
      const t = (el.textContent||'').replace(/\s+/g,' ').trim();
      const m = t.match(/volume\s*[0-9]+(?:\.[0-9]+)?/i);
      currentVol = m ? m[0].replace(/\s+/g,' ') : t.slice(0,24);
      return;
    }
    const url = el.getAttribute('data-url') || '';
    const m = url.match(/\/(\d+(?:\.\d+)?)\/?$/);
    if (!m) return;
    const num = m[1];
    if (seen[num]) return; seen[num] = 1;
    const a = el.querySelector('.title-text, a[href*="/obras/"]');
    const clock = el.querySelector('.bi-clock, [class*="clock" i]');
    const date = clock && clock.parentElement ? clock.parentElement.textContent.replace(/\s+/g,' ').trim() : '';
    out.push({
      id: el.getAttribute('data-id') || num,
      number: num,
      title: a ? (a.textContent||'').trim().slice(0,120) : ('Cap. ' + num),
      url: location.origin + url,
      date: date,
      volume: currentVol,
    });
  });
  return out;
}`

// verMaisJS clica o botão "ver mais" (só ícone) que carrega o próximo lote.
const verMaisJS = `() => { const b = document.querySelector('#ver-mais'); if (!b || b.offsetParent === null) return 'gone'; b.click(); return 'ok'; }`

// chapterCountJS conta os capítulos já carregados no DOM.
const chapterCountJS = `() => document.querySelectorAll('.chapter-item, [class*="chapter-item"]').length`
