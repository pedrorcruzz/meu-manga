package config

import (
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Config holds all runtime settings, overridable via environment variables.
type Config struct {
	Addr             string // HTTP listen address
	DownloadDir      string // raiz onde os mangás são salvos
	BrowserBin       string // caminho do Chromium (vazio = rod baixa o seu)
	Headless         bool
	UserAgent        string        // UA que casa com o cookie cf_clearance
	MaxWorkers       int           // downloads de capítulos em paralelo
	DataDir          string        // onde fica o banco do histórico (SQLite)
	ChapterDelay     time.Duration // espera base entre capítulos (throttle anti rate-limit)
	HistoryRetention time.Duration // poda jobs finalizados mais velhos no boot (0 = nunca)
}

const defaultUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
	"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"

// Load builds a Config from defaults + environment overrides.
func Load() Config {
	home, _ := os.UserHomeDir()
	c := Config{
		Addr:             env("MM_ADDR", ":8080"),
		DownloadDir:      env("MM_DOWNLOAD_DIR", filepath.Join(home, "Downloads")),
		BrowserBin:       env("MM_BROWSER_BIN", defaultBrowserBin(home)),
		Headless:         env("MM_HEADLESS", "true") != "false",
		UserAgent:        env("MM_USER_AGENT", defaultUA),
		MaxWorkers:       2,
		DataDir:          env("MM_DATA_DIR", filepath.Join(home, ".meumanga")),
		ChapterDelay:     time.Duration(envInt("MM_CHAPTER_DELAY_MS", 3000)) * time.Millisecond,
		HistoryRetention: time.Duration(envInt("MM_HISTORY_RETENTION_DAYS", 30)) * 24 * time.Hour,
	}
	return c
}

// envInt lê um inteiro de uma variável de ambiente, com fallback.
func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// defaultBrowserBin prefere o Chromium já baixado pelo Playwright, se existir.
func defaultBrowserBin(home string) string {
	p := filepath.Join(home, "Library", "Caches", "ms-playwright",
		"chromium-1228", "chrome-mac-arm64",
		"Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")
	if _, err := os.Stat(p); err == nil {
		return p
	}
	return ""
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
