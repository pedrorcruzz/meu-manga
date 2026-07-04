package browser

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"time"

	"meumanga/internal/domain"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/input"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

// Engine owns a single long-lived headless Chromium and injects the reused
// Cloudflare session so the site's own JS defeats its anti-scraping.
type Engine struct {
	bin      string
	headless bool
	session  domain.SessionProvider

	mu      sync.Mutex
	browser *rod.Browser
}

// NewEngine builds an Engine; the browser is launched lazily on first use.
func NewEngine(bin string, headless bool, session domain.SessionProvider) *Engine {
	return &Engine{bin: bin, headless: headless, session: session}
}

// Close releases the browser process.
func (e *Engine) Close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.browser != nil {
		_ = e.browser.Close()
		e.browser = nil
	}
}

func (e *Engine) ensure() (*rod.Browser, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.browser != nil {
		return e.browser, nil
	}
	l := launcher.New().Headless(e.headless).Leakless(false).
		Set("disable-blink-features", "AutomationControlled")
	if e.bin != "" {
		l = l.Bin(e.bin)
	}
	u, err := l.Launch()
	if err != nil {
		return nil, fmt.Errorf("launch browser: %w", err)
	}
	b := rod.New().ControlURL(u)
	if err := b.Connect(); err != nil {
		return nil, fmt.Errorf("connect browser: %w", err)
	}
	e.browser = b
	return b, nil
}

// Open creates a page for host with the reused session (cookies + UA) applied.
func (e *Engine) Open(ctx context.Context, host string) (*Page, error) {
	sess, err := e.session.Session(ctx, host)
	if err != nil {
		return nil, err
	}
	b, err := e.ensure()
	if err != nil {
		return nil, err
	}
	if err := injectCookies(b, host, sess.Cookies); err != nil {
		return nil, err
	}
	rp, err := b.Page(proto.TargetCreateTarget{})
	if err != nil {
		return nil, err
	}
	rp = rp.Context(ctx)
	if err := rp.SetUserAgent(&proto.NetworkSetUserAgentOverride{
		UserAgent: sess.UserAgent, AcceptLanguage: "pt-BR",
	}); err != nil {
		return nil, err
	}
	return &Page{rod: rp}, nil
}

func injectCookies(b *rod.Browser, host string, cookies map[string]string) error {
	var params []*proto.NetworkCookieParam
	for name, value := range cookies {
		domainName := host
		if name == "cf_clearance" {
			domainName = "." + host
		}
		params = append(params, &proto.NetworkCookieParam{
			Name: name, Value: value, Domain: domainName, Path: "/",
		})
	}
	return b.SetCookies(params)
}

// Page wraps a rod page with the helpers the adapters need.
type Page struct {
	rod *rod.Page
}

// Close disposes the page.
func (p *Page) Close() { _ = p.rod.Close() }

var challengeTitle = []string{"just a moment", "um momento", "attention required", "checking"}

// Goto navigates and waits until the Cloudflare interstitial is gone.
func (p *Page) Goto(ctx context.Context, url string) error {
	if err := p.rod.Navigate(url); err != nil {
		return err
	}
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		info, err := p.rod.Info()
		if err == nil {
			t := strings.ToLower(info.Title)
			if t != "" && t != "about:blank" && !anyContains(t, challengeTitle) {
				return nil
			}
		}
		time.Sleep(time.Second)
	}
	return fmt.Errorf("cloudflare challenge did not clear for %s", url)
}

// Scroll scrolls the page down to trigger lazy loading.
func (p *Page) Scroll() { _ = p.rod.Mouse.Scroll(0, 3000, 3) }

// FetchImage busca um recurso pelo contexto da página (cookies + sessão do leitor).
// Usado no gap-fill direcionado das páginas que falharam na navegação.
func (p *Page) FetchImage(url string) ([]byte, error) { return p.rod.GetResource(url) }

// Eval runs a JS expression and returns its JSON-encoded result.
func (p *Page) Eval(js string) (string, error) {
	res, err := p.rod.Eval(js)
	if err != nil {
		return "", err
	}
	return res.Value.JSON("", ""), nil
}

