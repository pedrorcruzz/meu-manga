package registry

import (
	"sync"

	"meumanga/internal/domain"
)

// Registry holds the site adapters and exposes them by id, normalized.
type Registry struct {
	mu      sync.RWMutex
	sources map[string]domain.Source
	order   []string
}

// New builds an empty registry.
func New() *Registry {
	return &Registry{sources: map[string]domain.Source{}}
}

// Register adds a source; later registrations override the same id.
func (r *Registry) Register(s domain.Source) {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := s.Info().ID
	if _, exists := r.sources[id]; !exists {
		r.order = append(r.order, id)
	}
	r.sources[id] = s
}

// Get returns the source with id or domain.ErrSourceNotFound.
func (r *Registry) Get(id string) (domain.Source, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.sources[id]
	if !ok {
		return nil, domain.ErrSourceNotFound
	}
	return s, nil
}

// List returns every registered source in registration order.
func (r *Registry) List() []domain.SourceInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]domain.SourceInfo, 0, len(r.order))
	for _, id := range r.order {
		out = append(out, r.sources[id].Info())
	}
	return out
}
