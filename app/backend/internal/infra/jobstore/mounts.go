package jobstore

import (
	"database/sql"
	"encoding/json"
	"time"

	"meumanga/internal/domain"
)

// timeFromNano converte nanossegundos Unix para time.Time (0 = zero time).
func timeFromNano(nano int64) time.Time {
	if nano == 0 {
		return time.Time{}
	}
	return time.Unix(0, nano)
}

// mountsSchema cria a tabela das montagens salvas (volumes montados na obra).
// Chaveada por source+slug — uma montagem por obra. As capas (data URLs base64)
// vivem dentro do JSON em `data`, junto dos volumes.
const mountsSchema = `
CREATE TABLE IF NOT EXISTS mounts (
	source     TEXT NOT NULL,
	slug       TEXT NOT NULL,
	title      TEXT NOT NULL,
	thumb_url  TEXT NOT NULL DEFAULT '',
	updated_at INTEGER NOT NULL,
	data       TEXT NOT NULL,
	PRIMARY KEY (source, slug)
);`

// SaveMount grava (ou substitui) a montagem de uma obra.
func (s *Store) SaveMount(m domain.Mount) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.Marshal(m.Volumes)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO mounts (source, slug, title, thumb_url, updated_at, data)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(source, slug) DO UPDATE SET
		   title = excluded.title,
		   thumb_url = excluded.thumb_url,
		   updated_at = excluded.updated_at,
		   data = excluded.data`,
		m.Source, m.Slug, m.Title, m.ThumbURL, m.UpdatedAt.UnixNano(), string(data),
	)
	return err
}

// DeleteMount remove a montagem de uma obra.
func (s *Store) DeleteMount(source, slug string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM mounts WHERE source = ? AND slug = ?`, source, slug)
	return err
}

// ClearMounts apaga todas as montagens salvas e devolve quantas foram removidas.
func (s *Store) ClearMounts() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(`DELETE FROM mounts`)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// LoadMount devolve a montagem de uma obra. ok=false quando não existe.
func (s *Store) LoadMount(source, slug string) (domain.Mount, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var (
		m    domain.Mount
		nano int64
		data string
	)
	err := s.db.QueryRow(
		`SELECT source, slug, title, thumb_url, updated_at, data
		 FROM mounts WHERE source = ? AND slug = ?`, source, slug,
	).Scan(&m.Source, &m.Slug, &m.Title, &m.ThumbURL, &nano, &data)
	if err == sql.ErrNoRows {
		return domain.Mount{}, false, nil
	}
	if err != nil {
		return domain.Mount{}, false, err
	}
	m.UpdatedAt = timeFromNano(nano)
	if err := json.Unmarshal([]byte(data), &m.Volumes); err != nil {
		return domain.Mount{}, false, err
	}
	return m, true, nil
}

// ListMounts devolve o resumo de todas as montagens, mais recentes primeiro.
func (s *Store) ListMounts() ([]domain.MountSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rows, err := s.db.Query(
		`SELECT source, slug, title, thumb_url, updated_at, data
		 FROM mounts ORDER BY updated_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.MountSummary{}
	for rows.Next() {
		var (
			sum  domain.MountSummary
			nano int64
			data string
		)
		if err := rows.Scan(&sum.Source, &sum.Slug, &sum.Title, &sum.ThumbURL, &nano, &data); err != nil {
			return nil, err
		}
		sum.UpdatedAt = timeFromNano(nano)
		var vols []domain.MountVolume
		if err := json.Unmarshal([]byte(data), &vols); err != nil {
			return nil, err
		}
		sum.VolumeCount = len(vols)
		for _, v := range vols {
			sum.ChapterCount += len(v.Chapters)
		}
		out = append(out, sum)
	}
	return out, rows.Err()
}
