package usecase

import (
	"context"
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"sync"
	"time"

	"meumanga/internal/domain"
)

// PageSaver persists a single chapter page to storage.
type PageSaver interface {
	SavePage(manga, volume, chapter, name string, data []byte) error
}

// JobRepo persists jobs (the history) and the active block window so both
// survive restarting the app. All methods are optional in tests (nil repo =
// in-memory only).
type JobRepo interface {
	SaveJob(job domain.Job) error
	DeleteJob(id string) error
	LoadJobs() ([]domain.Job, error)
}

// VolumeReq is one volume of a download request (cover já convertida para JPEG).
type VolumeReq struct {
	Name     string
	Cover    []byte
	Chapters []domain.Chapter
}

// DownloadRequest describes a batch download; modo simples = 1 volume sem nome.
type DownloadRequest struct {
	Source  string
	Slug    string
	Title   string
	Order   string
	Volumes []VolumeReq
}

// Downloader runs batch chapter downloads as background jobs and emits progress.
type Downloader struct {
	reg   SourceRegistry
	store PageSaver
	bus   *EventBus

	gate      *domain.RateGate     // nil = sem gate de rate-limit
	repo      JobRepo              // nil = histórico só em memória
	now       func() time.Time     // injetável para testes
	delay     func() time.Duration // espera entre capítulos (throttle)
	retention time.Duration        // poda jobs finalizados mais velhos (0 = nunca)

	mu      sync.Mutex
	jobs    map[string]*domain.Job
	cancels map[string]context.CancelFunc
	seq     int
}

// Option configura um Downloader na construção.
type Option func(*Downloader)

// WithGate liga o Downloader a um RateGate: novas tentativas são barradas
// enquanto o bloqueio temporário estiver ativo, e um BlockedError vindo do
// source tripa a gate.
func WithGate(g *domain.RateGate) Option { return func(d *Downloader) { d.gate = g } }

// WithRepo liga o Downloader a um repositório persistente (histórico).
func WithRepo(r JobRepo) Option { return func(d *Downloader) { d.repo = r } }

// WithClock injeta um relógio (testes).
func WithClock(fn func() time.Time) Option { return func(d *Downloader) { d.now = fn } }

// WithRetention poda automaticamente, no boot, jobs finalizados mais velhos que
// `d`. Zero desativa a poda (mantém o histórico para sempre).
func WithRetention(d time.Duration) Option {
	return func(dl *Downloader) { dl.retention = d }
}

// WithChapterDelay adiciona uma espera (com jitter) entre capítulos, para ir
// mais devagar e reduzir o risco de disparar o rate-limit do site.
func WithChapterDelay(base time.Duration) Option {
	return func(d *Downloader) {
		if base <= 0 {
			return
		}
		d.delay = func() time.Duration {
			return base + time.Duration(rand.Int63n(int64(base/2)+1))
		}
	}
}

// NewDownloader builds a Downloader. Extra behaviour (gate, persistence,
// throttle) é ligada via Option.
func NewDownloader(reg SourceRegistry, store PageSaver, bus *EventBus, opts ...Option) *Downloader {
	d := &Downloader{
		reg:     reg,
		store:   store,
		bus:     bus,
		now:     time.Now,
		delay:   func() time.Duration { return 0 },
		jobs:    map[string]*domain.Job{},
		cancels: map[string]context.CancelFunc{},
	}
	for _, o := range opts {
		o(d)
	}
	d.loadHistory()
	return d
}

