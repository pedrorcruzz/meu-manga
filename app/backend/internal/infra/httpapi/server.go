package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"meumanga/internal/domain"
	"meumanga/internal/infra/imageconv"
	"meumanga/internal/usecase"
)

// Deps holds everything the HTTP layer serves.
type Deps struct {
	Library   *usecase.Library
	Downloads *usecase.Downloader
	Settings  *usecase.Settings
	Events    *usecase.EventBus
	Previewer *usecase.Previewer
	Session   domain.SessionProvider
	Host      string
	// Gate expõe o bloqueio temporário do site (rate-limit) para o /health.
	Gate *domain.RateGate
	// Probe faz uma requisição real leve para checar se a sessão passa o Cloudflare.
	Probe func(ctx context.Context) bool
	// Quit encerra o programa (backend + frontend), liberando as portas.
	Quit func()
	// Files acessa as páginas já baixadas (preview / apagar).
	Files FileStore
}

// FileStore lista, lê e apaga páginas baixadas de um capítulo.
type FileStore interface {
	ListPages(manga, volume, chapter string) ([]string, error)
	ReadPage(manga, volume, chapter, name string) ([]byte, error)
	DeletePage(manga, volume, chapter, name string) error
	// PageCount conta as páginas no disco sem criar a pasta (para verificação).
	PageCount(manga, volume, chapter string) int
}

// Server exposes the REST + SSE API.
type Server struct {
	deps Deps
	mux  *http.ServeMux
}

// New wires the routes and returns a ready http.Handler.
func New(deps Deps) *Server {
	s := &Server{deps: deps, mux: http.NewServeMux()}
	s.routes()
	return s
}

// Handler returns the CORS-wrapped mux.
func (s *Server) Handler() http.Handler { return withCORS(s.mux) }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.health)
	s.mux.HandleFunc("GET /api/sources", s.sources)
	s.mux.HandleFunc("GET /api/search", s.search)
	s.mux.HandleFunc("GET /api/manga/{source}/{slug}/chapters", s.chapters)
	s.mux.HandleFunc("POST /api/downloads", s.enqueue)
	s.mux.HandleFunc("GET /api/downloads", s.listJobs)
	s.mux.HandleFunc("DELETE /api/downloads", s.clearHistory)
	s.mux.HandleFunc("GET /api/downloads/{id}", s.getJob)
	s.mux.HandleFunc("DELETE /api/downloads/{id}", s.cancelJob)
	s.mux.HandleFunc("POST /api/downloads/{id}/retry", s.retryJob)
	s.mux.HandleFunc("GET /api/downloads/{id}/verify", s.verifyJob)
	s.mux.HandleFunc("POST /api/downloads/{id}/remove", s.removeJob)
	s.mux.HandleFunc("GET /api/settings", s.getSettings)
	s.mux.HandleFunc("PUT /api/settings", s.putSettings)
	s.mux.HandleFunc("POST /api/settings/pick-folder", s.pickFolder)
	s.mux.HandleFunc("POST /api/quit", s.quit)
	s.mux.HandleFunc("GET /api/downloads/{id}/chapters/{idx}/pages", s.listPages)
	s.mux.HandleFunc("GET /api/downloads/{id}/chapters/{idx}/pages/{name}", s.getPage)
	s.mux.HandleFunc("DELETE /api/downloads/{id}/chapters/{idx}/pages/{name}", s.deletePage)
	s.mux.HandleFunc("GET /api/events", s.events)
	s.mux.HandleFunc("POST /api/preview", s.preview)
}

// chapterLoc resolve (título, volume, rótulo do capítulo) de um capítulo de um job.
func (s *Server) chapterLoc(id, idxStr string) (manga, volume, chapter string, ok bool) {
	job, err := s.deps.Downloads.Get(id)
	if err != nil {
		return "", "", "", false
	}
	idx, err := strconv.Atoi(idxStr)
	if err != nil || idx < 0 || idx >= len(job.Tasks) {
		return "", "", "", false
	}
	t := job.Tasks[idx]
	return job.Title, t.Volume, "Cap " + t.Chapter.Number, true
}

