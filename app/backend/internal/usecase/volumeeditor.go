package usecase

import "meumanga/internal/domain"

// EditStore é o armazenamento em disco que o editor "Consertar volumes" lê e
// muta (folder-first). Satisfeito por *storage.Store.
type EditStore interface {
	ScanManga(manga string) (domain.MangaTree, error)
	ScanLibrary() ([]domain.LibraryManga, error)
	ReadRawPage(manga, volFolder, chapterFolder, name string) ([]byte, error)
	MoveChapter(manga, fromVol, toVol, chapterFolder string) error
	RenameChapter(manga, volFolder, oldNumber, newNumber string) error
	SetCover(manga, volFolder, chapterFolder string, jpeg []byte, insert bool) error
	AddPage(manga, volFolder, chapterFolder string, jpeg []byte) error
	RemoveCover(manga, volFolder, chapterFolder string) error
	DeleteTreePage(manga, volFolder, chapterFolder, name string) error
	ReorderPages(manga, volFolder, chapterFolder string, order []string) error
}

// JobLister expõe os jobs para resolver o título da obra a partir do id e barrar
// edições enquanto um download da mesma obra está em andamento.
type JobLister interface {
	List() []domain.Job
	Get(id string) (domain.Job, error)
}

// MangaEditor implementa as operações do editor de volumes, sempre a partir da
// PASTA em disco da obra do job — nunca re-scrapeia o site. O único vínculo com
// o job é resolver o título (e a pasta) a partir do seu id.
type MangaEditor struct {
	store EditStore
	jobs  JobLister
}

// NewMangaEditor liga o editor ao store de disco e ao registro de jobs.
func NewMangaEditor(store EditStore, jobs JobLister) *MangaEditor {
	return &MangaEditor{store: store, jobs: jobs}
}

// Tree lê a árvore em disco da obra do job (read-only, sem guard).
func (e *MangaEditor) Tree(jobID string) (domain.MangaTree, error) {
	title, err := e.title(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	return e.store.ScanManga(title)
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
	return e.store.ScanManga(title)
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
	return e.store.ScanManga(title)
}

// SetCover adiciona (insert) ou troca (replace) a 001.jpg do alvo. chapterFolder
// vazio = capa do volume (1º capítulo); preenchido = 1ª página só daquele capítulo.
func (e *MangaEditor) SetCover(jobID, volFolder, chapterFolder string, jpeg []byte, insert bool) (domain.MangaTree, error) {
	title, err := e.guard(jobID)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if err := e.store.SetCover(title, volFolder, chapterFolder, jpeg, insert); err != nil {
		return domain.MangaTree{}, err
	}
	return e.store.ScanManga(title)
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
	return e.store.ScanManga(title)
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
	return e.store.ScanManga(title)
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
	return e.store.ScanManga(title)
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
	return e.store.ScanManga(title)
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
