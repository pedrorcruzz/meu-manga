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

// ── Editor "Consertar volumes": árvore lida da pasta em disco ───────────────────

// ChapterNode é um capítulo lido do disco (pasta "Cap N").
type ChapterNode struct {
	Folder    string     `json:"folder"`          // nome da pasta, ex.: "Cap 5"
	Number    string     `json:"number"`          // número, ex.: "5" (de "Cap 5")
	Pages     int        `json:"pages"`           // imagens no disco
	FirstPage string     `json:"firstPage"`       // 1ª imagem (para thumb), "" se vazio
	Cover     *CoverEdit `json:"cover,omitempty"` // edição de capa persistida (nil = original intacta)
}

// CoverEdit é a edição de capa persistida de um capítulo: o formato aplicado
// (para o usuário ver que a capa foi alterada e qual formato foi usado) e se há
// uma capa original guardada para reverter.
type CoverEdit struct {
	Kind        string `json:"kind"`  // "original" | "kindle" | "custom"
	Label       string `json:"label"` // rótulo amigável, ex.: "Kindle … (1264×1680)"
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	HasOriginal bool   `json:"hasOriginal"` // há bytes originais para "voltar ao original"
}

// VolumeNode é um volume lido do disco (subpasta "<manga> <volume>").
type VolumeNode struct {
	Folder   string        `json:"folder"` // nome da subpasta cru
	Name     string        `json:"name"`   // rótulo do volume (prefixo do mangá removido)
	Chapters []ChapterNode `json:"chapters"`
}

// MangaTree é a árvore em disco de uma obra (volumes + capítulos soltos).
type MangaTree struct {
	Manga   string        `json:"manga"`
	Root    string        `json:"root"` // caminho absoluto da pasta do mangá
	Volumes []VolumeNode  `json:"volumes"`
	Loose   []ChapterNode `json:"loose"` // capítulos direto sob o mangá (modo simples)
}

// ── Biblioteca: resumo das obras encontradas na pasta central ───────────────────

// LibraryCover aponta a 1ª página de uma obra (endereçada por nomes de pasta,
// servida por /api/folder/tree/page) para servir de miniatura na biblioteca.
type LibraryCover struct {
	Volume  string `json:"volume"`  // subpasta do volume ("" = capítulo solto)
	Chapter string `json:"chapter"` // nome da pasta do capítulo
	Name    string `json:"name"`    // arquivo da 1ª imagem
}

// LibraryManga resume uma obra encontrada na pasta central (biblioteca): nome,
// caminho absoluto e contagens. Varredura leve — NÃO conta as páginas de cada
// capítulo, só volumes/capítulos e a 1ª página para a miniatura.
type LibraryManga struct {
	Manga    string        `json:"manga"` // nome da pasta da obra
	Path     string        `json:"path"`  // caminho absoluto da pasta da obra
	Volumes  int           `json:"volumes"`
	Chapters int           `json:"chapters"`
	Loose    int           `json:"loose"` // capítulos soltos (modo simples)
	Cover    *LibraryCover `json:"cover,omitempty"`
}