func (s *Server) listPages(w http.ResponseWriter, r *http.Request) {
	manga, vol, chap, ok := s.chapterLoc(r.PathValue("id"), r.PathValue("idx"))
	if !ok {
		writeError(w, http.StatusNotFound, "chapter not found")
		return
	}
	names, err := s.deps.Files.ListPages(manga, vol, chap)
	if err != nil {
		writeError(w, http.StatusNotFound, "no pages")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pages": names})
}

func (s *Server) getPage(w http.ResponseWriter, r *http.Request) {
	manga, vol, chap, ok := s.chapterLoc(r.PathValue("id"), r.PathValue("idx"))
	if !ok {
		writeError(w, http.StatusNotFound, "chapter not found")
		return
	}
	data, err := s.deps.Files.ReadPage(manga, vol, chap, r.PathValue("name"))
	if err != nil {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (s *Server) deletePage(w http.ResponseWriter, r *http.Request) {
	manga, vol, chap, ok := s.chapterLoc(r.PathValue("id"), r.PathValue("idx"))
	if !ok {
		writeError(w, http.StatusNotFound, "chapter not found")
		return
	}
	if err := s.deps.Files.DeletePage(manga, vol, chap, r.PathValue("name")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	names, _ := s.deps.Files.ListPages(manga, vol, chap)
	writeJSON(w, http.StatusOK, map[string]any{"pages": names})
}

// quit encerra o programa após responder (o frontend usa isto no "Encerrar").
func (s *Server) quit(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "encerrando"})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	if s.deps.Quit != nil {
		s.deps.Quit()
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	sess, err := s.deps.Session.Session(r.Context(), s.deps.Host)
	hasCookie := err == nil && sess.Valid()
	// valida de verdade: cookie presente E passa numa requisição real
	valid := hasCookie
	if hasCookie && s.deps.Probe != nil {
		valid = s.deps.Probe(r.Context())
	}
	detail := "session ok"
	switch {
	case !hasCookie:
		detail = "open " + s.deps.Host + " in your browser and solve Cloudflare once"
	case !valid:
		detail = "session expired — revisit " + s.deps.Host + " in your browser to refresh Cloudflare"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"session": map[string]any{
			"valid":  valid,
			"source": s.deps.Host,
			"detail": detail,
		},
		"block": s.blockStatus(),
	})
}

// blockStatus descreve o bloqueio temporário ativo (rate-limit do site), ou nil.
// É distinto da sessão Cloudflare: aqui não há desafio a resolver, só esperar.
func (s *Server) blockStatus() any {
	if s.deps.Gate == nil {
		return nil
	}
	be := s.deps.Gate.Blocked(time.Now())
	if be == nil {
		return nil
	}
	return map[string]any{
		"active":  true,
		"until":   be.Until.Format(time.RFC3339),
		"rawTime": be.RawTime,
		"message": be.Error(),
	}
}

func (s *Server) sources(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.deps.Library.Sources())
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	source := def(r.URL.Query().Get("source"), "sakura")
	query := r.URL.Query().Get("q")
	if query == "" {
		writeError(w, http.StatusBadRequest, "missing q")
		return
	}
	res, err := s.deps.Library.Search(r.Context(), source, query)
	if err != nil {
		writeUseErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) chapters(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	slug := r.PathValue("slug")
	res, err := s.deps.Library.Chapters(r.Context(), source, slug)
	if err != nil {
		writeUseErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type volumeDTO struct {
	Name       string           `json:"name"`
	CoverImage string           `json:"coverImage"`
	Chapters   []domain.Chapter `json:"chapters"`
}

type enqueueReq struct {
	Source   string           `json:"source"`
	Slug     string           `json:"slug"`
	Title    string           `json:"title"`
	Order    string           `json:"order"`
	Chapters []domain.Chapter `json:"chapters"`
	Volumes  []volumeDTO      `json:"volumes"`
}

func (s *Server) enqueue(w http.ResponseWriter, r *http.Request) {
	var req enqueueReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	dr := usecase.DownloadRequest{Source: req.Source, Slug: req.Slug, Title: req.Title, Order: req.Order}

	if len(req.Volumes) > 0 {
		for _, v := range req.Volumes {
			if len(v.Chapters) == 0 {
				continue
			}
			cover, err := decodeCover(v.CoverImage)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid cover for "+v.Name)
				return
			}
			dr.Volumes = append(dr.Volumes, usecase.VolumeReq{Name: v.Name, Cover: cover, Chapters: v.Chapters})
		}
	} else if len(req.Chapters) > 0 {
		// modo simples: um volume sem nome (sem subpasta de volume)
		dr.Volumes = []usecase.VolumeReq{{Chapters: req.Chapters}}
	}

	if len(dr.Volumes) == 0 {
		writeError(w, http.StatusBadRequest, "no chapters")
		return
	}
	id, err := s.deps.Downloads.Enqueue(dr)
	if err != nil {
		writeUseErr(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"jobId": id})
}

// decodeCover decodifica um data URL de imagem e converte para JPEG.
func decodeCover(dataURL string) ([]byte, error) {
	if dataURL == "" {
		return nil, nil
	}
	raw := dataURL
	if _, after, found := strings.Cut(dataURL, "base64,"); found {
		raw = after
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}
	return imageconv.ToJPEG(decoded)
}

func (s *Server) listJobs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.deps.Downloads.List())
}

func (s *Server) getJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.deps.Downloads.Get(r.PathValue("id"))
	if err != nil {
		writeUseErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) cancelJob(w http.ResponseWriter, r *http.Request) {
	if err := s.deps.Downloads.Cancel(r.PathValue("id")); err != nil {
		writeUseErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// clearHistory remove de uma vez todos os jobs já finalizados do histórico.
func (s *Server) clearHistory(w http.ResponseWriter, r *http.Request) {
	removed := s.deps.Downloads.ClearHistory()
	writeJSON(w, http.StatusOK, map[string]int{"removed": removed})
}

// retryJob re-enfileira os capítulos que faltaram de um job. Filtros opcionais
// via query: ?volume=<nome> refaz só um volume; ?chapter=<id> refaz só um
// capítulo; ?force=1 inclui capítulos já concluídos (para re-baixar arquivos que
// sumiram da pasta). Sem filtro, refaz todos os não-concluídos.
func (s *Server) retryJob(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := usecase.RetryFilter{
		ByVolume:         q.Has("volume"),
		Volume:           q.Get("volume"),
		ChapterID:        q.Get("chapter"),
		IncludeCompleted: q.Get("force") == "1",
	}
	id, err := s.deps.Downloads.Retry(r.PathValue("id"), filter)
	if err != nil {
		writeUseErr(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"jobId": id})
}

// verifyJob confere, na PASTA REAL escolhida pelo usuário, quantas páginas cada
// capítulo tem de fato. O histórico (SQLite) pode dizer "baixado", mas os
// arquivos podem ter sido movidos/apagados (ex.: transferidos para um SSD
// externo) — aqui devolvemos a verdade do disco para a UI destacar a diferença.
func (s *Server) verifyJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.deps.Downloads.Get(r.PathValue("id"))
	if err != nil {
		writeUseErr(w, err)
		return
	}
	type taskDisk struct {
		ChapterID string `json:"chapterId"`
		Pages     int    `json:"pages"`
		OnDisk    bool   `json:"onDisk"`
	}
	tasks := make([]taskDisk, 0, len(job.Tasks))
	for _, t := range job.Tasks {
		n := s.deps.Files.PageCount(job.Title, t.Volume, "Cap "+t.Chapter.Number)
		tasks = append(tasks, taskDisk{ChapterID: t.Chapter.ID, Pages: n, OnDisk: n > 0})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"root":  s.deps.Settings.DownloadDir(),
		"tasks": tasks,
	})
}

// removeJob apaga um job do histórico (cancela antes, se estiver rodando).
func (s *Server) removeJob(w http.ResponseWriter, r *http.Request) {
	if err := s.deps.Downloads.Remove(r.PathValue("id")); err != nil {
		writeUseErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"downloadDir": s.deps.Settings.DownloadDir()})
}

