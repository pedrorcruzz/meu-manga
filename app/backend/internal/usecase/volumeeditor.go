package usecase

import (
	"path/filepath"

	"meumanga/internal/domain"
)

// EditStore é o armazenamento em disco que o editor "Consertar volumes" lê e
// muta (folder-first). Satisfeito por *storage.Store.
type EditStore interface {
	ScanManga(manga string) (domain.MangaTree, error)
	ScanLibrary() ([]domain.LibraryManga, error)
	ReadRawPage(manga, volFolder, chapterFolder, name string) ([]byte, error)
	MoveChapter(manga, fromVol, toVol, chapterFolder string) error
	RenameChapter(manga, volFolder, oldNumber, newNumber string) error
	SetCover(manga, volFolder, chapterFolder string, jpeg []byte, insert bool) error
	FormatCover(manga, volFolder, chapterFolder string, width, height int) error
	FormatCovers(manga string, width, height int) error
	CoverDir(manga, volFolder, chapterFolder string) (string, error)
	ReadCover(manga, volFolder, chapterFolder string) ([]byte, error)
	AddPage(manga, volFolder, chapterFolder string, jpeg []byte) error
	RemoveCover(manga, volFolder, chapterFolder string) error
	DeleteTreePage(manga, volFolder, chapterFolder, name string) error
	ReorderPages(manga, volFolder, chapterFolder string, order []string) error
	DeleteChapter(manga, volFolder, chapterFolder string) error
}

// JobLister expõe os jobs para resolver o título da obra a partir do id e barrar
// edições enquanto um download da mesma obra está em andamento.
type JobLister interface {
	List() []domain.Job
	Get(id string) (domain.Job, error)
}

// CoverArchive persiste, por capítulo (chave = caminho absoluto da pasta), a capa
// original guardada e o formato aplicado — para o usuário ver que a capa foi
// alterada e poder voltar ao original. Satisfeito por *jobstore.Store.
type CoverArchive interface {
	SaveCoverEdit(path string, original []byte, inserted bool, kind, label string, w, h int) error
	CoverOriginal(path string) (data []byte, inserted bool, ok bool, err error)
	DeleteCoverEdit(path string) error
	CoverMetasUnder(mangaRoot string) (map[string]domain.CoverEdit, error)
}

// enrichCovers anexa a cada capítulo da árvore o formato de capa persistido
// (nil = capa original intacta), de uma varredura só sob a raiz do mangá.
func enrichCovers(covers CoverArchive, t *domain.MangaTree) {
	if covers == nil {
		return
	}
	metas, err := covers.CoverMetasUnder(t.Root)
	if err != nil || len(metas) == 0 {
		return
	}
	apply := func(chs []domain.ChapterNode, base string) {
		for i := range chs {
			if m, ok := metas[filepath.Join(base, chs[i].Folder)]; ok {
				mm := m
				chs[i].Cover = &mm
			}
		}
	}
	for vi := range t.Volumes {
		apply(t.Volumes[vi].Chapters, filepath.Join(t.Root, t.Volumes[vi].Folder))
	}
	apply(t.Loose, t.Root)
}

// MangaEditor implementa as operações do editor de volumes, sempre a partir da
// PASTA em disco da obra do job — nunca re-scrapeia o site. O único vínculo com
// o job é resolver o título (e a pasta) a partir do seu id.
type MangaEditor struct {
	store  EditStore
	jobs   JobLister
	covers CoverArchive
}

// NewMangaEditor liga o editor ao store de disco, ao registro de jobs e ao
// arquivo de capas (original + formato aplicado). covers pode ser nil.
func NewMangaEditor(store EditStore, jobs JobLister, covers CoverArchive) *MangaEditor {
	return &MangaEditor{store: store, jobs: jobs, covers: covers}
}

// scan lê a árvore em disco e anexa o formato de capa persistido de cada capítulo.
func (e *MangaEditor) scan(title string) (domain.MangaTree, error) {
	t, err := e.store.ScanManga(title)
	if err != nil {
		return t, err
	}
	enrichCovers(e.covers, &t)
	return t, nil
}

// archive guarda (na 1ª edição) a capa original do capítulo e registra o formato
// aplicado. inserted=true (a edição ADICIONOU a capa) pula guardar o original —
// reverter será remover a capa. Sem arquivo configurado, é no-op.
func (e *MangaEditor) archive(title, vol, chap string, inserted bool, kind, label string, w, h int) {
	if e.covers == nil {
		return
	}
	path, err := e.store.CoverDir(title, vol, chap)
	if err != nil {
		return
	}
	var orig []byte
	if !inserted {
		orig, _ = e.store.ReadCover(title, vol, chap) // capa pré-edição (nil se não havia)
	}
	_ = e.covers.SaveCoverEdit(path, orig, inserted, kind, label, w, h)
}

