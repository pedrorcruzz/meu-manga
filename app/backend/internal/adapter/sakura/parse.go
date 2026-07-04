package sakura

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"meumanga/internal/domain"
)

// searchItem espelha o JSON do endpoint de busca do Sakura.
type searchItem struct {
	ID      json.Number `json:"id"`
	Titulo  string      `json:"titulo"`
	URL     string      `json:"url"`
	Thumb   string      `json:"thumb_url"`
	Rating  string      `json:"avaliacao"`
	Status  string      `json:"status"`
	Demo    string      `json:"demografia"`
	Ano     json.Number `json:"ano"`
	Views   string      `json:"views"`
	Favs    string      `json:"favoritos"`
}

// parseSearch converts the search JSON payload into normalized mangas.
func parseSearch(data []byte) ([]domain.Manga, error) {
	var items []searchItem
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, err
	}
	out := make([]domain.Manga, 0, len(items))
	for _, it := range items {
		year, _ := it.Ano.Int64()
		out = append(out, domain.Manga{
			Source:      SourceID,
			MangaID:     it.ID.String(),
			Slug:        slugFromURL(it.URL),
			Title:       it.Titulo,
			ThumbURL:    absURL(it.Thumb),
			Rating:      it.Rating,
			Status:      it.Status,
			Demographic: it.Demo,
			Year:        int(year),
			Views:       it.Views,
			Favorites:   it.Favs,
			URL:         absURL(it.URL),
		})
	}
	return out, nil
}

// chapterRow espelha o objeto extraído do DOM da página da obra.
type chapterRow struct {
	ID     string `json:"id"`
	Number string `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Date   string `json:"date"`
	Volume string `json:"volume"`
}

// parseChapters normalizes and sorts (desc) the chapters scraped from the DOM.
func parseChapters(data []byte) ([]domain.Chapter, error) {
	var rows []chapterRow
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, err
	}
	out := make([]domain.Chapter, 0, len(rows))
	for _, r := range rows {
		title := strings.TrimSpace(r.Title)
		if redundantTitle(title, r.Number) {
			title = "" // título só repete "Cap. N" — deixa o front rotular
		}
		id := r.ID
		if id == "" {
			id = r.Number
		}
		out = append(out, domain.Chapter{
			ID:     id,
			Number: r.Number,
			Title:  title,
			URL:    r.URL,
			Date:   strings.TrimSpace(r.Date),
			Volume: strings.TrimSpace(r.Volume),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		return numOf(out[i].Number) > numOf(out[j].Number)
	})
	return out, nil
}

// redundantTitle reporta se o título só repete "Cap. N" (nada útil além do número).
func redundantTitle(title, number string) bool {
	t := strings.ToLower(strings.TrimSpace(title))
	if t == "" || t == number {
		return true
	}
	t = strings.NewReplacer("capítulo", "", "capitulo", "", "cap", "", ".", "", " ", "").Replace(t)
	return t == number
}

// isImage reporta se os bytes começam com um magic number de imagem (JPEG/PNG/GIF/WebP).
func isImage(b []byte) bool {
	switch {
	case len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF: // JPEG
		return true
	case len(b) >= 8 && string(b[:8]) == "\x89PNG\r\n\x1a\n": // PNG
		return true
	case len(b) >= 6 && (string(b[:6]) == "GIF87a" || string(b[:6]) == "GIF89a"): // GIF
		return true
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP": // WebP
		return true
	default:
		return false
	}
}

var pageNumRe = regexp.MustCompile(`(\d+)\.(?:jpg|jpeg|png|webp)$`)

// pageIndex extrai o número da página a partir do nome do arquivo (ex: 007.jpg -> 7).
func pageIndex(url string) int {
	m := pageNumRe.FindStringSubmatch(strings.ToLower(url))
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

func slugFromURL(u string) string {
	u = strings.TrimSuffix(u, "/")
	u = strings.TrimPrefix(u, "/obras/")
	u = strings.TrimPrefix(u, baseURL+"/obras/")
	return u
}

func absURL(u string) string {
	if u == "" || strings.HasPrefix(u, "http") {
		return u
	}
	return baseURL + u
}

func numOf(s string) float64 {
	f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return f
}
