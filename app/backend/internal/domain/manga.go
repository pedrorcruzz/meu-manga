package domain

// Manga is a normalized work as returned by any source.
type Manga struct {
	Source      string `json:"source"`
	MangaID     string `json:"mangaId"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	ThumbURL    string `json:"thumbUrl"`
	Rating      string `json:"rating"`
	Status      string `json:"status"`
	Demographic string `json:"demographic"`
	Year        int    `json:"year"`
	Views       string `json:"views"`
	Favorites   string `json:"favorites"`
	URL         string `json:"url"`
}

// Chapter is a normalized chapter within a manga.
type Chapter struct {
	ID     string `json:"id"`
	Number string `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Date   string `json:"date"`
	// Volume é o agrupamento que o próprio site define (ex.: "Volume 15"), se houver.
	Volume string `json:"volume,omitempty"`
}

// Page is a single image of a chapter.
type Page struct {
	Index int    `json:"index"`
	Total int    `json:"total"`
	Name  string `json:"name"`
	Data  []byte `json:"-"`
}

// ChapterList couples a manga with its chapters (chapters endpoint response).
type ChapterList struct {
	Manga    Manga     `json:"manga"`
	Chapters []Chapter `json:"chapters"`
}
