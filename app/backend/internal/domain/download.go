package domain

import "time"

// JobStatus is the lifecycle state of a download job or chapter task.
type JobStatus string

const (
	StatusQueued    JobStatus = "queued"
	StatusRunning   JobStatus = "running"
	StatusCompleted JobStatus = "completed"
	StatusFailed    JobStatus = "failed"
	StatusCanceled  JobStatus = "canceled"
)

// ChapterTask tracks one chapter inside a job.
type ChapterTask struct {
	Chapter    Chapter   `json:"chapter"`
	Volume     string    `json:"volume,omitempty"`
	Cover      []byte    `json:"-"` // capa a inserir como 001.jpg (só no 1º capítulo do volume)
	Status     JobStatus `json:"status"`
	Page       int       `json:"page"`
	TotalPages int       `json:"totalPages"`
	Error      string    `json:"error,omitempty"`
}

// Job is a batch download of one or more chapters of a work.
type Job struct {
	ID                string        `json:"jobId"`
	Source            string        `json:"source"`
	Slug              string        `json:"slug"`
	Title             string        `json:"title"`
	Status            JobStatus     `json:"status"`
	Tasks             []ChapterTask `json:"tasks"`
	TotalChapters     int           `json:"totalChapters"`
	CompletedChapters int           `json:"completedChapters"`
	CreatedAt         time.Time     `json:"createdAt"`
}

// Pending reports whether the job still has chapters left to download
// (queued/failed/canceled). Used by the UI/history to offer "redo missing".
func (j Job) Pending() int {
	n := 0
	for _, t := range j.Tasks {
		if t.Status != StatusCompleted {
			n++
		}
	}
	return n
}

// EventType classifies a progress event streamed to the UI.
type EventType string

const (
	EventProgress     EventType = "progress"
	EventChapterStart EventType = "chapter_start"
	EventChapterDone  EventType = "chapter_done"
	EventJobDone      EventType = "job_done"
	EventError        EventType = "error"
)

// Event is a single SSE progress message.
type Event struct {
	Type          EventType `json:"type"`
	JobID         string    `json:"jobId"`
	ChapterNumber string    `json:"chapterNumber,omitempty"`
	Page          int       `json:"page,omitempty"`
	TotalPages    int       `json:"totalPages,omitempty"`
	Status        JobStatus `json:"status,omitempty"`
	Message       string    `json:"message,omitempty"`
}
