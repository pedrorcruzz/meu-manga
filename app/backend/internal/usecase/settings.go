package usecase

import (
	"context"
	"encoding/json"
	"os"
)

// DirStore is the storage root the settings can read and change.
type DirStore interface {
	Root() string
	SetRoot(dir string) error
	// RestoreRoot aponta a raiz sem criá-la no disco (reaplicar a pasta
	// persistida no boot, mesmo que ela esteja indisponível no momento).
	RestoreRoot(dir string)
}

// FolderPicker opens a native folder chooser starting at startDir.
type FolderPicker interface {
	Pick(ctx context.Context, startDir string) (string, error)
}

// SettingsKV persiste preferências chave→valor (SQLite) que não são a pasta de
// download em si — como o formato do nome dos volumes e a última pasta aberta no
// modo "Consertar da pasta". Satisfeita por *jobstore.Store.
type SettingsKV interface {
	GetSetting(key string) (string, bool, error)
	SetSetting(key, value string) error
}

// VolumeFormat é a preferência global de nome dos volumes (prefixo + nº de
// dígitos), compartilhada entre a aba de montagem e a de revisão/baixar e
// persistida no SQLite. Prevalece sempre a última escolha.
type VolumeFormat struct {
	Prefix string `json:"prefix"` // "none" | "v" | "volume"
	Digits int    `json:"digits"` // 1 | 2 | 3
}

// DefaultVolumeFormat: só os 3 dígitos, sem prefixo (ex.: "001").
var DefaultVolumeFormat = VolumeFormat{Prefix: "none", Digits: 3}

func (f VolumeFormat) valid() bool {
	switch f.Prefix {
	case "none", "v", "volume":
	default:
		return false
	}
	return f.Digits >= 1 && f.Digits <= 3
}

const (
	volumeFormatKey = "volume_name_format"
	mangaFolderKey  = "manga_folder"
	downloadDirKey  = "download_dir"
)

// Settings manages the download directory preference plus small persisted
// preferences (volume-name format, last opened manga folder).
type Settings struct {
	store  DirStore
	picker FolderPicker
	kv     SettingsKV
}

// NewSettings builds a Settings use case. `kv` pode ser nil (preferências extras
// caem no padrão e não persistem).
func NewSettings(store DirStore, picker FolderPicker, kv SettingsKV) *Settings {
	return &Settings{store: store, picker: picker, kv: kv}
}

// DownloadDir returns the current download root.
func (s *Settings) DownloadDir() string { return s.store.Root() }

// SetDownloadDir changes the download root (created if missing) and persiste a
// escolha no SQLite para sobreviver ao fechar o app.
func (s *Settings) SetDownloadDir(dir string) error {
	if err := s.store.SetRoot(dir); err != nil {
		return err
	}
	s.persistDownloadDir(dir)
	return nil
}

// persistDownloadDir grava a pasta de download escolhida no SQLite (best-effort:
// se o kv falhar/for nil, a raiz em memória ainda vale para esta sessão).
func (s *Settings) persistDownloadDir(dir string) {
	if s.kv == nil {
		return
	}
	_ = s.kv.SetSetting(downloadDirKey, dir)
}

// RestoreDownloadDir reaplica a última pasta de download escolhida pelo usuário e
// persistida no SQLite. Chamado uma vez no boot (depois do kv disponível), ANTES
// de servir requisições. Sem valor persistido, mantém o padrão do config
// (~/Downloads ou MM_DOWNLOAD_DIR). Não recria a pasta: se ela sumiu (SSD
// desconectado), a raiz ainda aponta para lá para a UI avisar "indisponível".
func (s *Settings) RestoreDownloadDir() {
	if s.kv == nil {
		return
	}
	v, ok, err := s.kv.GetSetting(downloadDirKey)
	if err != nil || !ok || v == "" {
		return
	}
	s.store.RestoreRoot(v)
}

// DownloadDirAvailable reporta se a pasta de download persistida ainda existe no
// disco (falso quando, p.ex., um SSD externo foi desconectado ou a pasta foi
// movida/apagada). A biblioteca usa isto para avisar que a pasta sumiu em vez de
// mostrar "0 obras".
func (s *Settings) DownloadDirAvailable() bool {
	dir := s.store.Root()
	if dir == "" {
		return false
	}
	info, err := os.Stat(dir)
	return err == nil && info.IsDir()
}

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
	s.persistDownloadDir(dir)
	return dir, nil
}

// PickFolder abre o seletor nativo de pasta e devolve o caminho escolhido ("" se
// cancelado) SEM alterar nenhuma preferência — usado pelo modo "Consertar da
// pasta" para apontar uma pasta de mangá em qualquer lugar do disco.
func (s *Settings) PickFolder(ctx context.Context) (string, error) {
	start := s.MangaFolder()
	if start == "" {
		start = s.store.Root()
	}
	return s.picker.Pick(ctx, start)
}

// VolumeFormat devolve o formato persistido (ou o padrão, se ausente/ inválido).
func (s *Settings) VolumeFormat() VolumeFormat {
	if s.kv == nil {
		return DefaultVolumeFormat
	}
	v, ok, err := s.kv.GetSetting(volumeFormatKey)
	if err != nil || !ok {
		return DefaultVolumeFormat
	}
	var f VolumeFormat
	if err := json.Unmarshal([]byte(v), &f); err != nil || !f.valid() {
		return DefaultVolumeFormat
	}
	return f
}

// SetVolumeFormat persiste o formato do nome dos volumes (valores inválidos caem
// no padrão).
func (s *Settings) SetVolumeFormat(f VolumeFormat) error {
	if !f.valid() {
		f = DefaultVolumeFormat
	}
	if s.kv == nil {
		return nil
	}
	data, err := json.Marshal(f)
	if err != nil {
		return err
	}
	return s.kv.SetSetting(volumeFormatKey, string(data))
}

// MangaFolder devolve a última pasta de mangá aberta no modo "Consertar da
// pasta" ("" se nenhuma).
func (s *Settings) MangaFolder() string {
	if s.kv == nil {
		return ""
	}
	v, ok, err := s.kv.GetSetting(mangaFolderKey)
	if err != nil || !ok {
		return ""
	}
	return v
}

// SetMangaFolder persiste a última pasta de mangá aberta.
func (s *Settings) SetMangaFolder(path string) error {
	if s.kv == nil {
		return nil
	}
	return s.kv.SetSetting(mangaFolderKey, path)
}
