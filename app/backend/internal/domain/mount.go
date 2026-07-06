package domain

import "time"

// MountVolume é um volume montado pelo usuário na tela da obra, guardado para
// sobreviver a fechar o app. Espelha o Volume do frontend (sem o id local).
type MountVolume struct {
	// Name é o nome editável do volume, ex.: "V001".
	Name string `json:"name"`
	// Label é o rótulo original da fonte, ex.: "Volume 15" (informativo).
	Label string `json:"label,omitempty"`
	// CoverImage é a capa como data URL base64 (vazio = sem capa).
	CoverImage string    `json:"coverImage,omitempty"`
	Chapters   []Chapter `json:"chapters"`
}

// Mount é a montagem de volumes salva de uma obra (chaveada por source+slug).
// É o análogo dos jobs de download: persiste no SQLite e volta ao reabrir o app.
type Mount struct {
	Source    string        `json:"source"`
	Slug      string        `json:"slug"`
	Title     string        `json:"title"`
	ThumbURL  string        `json:"thumbUrl"`
	UpdatedAt time.Time     `json:"updatedAt"`
	Volumes   []MountVolume `json:"volumes"`
}

// MountSummary é a visão enxuta de uma montagem para a lista (sem as capas
// base64, que são pesadas). Usada na tela "Montagens salvas".
type MountSummary struct {
	Source       string    `json:"source"`
	Slug         string    `json:"slug"`
	Title        string    `json:"title"`
	ThumbURL     string    `json:"thumbUrl"`
	UpdatedAt    time.Time `json:"updatedAt"`
	VolumeCount  int       `json:"volumeCount"`
	ChapterCount int       `json:"chapterCount"`
}
