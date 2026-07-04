package domain

import (
	"sync"
	"time"
)

// RateGate guarda o bloqueio temporário aplicado pelo site. Uma vez "tripado"
// (via BlockedError), todas as operações que passam pelo browser devem parar até
// o horário de liberação — evita insistir e estender a punição do rate-limit.
//
// É seguro para uso concorrente. Um hook de persistência opcional deixa o
// bloqueio sobreviver ao reinício do programa.
type RateGate struct {
	mu      sync.Mutex
	until   time.Time
	raw     string
	persist func(until time.Time, raw string)
}

// SetPersist registra um callback chamado sempre que o bloqueio avança. Usado
// para salvar a janela no store (SQLite) e restaurá-la no próximo boot.
func (g *RateGate) SetPersist(fn func(until time.Time, raw string)) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.persist = fn
}

// Trip registra (ou estende) a janela de bloqueio. Só avança para frente: um
// horário anterior ao já conhecido é ignorado.
func (g *RateGate) Trip(until time.Time, raw string) {
	g.mu.Lock()
	if until.After(g.until) {
		g.until = until
		g.raw = raw
	}
	fn, u, r := g.persist, g.until, g.raw
	g.mu.Unlock()
	if fn != nil {
		fn(u, r)
	}
}

// Blocked devolve o BlockedError ativo se `now` ainda estiver dentro da janela,
// ou nil se o acesso já foi liberado.
func (g *RateGate) Blocked(now time.Time) *BlockedError {
	g.mu.Lock()
	defer g.mu.Unlock()
	if now.Before(g.until) {
		return &BlockedError{Until: g.until, RawTime: g.raw}
	}
	return nil
}

// Record tripa a gate se err (ou algum erro encapsulado) for um BlockedError, e
// devolve o próprio err para compor em `return x, gate.Record(err)`.
func (g *RateGate) Record(err error) error {
	if be, ok := AsBlocked(err); ok {
		g.Trip(be.Until, be.RawTime)
	}
	return err
}