type settingsReq struct {
	DownloadDir string `json:"downloadDir"`
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var req settingsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DownloadDir == "" {
		writeError(w, http.StatusBadRequest, "invalid downloadDir")
		return
	}
	if err := s.deps.Settings.SetDownloadDir(req.DownloadDir); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"downloadDir": s.deps.Settings.DownloadDir()})
}

func (s *Server) pickFolder(w http.ResponseWriter, r *http.Request) {
	dir, err := s.deps.Settings.PickDownloadDir(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"downloadDir": dir})
}

type previewReq struct {
	Source  string         `json:"source"`
	Chapter domain.Chapter `json:"chapter"`
	Count   int            `json:"count"`
}

func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	var req previewReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Source == "" {
		writeError(w, http.StatusBadRequest, "missing source")
		return
	}
	imgs, err := s.deps.Previewer.Preview(r.Context(), req.Source, req.Chapter, req.Count)
	if err != nil {
		writeUseErr(w, err)
		return
	}
	if imgs == nil {
		imgs = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": imgs})
}

func writeUseErr(w http.ResponseWriter, err error) {
	// bloqueio temporário do site (atividade incomum): 503, distinto do 424 do CF
	if _, ok := domain.AsBlocked(err); ok {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	switch {
	case errors.Is(err, domain.ErrSourceNotFound),
		errors.Is(err, domain.ErrJobNotFound),
		errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, domain.ErrNothingToRetry):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, domain.ErrNoSession):
		writeError(w, http.StatusFailedDependency, err.Error())
	default:
		writeError(w, http.StatusBadGateway, err.Error())
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func def(v, d string) string {
	if v == "" {
		return d
	}
	return v
}
