// Package jobstore persists download jobs (the history) and the active rate-limit
// block window in a local SQLite database, so both survive restarting the app.
package jobstore

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"meumanga/internal/domain"

	_ "modernc.org/sqlite"
)

// Store is a SQLite-backed persistence layer for jobs and the block window.
type Store struct {
	mu sync.Mutex
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS jobs (
	id         TEXT PRIMARY KEY,
	created_at INTEGER NOT NULL,
	data       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS covers (
	job_id TEXT NOT NULL,
	idx    INTEGER NOT NULL,
	cover  BLOB NOT NULL,
	PRIMARY KEY (job_id, idx)
);
CREATE TABLE IF NOT EXISTS kv (
	k TEXT PRIMARY KEY,
	v TEXT NOT NULL
);`

// Open opens (creating if needed) the SQLite database at path, ensuring the
// parent directory and schema exist.
func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("jobstore dir: %w", err)
		}
	}
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("jobstore schema: %w", err)
	}
	if _, err := db.Exec(mountsSchema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("mounts schema: %w", err)
	}
	// Migração idempotente: coluna do baseline do Volume Inteligente. Bancos
	// antigos não têm a coluna; ADD COLUMN erra com "duplicate column" quando já
	// existe — ignoramos esse caso.
	if _, err := db.Exec(
		`ALTER TABLE mounts ADD COLUMN baseline TEXT NOT NULL DEFAULT ''`,
	); err != nil && !strings.Contains(err.Error(), "duplicate column") {
		_ = db.Close()
		return nil, fmt.Errorf("mounts baseline column: %w", err)
	}
	if _, err := db.Exec(coverEditsSchema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("cover edits schema: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the database handle.
func (s *Store) Close() error { return s.db.Close() }

// SaveJob upserts a job and its covers. Covers are stored apart from the JSON
// blob because domain.ChapterTask.Cover is excluded from JSON serialization.
func (s *Store) SaveJob(job domain.Job) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint - no-op após Commit
	if _, err := tx.Exec(
		`INSERT INTO jobs (id, created_at, data) VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
		job.ID, job.CreatedAt.UnixNano(), string(data),
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM covers WHERE job_id = ?`, job.ID); err != nil {
		return err
	}
	for i, t := range job.Tasks {
		if len(t.Cover) == 0 {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO covers (job_id, idx, cover) VALUES (?, ?, ?)`,
			job.ID, i, t.Cover,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeleteJob removes a job (and its covers) from the history.
func (s *Store) DeleteJob(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.db.Exec(`DELETE FROM covers WHERE job_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM jobs WHERE id = ?`, id)
	return err
}

// LoadJobs returns every persisted job, oldest first (creation order), with
// covers re-attached to their tasks.
func (s *Store) LoadJobs() ([]domain.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rows, err := s.db.Query(`SELECT id, data FROM jobs ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []domain.Job
	for rows.Next() {
		var id, data string
		if err := rows.Scan(&id, &data); err != nil {
			return nil, err
		}
		var job domain.Job
		if err := json.Unmarshal([]byte(data), &job); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range jobs {
		if err := s.attachCovers(&jobs[i]); err != nil {
			return nil, err
		}
	}
	return jobs, nil
}

func (s *Store) attachCovers(job *domain.Job) error {
	rows, err := s.db.Query(`SELECT idx, cover FROM covers WHERE job_id = ?`, job.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var idx int
		var cover []byte
		if err := rows.Scan(&idx, &cover); err != nil {
			return err
		}
		if idx >= 0 && idx < len(job.Tasks) {
			job.Tasks[idx].Cover = cover
		}
	}
	return rows.Err()
}

// GetSetting reads a persisted preference from the kv table (namespaced under
// "setting:" so it never clashes with internal keys like 'block'). ok=false when
// the key was never set.
func (s *Store) GetSetting(key string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var v string
	err := s.db.QueryRow(`SELECT v FROM kv WHERE k = ?`, "setting:"+key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// SetSetting upserts a persisted preference into the kv table (namespaced under
// "setting:"). Survives restarting the app.
func (s *Store) SetSetting(key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`INSERT INTO kv (k, v) VALUES (?, ?)
		 ON CONFLICT(k) DO UPDATE SET v = excluded.v`, "setting:"+key, value)
	return err
}

// SaveBlock persists the active block window. A zero `until` clears it.
func (s *Store) SaveBlock(until time.Time, raw string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// zero => 0 nanos, um sentinela de "sem bloqueio" que sobrevive ao round-trip
	// (time.Time{} não volta idêntico via UnixNano).
	var nano int64
	if !until.IsZero() {
		nano = until.UnixNano()
	}
	payload, err := json.Marshal(map[string]any{"until": nano, "raw": raw})
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO kv (k, v) VALUES ('block', ?)
		 ON CONFLICT(k) DO UPDATE SET v = excluded.v`, string(payload))
	return err
}

// LoadBlock returns the persisted block window, or a zero time if none.
func (s *Store) LoadBlock() (time.Time, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var v string
	err := s.db.QueryRow(`SELECT v FROM kv WHERE k = 'block'`).Scan(&v)
	if err == sql.ErrNoRows {
		return time.Time{}, "", nil
	}
	if err != nil {
		return time.Time{}, "", err
	}
	var payload struct {
		Until int64  `json:"until"`
		Raw   string `json:"raw"`
	}
	if err := json.Unmarshal([]byte(v), &payload); err != nil {
		return time.Time{}, "", err
	}
	if payload.Until == 0 {
		return time.Time{}, "", nil
	}
	return time.Unix(0, payload.Until), payload.Raw, nil
}
