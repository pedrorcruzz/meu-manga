package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Store persists chapter pages under a root directory as ordered image files.
type Store struct {
	mu   sync.RWMutex
	root string
}

// New builds a Store rooted at dir.
func New(dir string) *Store { return &Store{root: dir} }

// Root returns the current download root.
func (s *Store) Root() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.root
}

// SetRoot changes the download root, creating it if missing.
func (s *Store) SetRoot(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.root = dir
	return nil
}

// chapterPath computes the folder path for a work/volume/chapter WITHOUT
// creating it (read-only). Layout: <manga>/<manga> <volume>/<chapter>/. Com
// volume vazio, omite o nível do volume: <manga>/<chapter>/.
func (s *Store) chapterPath(manga, volume, chapter string) string {
	parts := []string{s.Root(), Sanitize(manga)}
	if volume != "" {
		parts = append(parts, Sanitize(manga+" "+volume))
	}
	parts = append(parts, Sanitize(chapter))
	return filepath.Join(parts...)
}

// ChapterDir returns (and creates) the folder for a given work/volume/chapter.
func (s *Store) ChapterDir(manga, volume, chapter string) (string, error) {
	dir := s.chapterPath(manga, volume, chapter)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// PageCount conta, SEM criar a pasta, quantas páginas (imagens) existem de fato
// no disco para um capítulo. Devolve 0 se a pasta não existe — é o que permite
// detectar que o histórico diz "baixado" mas os arquivos sumiram (ex.: movidos
// para um SSD externo).
func (s *Store) PageCount(manga, volume, chapter string) int {
	entries, err := os.ReadDir(s.chapterPath(manga, volume, chapter))
	if err != nil {
		return 0
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && isImageName(e.Name()) {
			n++
		}
	}
	return n
}

// SavePage writes one page image into the chapter folder.
func (s *Store) SavePage(manga, volume, chapter, name string, data []byte) error {
	dir, err := s.ChapterDir(manga, volume, chapter)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, Sanitize(name)), data, 0o644)
}

// ListPages returns the page image filenames of a chapter, in numeric order.
func (s *Store) ListPages(manga, volume, chapter string) ([]string, error) {
	dir, err := s.ChapterDir(manga, volume, chapter)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && isImageName(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sortNumeric(names)
	return names, nil
}

// ReadPage returns the bytes of one page image.
func (s *Store) ReadPage(manga, volume, chapter, name string) ([]byte, error) {
	dir, err := s.ChapterDir(manga, volume, chapter)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(dir, Sanitize(name)))
}

// DeletePage removes one page and renumbers the rest to stay sequential (001..N).
func (s *Store) DeletePage(manga, volume, chapter, name string) error {
	dir, err := s.ChapterDir(manga, volume, chapter)
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(dir, Sanitize(name))); err != nil {
		return err
	}
	return renumber(dir)
}

// renumber renomeia as páginas restantes para 001.jpg, 002.jpg… em ordem.
func renumber(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && isImageName(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sortNumeric(names)
	for i, old := range names {
		want := fmt.Sprintf("%03d.jpg", i+1)
		if old != want {
			if err := os.Rename(filepath.Join(dir, old), filepath.Join(dir, want)); err != nil {
				return err
			}
		}
	}
	return nil
}

func isImageName(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp"
}

func sortNumeric(names []string) {
	sort.Slice(names, func(i, j int) bool { return numPrefix(names[i]) < numPrefix(names[j]) })
}

func numPrefix(name string) int {
	n := 0
	for _, c := range name {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// Sanitize turns an arbitrary label into a safe path segment.
func Sanitize(name string) string {
	name = strings.TrimSpace(name)
	replacer := strings.NewReplacer(
		"/", "-", "\\", "-", ":", "-", "*", "", "?", "",
		"\"", "", "<", "", ">", "", "|", "-", "\n", " ", "\t", " ",
	)
	name = replacer.Replace(name)
	name = strings.Trim(name, ". ")
	if name == "" {
		return "untitled"
	}
	return name
}
