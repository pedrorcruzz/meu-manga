package usecase

import (
	"context"
	"time"

	"meumanga/internal/domain"
)

// SourceRegistry is the subset of the registry the library needs.
type SourceRegistry interface {
	Get(id string) (domain.Source, error)
	List() []domain.SourceInfo
}

// Library exposes search and chapter listing across all sources.
type Library struct {
	reg  SourceRegistry
	gate *domain.RateGate // nil = sem gate de rate-limit
}

// NewLibrary builds a Library over the given registry.
func NewLibrary(reg SourceRegistry) *Library {
	return &Library{reg: reg}
}

// SetGate liga a Library ao RateGate compartilhado: listar capítulos é barrado
// durante um bloqueio temporário, e um BlockedError vindo do source o tripa.
func (l *Library) SetGate(g *domain.RateGate) { l.gate = g }

// Sources lists the available site adapters.
func (l *Library) Sources() []domain.SourceInfo {
	return l.reg.List()
}

// Search runs a query against one source.
func (l *Library) Search(ctx context.Context, source, query string) ([]domain.Manga, error) {
	s, err := l.reg.Get(source)
	if err != nil {
		return nil, err
	}
	return s.Search(ctx, query)
}

// Chapters lists the chapters of a work in one source.
func (l *Library) Chapters(ctx context.Context, source, slug string) (domain.ChapterList, error) {
	if l.gate != nil {
		if be := l.gate.Blocked(time.Now()); be != nil {
			return domain.ChapterList{}, be
		}
	}
	s, err := l.reg.Get(source)
	if err != nil {
		return domain.ChapterList{}, err
	}
	cl, err := s.Chapters(ctx, slug)
	if l.gate != nil {
		err = l.gate.Record(err)
	}
	return cl, err
}