// Tree lê a árvore em disco da obra do job (read-only, sem guard).
func (e *MangaEditor) Tree(jobID string) (domain.MangaTree, error) {
	title, err := e.title(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// Page lê os bytes de uma página endereçada por nomes de pasta (read-only).
func (e *MangaEditor) Page(jobID, volFolder, chapterFolder, name string) ([]byte, error) {
	title, err := e.title(jobID)
	if err != nil {
		return nil, err
	}
	return e.store.ReadRawPage(title, volFolder, chapterFolder, name)
}

// Move move um capítulo entre volumes e devolve a árvore atualizada.
func (e *MangaEditor) Move(jobID, fromVol, toVol, chapterFolder string) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if err := e.store.MoveChapter(title, fromVol, toVol, chapterFolder); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// Rename corrige o número de um capítulo e devolve a árvore atualizada.
func (e *MangaEditor) Rename(jobID, volFolder, oldNumber, newNumber string) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if err := e.store.RenameChapter(title, volFolder, oldNumber, newNumber); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// SetCover adiciona (insert) ou troca (replace) a 001.jpg do alvo. chapterFolder
// vazio = capa do volume (1º capítulo); preenchido = 1ª página só daquele capítulo.
func (e *MangaEditor) SetCover(jobID, volFolder, chapterFolder string, jpeg []byte, insert bool, kind, label string, w, h int) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	e.archive(title, volFolder, chapterFolder, insert, kind, label, w, h)
	if err := e.store.SetCover(title, volFolder, chapterFolder, jpeg, insert); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// FormatCover redimensiona a capa (1ª pág.) de UM capítulo-alvo para width×height
// e devolve a árvore atualizada.
func (e *MangaEditor) FormatCover(jobID, volFolder, chapterFolder, kind, label string, width, height int) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	e.archive(title, volFolder, chapterFolder, false, kind, label, width, height)
	if err := e.store.FormatCover(title, volFolder, chapterFolder, width, height); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// FormatCovers redimensiona a capa (1ª pág. do 1º cap.) de TODOS os volumes da
// obra para width×height e devolve a árvore atualizada.
func (e *MangaEditor) FormatCovers(jobID, kind, label string, width, height int) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	// arquiva a capa original de cada volume (1º capítulo) antes de redimensionar
	if t, serr := e.store.ScanManga(title); serr == nil {
		for _, vol := range t.Volumes {
			e.archive(title, vol.Folder, "", false, kind, label, width, height)
		}
	}
	if err := e.store.FormatCovers(title, width, height); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// RevertCover volta a capa de um capítulo ao original guardado: se a 1ª edição
// tinha ADICIONADO a capa, remove-a (renumera); senão, restaura os bytes
// originais por cima da 001.jpg. Some com o registro de edição no fim.
func (e *MangaEditor) RevertCover(jobID, volFolder, chapterFolder string) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if e.covers != nil {
		if path, derr := e.store.CoverDir(title, volFolder, chapterFolder); derr == nil {
			if orig, inserted, ok, _ := e.covers.CoverOriginal(path); ok {
				if inserted {
					_ = e.store.RemoveCover(title, volFolder, chapterFolder)
				} else if len(orig) > 0 {
					_ = e.store.SetCover(title, volFolder, chapterFolder, orig, false)
				}
				_ = e.covers.DeleteCoverEdit(path)
			}
		}
	}
	return e.scan(title)
}

// AddPage acrescenta uma página ao final de um capítulo e devolve a árvore nova.
func (e *MangaEditor) AddPage(jobID, volFolder, chapterFolder string, jpeg []byte) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if err := e.store.AddPage(title, volFolder, chapterFolder, jpeg); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// RemoveCover apaga a 1ª página do alvo e devolve a árvore atualizada.
// chapterFolder vazio = capa do volume (1º capítulo); preenchido = aquele capítulo.
func (e *MangaEditor) RemoveCover(jobID, volFolder, chapterFolder string) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if err := e.store.RemoveCover(title, volFolder, chapterFolder); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// DeletePage apaga uma página de um capítulo e devolve a árvore atualizada.
func (e *MangaEditor) DeletePage(jobID, volFolder, chapterFolder, name string) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if err := e.store.DeleteTreePage(title, volFolder, chapterFolder, name); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// ReorderPages reordena as páginas de um capítulo e devolve a árvore atualizada.
func (e *MangaEditor) ReorderPages(jobID, volFolder, chapterFolder string, order []string) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if err := e.store.ReorderPages(title, volFolder, chapterFolder, order); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// DeleteChapter apaga a pasta inteira de um capítulo e devolve a árvore nova.
// Os demais capítulos do volume mantêm seus números (não há renumeração).
func (e *MangaEditor) DeleteChapter(jobID, volFolder, chapterFolder string) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if err := e.store.DeleteChapter(title, volFolder, chapterFolder); err != nil {
		return domain.MangaTree{}, err
	}
	return e.scan(title)
}

// guard resolve o título do job e recusa (ErrEditBusy) se houver um download da
// mesma obra rodando/na fila — evitar corrida com o writer é a proteção principal,
// já que as mutações do Store não travam junto do download.
func (e *MangaEditor) guard(jobID string) (string, error) {
	title, err := e.title(jobID)
	if err != nil {
		return "", err
	}
	for _, j := range e.jobs.List() {
		if j.Title == title && (j.Status == domain.StatusRunning || j.Status == domain.StatusQueued) {
			return "", domain.ErrEditBusy
		}
	}
	return title, nil
}

// title resolve o título da obra a partir do id do job.
func (e *MangaEditor) title(jobID string) (string, error) {
	j, err := e.jobs.Get(jobID)
	if err != nil {
		return "", err
	}
	return j.Title, nil
}
