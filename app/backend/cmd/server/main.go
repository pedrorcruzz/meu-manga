package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"meumanga/internal/adapter/registry"
	"meumanga/internal/adapter/sakura"
	"meumanga/internal/config"
	"meumanga/internal/domain"
	"meumanga/internal/infra/browser"
	"meumanga/internal/infra/cookies"
	"meumanga/internal/infra/dialog"
	"meumanga/internal/infra/httpapi"
	"meumanga/internal/infra/httpclient"
	"meumanga/internal/infra/jobstore"
	"meumanga/internal/infra/storage"
	"meumanga/internal/usecase"
)

func main() {
	cfg := config.Load()

	// sessão Cloudflare reaproveitada do navegador real do usuário (auto-detecta
	// qual Chromium — Dia, Chrome, Brave, Edge… — tem o cookie do Sakura)
	home, _ := os.UserHomeDir()
	session := cookies.New(cookies.DefaultBrowsers(home), cfg.UserAgent)

	// motor de browser headless (capítulos + download)
	engine := browser.NewEngine(cfg.BrowserBin, cfg.Headless, session)
	defer engine.Close()

	openPage := func(ctx context.Context, host string) (sakura.Page, error) {
		p, err := engine.Open(ctx, host)
		if err != nil {
			return nil, err
		}
		return p, nil
	}

	// cliente HTTP com fingerprint de Chrome (busca)
	client, err := httpclient.New(sakura.Host, session)
	if err != nil {
		log.Fatalf("http client: %v", err)
	}

	reg := registry.New()
	reg.Register(sakura.New(client, openPage))

	store := storage.New(cfg.DownloadDir)
	if err := store.SetRoot(cfg.DownloadDir); err != nil {
		log.Fatalf("download dir: %v", err)
	}

	// histórico persistente (SQLite) — sobrevive a fechar o app
	history, err := jobstore.Open(filepath.Join(cfg.DataDir, "meumanga.db"))
	if err != nil {
		log.Fatalf("job store: %v", err)
	}
	defer history.Close()

	// gate do bloqueio temporário (rate-limit do site), persistida no histórico
	gate := &domain.RateGate{}
	gate.SetPersist(func(until time.Time, raw string) { _ = history.SaveBlock(until, raw) })
	if until, raw, err := history.LoadBlock(); err == nil && !until.IsZero() {
		gate.Trip(until, raw)
	}

	bus := usecase.NewEventBus()
	library := usecase.NewLibrary(reg)
	library.SetGate(gate)
	downloader := usecase.NewDownloader(reg, store, bus,
		usecase.WithRepo(history),
		usecase.WithGate(gate),
		usecase.WithChapterDelay(cfg.ChapterDelay),
		usecase.WithRetention(cfg.HistoryRetention))
	settings := usecase.NewSettings(store, dialog.New(), history)
	// reaplica a pasta de download escolhida pelo usuário e persistida no SQLite
	// (sobrepõe o padrão do config), para sobreviver a fechar/reabrir o app
	settings.RestoreDownloadDir()
	// editor "Consertar volumes": lê/edita a pasta em disco (mesmo store), com
	// guard contra corrida com downloads em andamento (via o registro de jobs).
	editor := usecase.NewMangaEditor(store, downloader, history)
	// editor "Consertar da pasta": mesma lógica folder-first, mas sobre uma pasta
	// de mangá escolhida em qualquer lugar do disco (ex.: obra já movida para um
	// SSD externo). Cada operação usa um store efêmero enraizado no pai da pasta.
	folderEditor := usecase.NewFolderEditor(func(root string) usecase.EditStore {
		return storage.New(root)
	}, downloader, history)

	// sonda leve: bate no endpoint de busca e confere 200 (sessão realmente passa o CF)
	probe := func(ctx context.Context) bool {
		_, status, err := client.Get(ctx, "https://"+sakura.Host+"/dist/sakura/global/sidebar/sidebar.core.php?q=a")
		return err == nil && status == 200
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// quit: encerra o frontend (dev e produção) e o próprio backend, liberando as portas
	quit := func() {
		go func() {
			time.Sleep(200 * time.Millisecond)
			// dev (vite/bun) e produção (node .output/server) — por padrão de processo
			for _, pat := range []string{"vite dev", "bun run dev", ".output/server"} {
				_ = exec.Command("pkill", "-f", pat).Run()
			}
			// fallback confiável: mata quem estiver ocupando a porta 3000 (frontend)
			if out, err := exec.Command("lsof", "-ti", "tcp:3000").Output(); err == nil {
				for _, pid := range strings.Fields(string(out)) {
					_ = exec.Command("kill", pid).Run()
				}
			}
			stop <- syscall.SIGTERM
		}()
	}

	server := httpapi.New(httpapi.Deps{
		Library:   library,
		Downloads: downloader,
		Settings:  settings,
		Events:    bus,
		Session:   session,
		Host:      sakura.Host,
		Gate:      gate,
		Probe:     probe,
		Quit:      quit,
		Files:        store,
		Editor:       editor,
		FolderEditor: folderEditor,
		Mounts:       history,
	})

	srv := &http.Server{Addr: cfg.Addr, Handler: server.Handler()}

	go func() {
		log.Printf("meu-manga backend on %s (downloads -> %s)", cfg.Addr, store.Root())
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	log.Println("bye")
}
