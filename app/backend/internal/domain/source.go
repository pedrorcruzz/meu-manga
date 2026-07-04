package domain

import "context"

// SourceInfo identifies a site adapter.
type SourceInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// PageSink receives each downloaded page as its bytes arrive, in order.
// Retorna erro para abortar o download do capítulo.
type PageSink func(page Page) error

// Source is the contract every site adapter implements. The registry holds
// many sources and normalizes their output to these domain types.
type Source interface {
	Info() SourceInfo

	// Search finds works by free-text query.
	Search(ctx context.Context, query string) ([]Manga, error)

	// Chapters lists all chapters of a work identified by its slug.
	Chapters(ctx context.Context, slug string) (ChapterList, error)

	// DownloadChapter streams every page of a chapter to sink, in order.
	DownloadChapter(ctx context.Context, ch Chapter, sink PageSink) error
}