// loadHistory restaura os jobs persistidos. Jobs que estavam "rodando" quando o
// app fechou são rebaixados para failed (não há goroutine viva), deixando claro
// no histórico o que ficou pela metade para o usuário refazer.
func (d *Downloader) loadHistory() {
	if d.repo == nil {
		return
	}
	jobs, err := d.repo.LoadJobs()
	if err != nil {
		return
	}
	var cutoff time.Time
	if d.retention > 0 {
		cutoff = d.now().Add(-d.retention)
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	for i := range jobs {
		j := jobs[i]
		normalizeInterrupted(&j)
		// poda jobs antigos: some do histórico (os arquivos no disco ficam)
		if !cutoff.IsZero() && !j.CreatedAt.IsZero() && j.CreatedAt.Before(cutoff) {
			if d.repo != nil {
				_ = d.repo.DeleteJob(j.ID)
			}
			if n := seqOf(j.ID); n > d.seq {
				d.seq = n // ainda avança o seq para não reusar ids
			}
			continue
		}
		d.jobs[j.ID] = &j
		if n := seqOf(j.ID); n > d.seq {
			d.seq = n
		}
	}
}

// ClearHistory remove do histórico todos os jobs já finalizados
// (concluídos/falhos/cancelados), preservando os que estão rodando ou na fila.
// Os arquivos já baixados no disco não são tocados. Devolve quantos removeu.
func (d *Downloader) ClearHistory() int {
	d.mu.Lock()
	var ids []string
	for id, j := range d.jobs {
		if j.Status == domain.StatusRunning || j.Status == domain.StatusQueued {
			continue
		}
		ids = append(ids, id)
	}
	for _, id := range ids {
		delete(d.jobs, id)
		delete(d.cancels, id)
	}
	d.mu.Unlock()
	if d.repo != nil {
		for _, id := range ids {
			_ = d.repo.DeleteJob(id)
		}
	}
	return len(ids)
}

// normalizeInterrupted rebaixa estados "vivos" que não sobrevivem ao restart.
func normalizeInterrupted(j *domain.Job) {
	for i := range j.Tasks {
		if j.Tasks[i].Status == domain.StatusRunning || j.Tasks[i].Status == domain.StatusQueued {
			j.Tasks[i].Status = domain.StatusFailed
			if j.Tasks[i].Error == "" {
				j.Tasks[i].Error = "interrompido ao fechar o app — refaça este capítulo"
			}
		}
	}
	if j.Status == domain.StatusRunning || j.Status == domain.StatusQueued {
		j.Status = domain.StatusFailed
	}
}

// seqOf extrai N de um id "job-N" (0 se não casar).
func seqOf(id string) int {
	if n, err := strconv.Atoi(strings.TrimPrefix(id, "job-")); err == nil {
		return n
	}
	return 0
}

// Enqueue registers a job and starts running it in the background.
func (d *Downloader) Enqueue(req DownloadRequest) (string, error) {
	src, err := d.reg.Get(req.Source)
	if err != nil {
		return "", err
	}
	// barra a fila se o site nos bloqueou temporariamente
	if d.gate != nil {
		if be := d.gate.Blocked(d.now()); be != nil {
			return "", be
		}
	}
	d.mu.Lock()
	d.seq++
	id := "job-" + strconv.Itoa(d.seq)
	var tasks []domain.ChapterTask
	for _, v := range req.Volumes {
		for j, ch := range v.Chapters {
			t := domain.ChapterTask{Chapter: ch, Volume: v.Name, Status: domain.StatusQueued}
			if j == 0 {
				t.Cover = v.Cover // capa só no 1º capítulo do volume
			}
			tasks = append(tasks, t)
		}
	}
	job := &domain.Job{
		ID: id, Source: req.Source, Slug: req.Slug, Title: req.Title,
		Status: domain.StatusQueued, Tasks: tasks, TotalChapters: len(tasks),
		CreatedAt: d.now(),
	}
	d.jobs[id] = job
	ctx, cancel := context.WithCancel(context.Background())
	d.cancels[id] = cancel
	d.mu.Unlock()

	d.persist(id)
	go d.run(ctx, src, job)
	return id, nil
}

// Retry re-enfileira apenas os capítulos ainda não concluídos de um job,
// preservando a capa de volume quando o capítulo que a carregava também falhou.
// Devolve o id do novo job.
func (d *Downloader) Retry(id string) (string, error) {
	job, err := d.Get(id)
	if err != nil {
		return "", err
	}
	req := DownloadRequest{Source: job.Source, Slug: job.Slug, Title: job.Title}
	volIdx := map[string]int{} // nome do volume → índice em req.Volumes
	for _, t := range job.Tasks {
		if t.Status == domain.StatusCompleted {
			continue
		}
		vi, ok := volIdx[t.Volume]
		if !ok {
			req.Volumes = append(req.Volumes, VolumeReq{Name: t.Volume, Cover: t.Cover})
			vi = len(req.Volumes) - 1
			volIdx[t.Volume] = vi
		}
		req.Volumes[vi].Chapters = append(req.Volumes[vi].Chapters, t.Chapter)
	}
	if len(req.Volumes) == 0 {
		return "", domain.ErrNothingToRetry
	}
	return d.Enqueue(req)
}

// Remove tira um job do histórico (cancelando-o antes, se estiver rodando).
func (d *Downloader) Remove(id string) error {
	d.mu.Lock()
	if _, ok := d.jobs[id]; !ok {
		d.mu.Unlock()
		return domain.ErrJobNotFound
	}
	if cancel := d.cancels[id]; cancel != nil {
		cancel()
	}
	delete(d.jobs, id)
	delete(d.cancels, id)
	d.mu.Unlock()
	if d.repo != nil {
		_ = d.repo.DeleteJob(id)
	}
	return nil
}

func (d *Downloader) run(ctx context.Context, src domain.Source, job *domain.Job) {
	d.setJobStatus(job.ID, domain.StatusRunning)
	failed := false
	for i := range job.Tasks {
		if ctx.Err() != nil {
			d.setTaskStatus(job.ID, i, domain.StatusCanceled, "")
			d.persist(job.ID)
			continue
		}
		// bloqueio temporário ativo: falha o restante rápido, sem martelar o site
		if d.gate != nil {
			if be := d.gate.Blocked(d.now()); be != nil {
				failed = true
				d.setTaskStatus(job.ID, i, domain.StatusFailed, be.Error())
				d.persist(job.ID)
				d.bus.Publish(domain.Event{Type: domain.EventError, JobID: job.ID,
					ChapterNumber: job.Tasks[i].Chapter.Number, Message: be.Error()})
				continue
			}
		}
		if i > 0 {
			d.throttle(ctx) // vai mais devagar entre capítulos
		}
		if err := d.runChapter(ctx, src, job, i); err != nil {
			if d.gate != nil {
				d.gate.Record(err) // tripa a gate se for BlockedError
			}
			failed = true
			d.setTaskStatus(job.ID, i, domain.StatusFailed, err.Error())
			d.persist(job.ID)
			d.bus.Publish(domain.Event{Type: domain.EventError, JobID: job.ID,
				ChapterNumber: job.Tasks[i].Chapter.Number, Message: err.Error()})
			continue
		}
		d.markChapterDone(job.ID, i)
		d.persist(job.ID)
		d.bus.Publish(domain.Event{Type: domain.EventChapterDone, JobID: job.ID,
			ChapterNumber: job.Tasks[i].Chapter.Number})
	}
	final := domain.StatusCompleted
	if ctx.Err() != nil {
		final = domain.StatusCanceled
	} else if failed {
		final = domain.StatusFailed
	}
	d.setJobStatus(job.ID, final)
	d.persist(job.ID)
	d.bus.Publish(domain.Event{Type: domain.EventJobDone, JobID: job.ID, Status: final})
}

// throttle dorme d.delay() respeitando o cancelamento do contexto.
func (d *Downloader) throttle(ctx context.Context) {
	dur := d.delay()
	if dur <= 0 {
		return
	}
	t := time.NewTimer(dur)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

func (d *Downloader) runChapter(ctx context.Context, src domain.Source, job *domain.Job, i int) error {
	task := job.Tasks[i]
	ch := task.Chapter
	d.setTaskStatus(job.ID, i, domain.StatusRunning, "")
	d.persist(job.ID)
	chapterLabel := fmt.Sprintf("Cap %s", ch.Number)

	// capa do volume: entra como 001.jpg e empurra as páginas em +1
	shift := 0
	if len(task.Cover) > 0 {
		if err := d.store.SavePage(job.Title, task.Volume, chapterLabel, "001.jpg", task.Cover); err != nil {
			return err
		}
		shift = 1
	}

	return src.DownloadChapter(ctx, ch, func(p domain.Page) error {
		name := fmt.Sprintf("%03d.jpg", p.Index+shift)
		if err := d.store.SavePage(job.Title, task.Volume, chapterLabel, name, p.Data); err != nil {
			return err
		}
		d.updateProgress(job.ID, i, p.Index, p.Total)
		d.bus.Publish(domain.Event{
			Type: domain.EventProgress, JobID: job.ID, ChapterNumber: ch.Number,
			Page: p.Index, TotalPages: p.Total,
		})
		return nil
	})
}

// persist grava o snapshot atual do job no repositório (no-op sem repo).
func (d *Downloader) persist(id string) {
	if d.repo == nil {
		return
	}
	if j, err := d.Get(id); err == nil {
		_ = d.repo.SaveJob(j)
	}
}

// List returns a snapshot copy of every job.
func (d *Downloader) List() []domain.Job {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]domain.Job, 0, len(d.jobs))
	for _, j := range d.jobs {
		out = append(out, copyJob(j))
	}
	return out
}

