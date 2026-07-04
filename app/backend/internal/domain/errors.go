package domain

import "errors"

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
)
