package domain

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	// ErrSourceNotFound is returned when a source id is unknown to the registry.
	ErrSourceNotFound = errors.New("source not found")
	// ErrJobNotFound is returned when a job id is unknown.
	ErrJobNotFound = errors.New("job not found")
	// ErrNoSession is returned when no valid browser session is available.
	ErrNoSession = errors.New("no valid Cloudflare session; open the site in your browser and solve the challenge once")
	// ErrNotFound is a generic not-found from a source (unknown manga/chapter).
	ErrNotFound = errors.New("not found")
	// ErrReaderCaptcha means the reader demanded a captcha (anti-bot); user must
	// open the chapter in their browser and solve it, then retry.
	ErrReaderCaptcha = errors.New("captcha do leitor — abra o capítulo no Navegador, resolva o desafio e tente de novo")
	// ErrNoPages means a chapter yielded zero pages (blocked or empty).
	ErrNoPages = errors.New("nenhuma página capturada (leitor bloqueado?)")
	// ErrNothingToRetry means a job has no pending chapters left to redo.
	ErrNothingToRetry = errors.New("nada para refazer — todos os capítulos já foram baixados")
	// ErrChapterExists means a move/rename target folder already holds that chapter.
	ErrChapterExists = errors.New("já existe um capítulo com esse número no destino")
	// ErrEditBusy means the manga has a download running/queued, so editing its
	// folder on disk would race with the writer. The user should wait it out.
	ErrEditBusy = errors.New("há um download em andamento para esta obra — aguarde terminar para consertar os volumes")
	// ErrNoCover means a cover removal was requested but the chapter has no pages.
	ErrNoCover = errors.New("este volume não tem capa para remover")
	// ErrBadOrder means a page reorder request didn't match the chapter's pages
	// on disk (wrong count, unknown/duplicate filename).
	ErrBadOrder = errors.New("ordem de páginas inválida")
)

// blockPrefix é o prefixo estável da mensagem de bloqueio temporário. O frontend
// casa por ele para exibir o aviso dedicado (distinto do Cloudflare).
const blockPrefix = "bloqueio temporário do site"

// BlockedError sinaliza que o site aplicou um bloqueio temporário por
// "atividade incomum na rede" (rate-limit anti-abuso, distinto do Cloudflare).
// Não é um desafio a resolver: o acesso só volta no horário Until.
type BlockedError struct {
	Until   time.Time // instante em que o acesso volta
	RawTime string    // horário como o site exibe, ex.: "22:14 GMT-3"
}

// Error implementa error com uma mensagem clara em pt-BR incluindo o horário.
func (e *BlockedError) Error() string {
	if e.RawTime != "" {
		return fmt.Sprintf("%s — o Sakura detectou muitos acessos vindos da sua rede; "+
			"tente novamente após %s", blockPrefix, e.RawTime)
	}
	return blockPrefix + " — o Sakura detectou muitos acessos vindos da sua rede; tente novamente mais tarde"
}

// AsBlocked reporta se err (ou algum erro encapsulado) é um BlockedError.
func AsBlocked(err error) (*BlockedError, bool) {
	var be *BlockedError
	if errors.As(err, &be) {
		return be, true
	}
	return nil, false
}

// blockSignature é o texto que identifica a página de bloqueio do Sakura.
const blockSignature = "atividade incomum"

// blockTimeRe captura o horário de liberação ("22:14 GMT-3", GMT opcional).
var blockTimeRe = regexp.MustCompile(`(\d{1,2}):(\d{2})\s*(GMT[+-]?\d+)?`)

// blockDefaultCooldown é a janela usada quando a página bloqueia mas não informa
// um horário legível.
const blockDefaultCooldown = 15 * time.Minute

// ParseBlock inspeciona o texto visível de uma página e, se for a tela de
// bloqueio por atividade incomum, devolve o BlockedError com o horário de
// liberação já resolvido em um instante absoluto. Devolve nil caso contrário.
// `now` é injetado para manter a função determinística nos testes.
func ParseBlock(text string, now time.Time) *BlockedError {
	lower := strings.ToLower(text)
	if !strings.Contains(lower, blockSignature) {
		return nil
	}
	loc := time.FixedZone("GMT-3", -3*60*60)
	m := blockTimeRe.FindStringSubmatch(text)
	if m == nil {
		return &BlockedError{Until: now.Add(blockDefaultCooldown)}
	}
	hh, _ := strconv.Atoi(m[1])
	mm, _ := strconv.Atoi(m[2])
	if hh > 23 || mm > 59 {
		return &BlockedError{Until: now.Add(blockDefaultCooldown)}
	}
	zone := m[3]
	if zone == "" {
		zone = "GMT-3"
	}
	nowLoc := now.In(loc)
	cand := time.Date(nowLoc.Year(), nowLoc.Month(), nowLoc.Day(), hh, mm, 0, 0, loc)
	// horário já passou hoje → é a liberação de amanhã (cruzou a meia-noite)
	if !cand.After(nowLoc) {
		cand = cand.Add(24 * time.Hour)
	}
	return &BlockedError{
		Until:   cand,
		RawTime: fmt.Sprintf("%02d:%02d %s", hh, mm, zone),
	}
}