// CaptureImages navega até chapterURL e intercepta, no estágio de resposta, toda
// imagem cuja URL contenha urlContains, entregando os bytes a onImage em ordem de
// chegada. Rola a página até nenhuma imagem nova aparecer por `idle`.
func (p *Page) CaptureImages(
	ctx context.Context,
	chapterURL, urlContains string,
	idle time.Duration,
	onImage func(url string, data []byte) error,
) error {
	// desabilita o cache: garante que o passe pra trás RE-BUSQUE cada página da rede
	// (páginas que falharam e voltaram HTML no 1º passe são refeitas de verdade).
	_ = proto.NetworkEnable{}.Call(p.rod)
	_ = proto.NetworkSetCacheDisabled{CacheDisabled: true}.Call(p.rod)

	if err := (proto.FetchEnable{Patterns: []*proto.FetchRequestPattern{
		{URLPattern: "*" + urlContains + "*", RequestStage: proto.FetchRequestStageResponse},
		{URLPattern: "*capitulos*read*", RequestStage: proto.FetchRequestStageResponse},
	}}).Call(p.rod); err != nil {
		return err
	}
	defer proto.FetchDisable{}.Call(p.rod)

	var mu sync.Mutex
	last := time.Now()
	var handlerErr error
	captcha := false

	stop := p.rod.EachEvent(func(e *proto.FetchRequestPaused) {
		u := e.Request.URL
		switch {
		case strings.Contains(u, urlContains):
			data, err := fetchBody(p.rod, e.RequestID)
			if err == nil {
				if cbErr := onImage(u, data); cbErr != nil {
					mu.Lock()
					handlerErr = cbErr
					mu.Unlock()
				}
				mu.Lock()
				last = time.Now()
				mu.Unlock()
			}
		case strings.Contains(u, "read"):
			// read.php gate: detecta a parede de captcha do leitor
			if body, err := (proto.FetchGetResponseBody{RequestID: e.RequestID}).Call(p.rod); err == nil {
				raw := body.Body
				dec, _ := base64.StdEncoding.DecodeString(raw)
				if strings.Contains(raw, "captcha_required") || strings.Contains(string(dec), "captcha_required") {
					mu.Lock()
					captcha = true
					mu.Unlock()
				}
			}
		}
		_ = proto.FetchContinueRequest{RequestID: e.RequestID}.Call(p.rod)
	})
	go stop()

	if err := p.Goto(ctx, chapterURL); err != nil {
		return err
	}
	time.Sleep(3 * time.Second) // deixa o leitor montar

	// força o modo de leitura OCIDENTAL (esquerda→direita) para que ArrowRight
	// sempre AVANCE — em Oriental (RTL) a seta direita voltaria, travando no início.
	_, _ = p.rod.Eval(`() => { const b = Array.from(document.querySelectorAll('button')).find(e => /ocidental/i.test(e.textContent||'')); if (b) b.click(); return true; }`)
	time.Sleep(500 * time.Millisecond)

	// foca o centro do leitor para receber as teclas
	_ = p.rod.Mouse.MoveTo(proto.Point{X: 640, Y: 450})
	_ = p.rod.Mouse.Click(proto.InputMouseButtonLeft, 1)

	// O leitor do Sakura libera cada página só quando o usuário AVANÇA. Fazemos uma
	// varredura para FRENTE (ArrowRight, carrega a maioria) e outra para TRÁS
	// (ArrowLeft, re-exibe cada página e captura as que falharam no passe rápido).
	// Cada varredura para quando nenhuma página nova chega por `idle`.
	deadline := time.Now().Add(8 * time.Minute)
	sweep := func(key input.Key, clickX float64) error {
		mu.Lock()
		last = time.Now() // reseta o idle para esta varredura
		mu.Unlock()
		tick := 0
		for time.Now().Before(deadline) {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			mu.Lock()
			quiet := time.Since(last)
			hErr := handlerErr
			cap := captcha
			mu.Unlock()
			if hErr != nil {
				return hErr
			}
			if cap {
				return domain.ErrReaderCaptcha
			}
			if quiet > idle {
				return nil
			}
			_ = p.rod.Keyboard.Type(key)
			if clickX > 0 && tick%6 == 5 {
				_ = p.rod.Mouse.MoveTo(proto.Point{X: clickX, Y: 450})
				_ = p.rod.Mouse.Click(proto.InputMouseButtonLeft, 1)
			}
			tick++
			time.Sleep(400 * time.Millisecond)
		}
		return nil
	}
	if err := sweep(input.ArrowRight, 1040); err != nil {
		return err
	}
	return sweep(input.ArrowLeft, 0)
}

func fetchBody(page *rod.Page, id proto.FetchRequestID) ([]byte, error) {
	body, err := proto.FetchGetResponseBody{RequestID: id}.Call(page)
	if err != nil {
		return nil, err
	}
	if body.Base64Encoded {
		return base64.StdEncoding.DecodeString(body.Body)
	}
	return []byte(body.Body), nil
}

func anyContains(s string, subs []string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
