package usecase

import "context"

// DirStore is the storage root the settings can read and change.
type DirStore interface {
	Root() string
	SetRoot(dir string) error
}

// FolderPicker opens a native folder chooser starting at startDir.
type FolderPicker interface {
	Pick(ctx context.Context, startDir string) (string, error)
}

// Settings manages the download directory preference.
type Settings struct {
	store  DirStore
	picker FolderPicker
}

// NewSettings builds a Settings use case.
func NewSettings(store DirStore, picker FolderPicker) *Settings {
	return &Settings{store: store, picker: picker}
}

// DownloadDir returns the current download root.
func (s *Settings) DownloadDir() string { return s.store.Root() }

// SetDownloadDir changes the download root (created if missing).
func (s *Settings) SetDownloadDir(dir string) error { return s.store.SetRoot(dir) }

// PickDownloadDir opens the native folder chooser and, if confirmed, applies it.
// Retorna o caminho escolhido ("" se cancelado).
func (s *Settings) PickDownloadDir(ctx context.Context) (string, error) {
	dir, err := s.picker.Pick(ctx, s.store.Root())
	if err != nil || dir == "" {
		return "", err
	}
	if err := s.store.SetRoot(dir); err != nil {
		return "", err
	}
	return dir, nil
}
