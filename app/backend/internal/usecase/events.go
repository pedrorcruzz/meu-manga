package usecase

import (
	"sync"

	"meumanga/internal/domain"
)

// EventBus is a simple in-memory fan-out of download events to SSE subscribers.
type EventBus struct {
	mu   sync.RWMutex
	subs map[int]chan domain.Event
	next int
}

// NewEventBus builds an empty bus.
func NewEventBus() *EventBus {
	return &EventBus{subs: map[int]chan domain.Event{}}
}

// Subscribe registers a listener and returns its channel plus an unsubscribe fn.
func (b *EventBus) Subscribe() (<-chan domain.Event, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.next
	b.next++
	ch := make(chan domain.Event, 64)
	b.subs[id] = ch
	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if c, ok := b.subs[id]; ok {
			close(c)
			delete(b.subs, id)
		}
	}
}

// Publish delivers an event to all subscribers, dropping on slow consumers.
func (b *EventBus) Publish(e domain.Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subs {
		select {
		case ch <- e:
		default: // não bloqueia se o consumidor estiver lento
		}
	}
}
