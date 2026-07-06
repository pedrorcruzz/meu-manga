package usecase

import (
	"os"
	"path/filepath"

	"meumanga/internal/domain"
)

// FolderEditor edita uma pasta de mangá em QUALQUER lugar do disco: o usuário
// aponta a pasta-pai da obra (ex.: ".../Witch Hat Atelier", já migrada para um
// SSD externo) e o editor lê/organiza os volumes e capítulos ali, sem depender
// de um download registrado no histórico. Reaproveita exatamente a mesma lógica
// folder-first do MangaEditor (mover capítulo, capa, corrigir número, reordenar/
// apagar páginas), só que enraizada na pasta escolhida.
//
// Truque de reuso: um EditStore (storage.Store) é "enraizado" no PAI da pasta
// escolhida e o nome-base da pasta faz o papel do título do mangá. Assim
// MangaDir(base) = pai/base = a própria pasta, e todas as operações existentes
// valem sem alteração.
type FolderEditor struct {
	// storeFor constrói um EditStore enraizado em `root` (a pasta-pai do mangá).
	storeFor func(root string) EditStore
	jobs     JobLister
}

// NewFolderEditor liga o editor de pasta a uma fábrica de store (por caminho
// raiz) e ao registro de jobs (para barrar edição durante um download da mesma
// obra).
func NewFolderEditor(storeFor func(root string) EditStore, jobs JobLister) *FolderEditor {
	return &FolderEditor{storeFor: storeFor, jobs: jobs}
}

// resolve valida a pasta escolhida e devolve (store enraizado no pai, nome-base).
func (e *FolderEditor) resolve(path string) (EditStore, string, error) {
	if path == "" || !filepath.IsAbs(path) {
		return nil, "", domain.ErrNotFound
	}
	clean := filepath.Clean(path)
	info, err := os.Stat(clean)
	if err != nil || !info.IsDir() {
		return nil, "", domain.ErrNotFound
	}
	return e.storeFor(filepath.Dir(clean)), filepath.Base(clean), nil
}

// Library varre a pasta central (biblioteca) e devolve o resumo de cada obra
// (subpasta). read-only, sem guard. `root` costuma ser a própria pasta de
// downloads (biblioteca e destino de download unificados).
func (e *FolderEditor) Library(root string) ([]domain.LibraryManga, error) {
	if root == "" || !filepath.IsAbs(root) {
		return nil, domain.ErrNotFound
	}
	return e.storeFor(filepath.Clean(root)).ScanLibrary()
}

// Tree lê a árvore em disco da pasta escolhida (read-only, sem guard).
func (e *FolderEditor) Tree(path string) (domain.MangaTree, error) {
	st, manga, err := e.resolve(path)
	if err != nil {
		return domain.MangaTree{}, err
	}
	return st.ScanManga(manga)
}

// Page lê os bytes de uma página endereçada por nomes de pasta (read-only).
func (e *FolderEditor) Page(path, volFolder, chapterFolder, name string) ([]byte, error) {
	st, manga, err := e.resolve(path)
	if err != nil {
		return nil, err
	}
	return st.ReadRawPage(manga, volFolder, chapterFolder, name)
}

// Move move um capítulo entre volumes e devolve a árvore atualizada.
func (e *FolderEditor) Move(path, fromVol, toVol, chapter string) (domain.MangaTree, error) {
	return e.mutate(path, func(st EditStore, manga string) error {
		return st.MoveChapter(manga, fromVol, toVol, chapter)
	})
}

// Rename corrige o número de um capítulo e devolve a árvore atualizada.
func (e *FolderEditor) Rename(path, volFolder, oldNumber, newNumber string) (domain.MangaTree, error) {
	return e.mutate(path, func(st EditStore, manga string) error {
		return st.RenameChapter(manga, volFolder, oldNumber, newNumber)
	})
}

// SetCover adiciona (insert) ou troca (replace) a 001.jpg do alvo. chapterFolder
// vazio = capa do volume (1º capítulo); preenchido = 1ª página só daquele capítulo.
func (e *FolderEditor) SetCover(path, volFolder, chapterFolder string, jpeg []byte, insert bool) (domain.MangaTree, error) {
	return e.mutate(path, func(st EditStore, manga string) error {
		return st.SetCover(manga, volFolder, chapterFolder, jpeg, insert)
	})
}

// RemoveCover apaga a 1ª página do alvo e devolve a árvore atualizada.
// chapterFolder vazio = capa do volume (1º capítulo); preenchido = aquele capítulo.
func (e *FolderEditor) RemoveCover(path, volFolder, chapterFolder string) (domain.MangaTree, error) {
	return e.mutate(path, func(st EditStore, manga string) error {
		return st.RemoveCover(manga, volFolder, chapterFolder)
	})
}

// DeletePage apaga uma página de um capítulo e devolve a árvore atualizada.
func (e *FolderEditor) DeletePage(path, volFolder, chapterFolder, name string) (domain.MangaTree, error) {
	return e.mutate(path, func(st EditStore, manga string) error {
		return st.DeleteTreePage(manga, volFolder, chapterFolder, name)
	})
}

// ReorderPages reordena as páginas de um capítulo e devolve a árvore atualizada.
func (e *FolderEditor) ReorderPages(path, volFolder, chapterFolder string, order []string) (domain.MangaTree, error) {
	return e.mutate(path, func(st EditStore, manga string) error {
		return st.ReorderPages(manga, volFolder, chapterFolder, order)
	})
}

// mutate resolve a pasta, barra edição concorrente com um download da mesma obra
// (ErrEditBusy), aplica a operação e devolve a árvore fresca.
func (e *FolderEditor) mutate(path string, op func(st EditStore, manga string) error) (domain.MangaTree, error) {
	st, manga, err := e.resolve(path)
	if err != nil {
		return domain.MangaTree{}, err
	}
	if e.busy(manga) {
		return domain.MangaTree{}, domain.ErrEditBusy
	}
	if err := op(st, manga); err != nil {
		return domain.MangaTree{}, err
	}
	return st.ScanManga(manga)
}

// busy reporta se há um download da obra de mesmo nome rodando/na fila — proteção
// contra corrida com o writer, já que as mutações do Store não travam junto.
func (e *FolderEditor) busy(manga string) bool {
	if e.jobs == nil {
		return false
	}
	for _, j := range e.jobs.List() {
		if j.Title == manga && (j.Status == domain.StatusRunning || j.Status == domain.StatusQueued) {
			return true
		}
	}
	return false
}
