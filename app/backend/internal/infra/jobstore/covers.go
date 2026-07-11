package jobstore

import (
	"database/sql"
	"strings"
	"time"

	"meumanga/internal/domain"
)

// coverEditsSchema guarda as edições de capa por capítulo, chaveadas pelo CAMINHO
// ABSOLUTO da pasta do capítulo (estável entre os editores por-job e por-pasta,
// que apontam para o mesmo diretório em disco). `original` é a capa que existia
// antes da 1ª edição — o que permite "voltar ao original". `inserted` marca que a
// 1ª edição ADICIONOU a capa (não havia nenhuma), então reverter = remover.
const coverEditsSchema = `
CREATE TABLE IF NOT EXISTS chapter_covers (
	path       TEXT PRIMARY KEY,
	original   BLOB,
	inserted   INTEGER NOT NULL DEFAULT 0,
	kind       TEXT NOT NULL DEFAULT '',
	label      TEXT NOT NULL DEFAULT '',
	width      INTEGER NOT NULL DEFAULT 0,
	height     INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL
);`

// SaveCoverEdit registra a edição de capa de um capítulo. O `original` e o
// `inserted` só são gravados na PRIMEIRA edição — em edições seguintes o ON
// CONFLICT preserva a capa original já guardada e só atualiza o formato. Assim
// "voltar ao original" sempre restaura a capa que veio, não uma versão editada.
func (s *Store) SaveCoverEdit(path string, original []byte, inserted bool, kind, label string, w, h int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ins := 0
	if inserted {
		ins = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO chapter_covers (path, original, inserted, kind, label, width, height, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET
		   kind=excluded.kind, label=excluded.label,
		   width=excluded.width, height=excluded.height, updated_at=excluded.updated_at`,
		path, original, ins, kind, label, w, h, time.Now().UnixNano(),
	)
	return err
}

// CoverOriginal devolve os bytes da capa original guardada e se a 1ª edição foi
// um "inserir" (não havia capa antes). ok=false quando não há edição registrada.
func (s *Store) CoverOriginal(path string) (data []byte, inserted bool, ok bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var blob []byte
	var ins int
	e := s.db.QueryRow(
		`SELECT original, inserted FROM chapter_covers WHERE path = ?`, path,
	).Scan(&blob, &ins)
	if e == sql.ErrNoRows {
		return nil, false, false, nil
	}
	if e != nil {
		return nil, false, false, e
	}
	return blob, ins == 1, true, nil
}

// DeleteCoverEdit apaga o registro de edição de uma capa (usado ao reverter).
func (s *Store) DeleteCoverEdit(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM chapter_covers WHERE path = ?`, path)
	return err
}

// CoverMetasUnder devolve as edições de capa de todos os capítulos SOB uma pasta
// de mangá (chave = caminho absoluto do capítulo), sem carregar os blobs. Serve
// para anexar o formato aplicado a cada capítulo da árvore de uma vez só.
func (s *Store) CoverMetasUnder(mangaRoot string) (map[string]domain.CoverEdit, error) {
	out := map[string]domain.CoverEdit{}
	if mangaRoot == "" {
		return out, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// prefixo com separador final para não casar mangás de nome irmão (ex.:
	// "/x/Naruto/" não casa "/x/Naruto Gaiden/…").
	prefix := escapeLike(mangaRoot+"/") + "%"
	rows, err := s.db.Query(
		`SELECT path, kind, label, width, height, COALESCE(length(original), 0)
		 FROM chapter_covers WHERE path LIKE ? ESCAPE '\'`, prefix,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p, kind, label string
		var w, h, origLen int
		if err := rows.Scan(&p, &kind, &label, &w, &h, &origLen); err != nil {
			return nil, err
		}
		out[p] = domain.CoverEdit{
			Kind:        kind,
			Label:       label,
			Width:       w,
			Height:      h,
			HasOriginal: origLen > 0,
		}
	}
	return out, rows.Err()
}

// escapeLike neutraliza os curingas do LIKE ('%', '_', '\') num prefixo literal.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
