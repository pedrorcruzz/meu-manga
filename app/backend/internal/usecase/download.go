package usecase

import (
	"context"
	"fmt"
	"strconv"
	"sync"

	"meumanga/internal/domain"
)

// PageSaver persists a single chapter page to storage.
type PageSaver interface {
	SavePage(manga, volume, chapter, name string, data []byte) error
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

	mu      sync.Mutex
	jobs    map[string]*domain.Job
	cancels map[string]context.CancelFunc
	seq     int
}

// NewDownloader builds a Downloader.
func NewDownloader(reg SourceRegistry, store PageSaver, bus *EventBus) *Downloader {
	return &Downloader{
		reg:     reg,
		store:   store,
		bus:     bus,
		jobs:    map[string]*domain.Job{},
		cancels: map[string]context.CancelFunc{},
	}
}

// Enqueue registers a job and starts running it in the background.
func (d *Downloader) Enqueue(req DownloadRequest) (string, error) {
	src, err := d.reg.Get(req.Source)
	if err != nil {
		return "", err
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
	}
	d.jobs[id] = job
	ctx, cancel := context.WithCancel(context.Background())
	d.cancels[id] = cancel
	d.mu.Unlock()

	go d.run(ctx, src, job)
	return id, nil
}

func (d *Downloader) run(ctx context.Context, src domain.Source, job *domain.Job) {
	d.setJobStatus(job.ID, domain.StatusRunning)
	failed := false
	for i := range job.Tasks {
		if ctx.Err() != nil {
			d.setTaskStatus(job.ID, i, domain.StatusCanceled, "")
			continue
		}
		if err := d.runChapter(ctx, src, job, i); err != nil {
			failed = true
			d.setTaskStatus(job.ID, i, domain.StatusFailed, err.Error())
			d.bus.Publish(domain.Event{Type: domain.EventError, JobID: job.ID,
				ChapterNumber: job.Tasks[i].Chapter.Number, Message: err.Error()})
			continue
		}
		d.markChapterDone(job.ID, i)
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
	d.bus.Publish(domain.Event{Type: domain.EventJobDone, JobID: job.ID, Status: final})
}

func (d *Downloader) runChapter(ctx context.Context, src domain.Source, job *domain.Job, i int) error {
	task := job.Tasks[i]
	ch := task.Chapter
	d.setTaskStatus(job.ID, i, domain.StatusRunning, "")
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
	defer d.mu.Unlock()
	cancel, ok := d.cancels[id]
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