// Get returns a snapshot copy of one job.
func (d *Downloader) Get(id string) (domain.Job, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	j, ok := d.jobs[id]
	if !ok {
		return domain.Job{}, domain.ErrJobNotFound
	}
	return copyJob(j), nil
}

// Cancel stops a running job if present.
func (d *Downloader) Cancel(id string) error {
	d.mu.Lock()
	cancel, ok := d.cancels[id]
	d.mu.Unlock()
	if !ok {
		return domain.ErrJobNotFound
	}
	cancel()
	return nil
}

func (d *Downloader) setJobStatus(id string, s domain.JobStatus) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if j := d.jobs[id]; j != nil {
		j.Status = s
	}
}

func (d *Downloader) setTaskStatus(id string, i int, s domain.JobStatus, errMsg string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if j := d.jobs[id]; j != nil && i < len(j.Tasks) {
		j.Tasks[i].Status = s
		j.Tasks[i].Error = errMsg
	}
}

func (d *Downloader) updateProgress(id string, i, page, total int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if j := d.jobs[id]; j != nil && i < len(j.Tasks) {
		j.Tasks[i].Page = page
		j.Tasks[i].TotalPages = total
	}
}

func (d *Downloader) markChapterDone(id string, i int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if j := d.jobs[id]; j != nil && i < len(j.Tasks) {
		j.Tasks[i].Status = domain.StatusCompleted
		j.CompletedChapters++
	}
}

func copyJob(j *domain.Job) domain.Job {
	c := *j
	c.Tasks = make([]domain.ChapterTask, len(j.Tasks))
	copy(c.Tasks, j.Tasks)
	return c
}
