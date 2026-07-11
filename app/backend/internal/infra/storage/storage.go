package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"meumanga/internal/domain"
	"meumanga/internal/infra/imageconv"
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

// RestoreRoot aponta a raiz para dir SEM criá-la no disco (ao contrário de
// SetRoot). Usado no boot para reaplicar a pasta persistida pelo usuário: se o
// caminho não existir (ex.: SSD externo desconectado), a raiz ainda passa a
// apontar para lá — assim DownloadDirAvailable devolve false e a UI avisa
// "indisponível", em vez de MkdirAll criar uma pasta fantasma no disco interno.
func (s *Store) RestoreRoot(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.root = dir
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
	// Ignora dotfiles/AppleDouble ("._001.jpg", ".DS_Store"). Em discos não-APFS
	// (exFAT/FAT de SSDs externos, pendrives, rede) o macOS cria um sidecar
	// "._<arquivo>" ao lado de cada página; como tem extensão .jpg, sem este
	// guarda ele contaria como página real — inflando a contagem (a galeria pede
	// páginas que não existem → 404) e, por ordenar antes de 001.jpg, virando a
	// capa (bytes que o navegador não decodifica). Vale para qualquer caminho.
	if isHidden(name) {
		return false
	}
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

// ── Editor "Consertar volumes": leitura e edição da pasta em disco ──────────────
//
// O editor é folder-first: endereça por NOMES DE PASTA reais dentro de
// <root>/Sanitize(manga)/, sem depender de job/task index nem de metadados. As
// mutações não travam s.mu (seguem o padrão de SavePage/DeletePage, que também
// não travam) — a proteção contra corrida com um download em andamento é o
// guard 409 no usecase (MangaEditor).

// MangaDir devolve (sem criar) a pasta raiz de uma obra.
func (s *Store) MangaDir(manga string) string {
	return filepath.Join(s.Root(), Sanitize(manga))
}

// subdir devolve a pasta de um volume (ou a raiz do mangá quando volFolder="").
func (s *Store) subdir(manga, volFolder string) string {
	if volFolder == "" {
		return s.MangaDir(manga)
	}
	return filepath.Join(s.MangaDir(manga), volFolder)
}

// ScanManga varre a pasta da obra e devolve a árvore de volumes e capítulos
// soltos, contando páginas de fato no disco. Pasta inexistente = árvore vazia.
func (s *Store) ScanManga(manga string) (domain.MangaTree, error) {
	root := s.MangaDir(manga)
	tree := domain.MangaTree{
		Manga:   manga,
		Root:    root,
		Volumes: []domain.VolumeNode{},
		Loose:   []domain.ChapterNode{},
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return tree, nil
		}
		return domain.MangaTree{}, err
	}
	volPrefix := Sanitize(manga) + " "
	for _, e := range entries {
		if !e.IsDir() || isHidden(e.Name()) {
			continue
		}
		name := e.Name()
		if label, ok := strings.CutPrefix(name, volPrefix); ok {
			tree.Volumes = append(tree.Volumes, domain.VolumeNode{
				Folder:   name,
				Name:     label,
				Chapters: scanChapters(filepath.Join(root, name)),
			})
			continue
		}
		// subpasta que não é volume: capítulo solto (modo simples)
		tree.Loose = append(tree.Loose, chapterNode(filepath.Join(root, name), name))
	}
	sort.Slice(tree.Volumes, func(i, j int) bool {
		return numVal(tree.Volumes[i].Name) < numVal(tree.Volumes[j].Name)
	})
	sortChapters(tree.Loose)
	return tree, nil
}

// ScanLibrary varre a pasta raiz (biblioteca central) e devolve um resumo de
// cada obra (cada subpasta): contagem de volumes, capítulos e capítulos soltos,
// além de um ponteiro para a 1ª página (miniatura). Varredura leve: NÃO conta as
// páginas de cada capítulo. Raiz inexistente = lista vazia.
func (s *Store) ScanLibrary() ([]domain.LibraryManga, error) {
	root := s.Root()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.LibraryManga{}, nil
		}
		return nil, err
	}
	out := []domain.LibraryManga{}
	for _, e := range entries {
		if !e.IsDir() || isHidden(e.Name()) {
			continue
		}
		lm := summarizeManga(filepath.Join(root, e.Name()), e.Name())
		// Só entra na biblioteca quem realmente tem páginas de mangá: o
		// coverPointer só acha capa quando há imagem dentro de um capítulo.
		// Assim ignoramos qualquer pasta da Downloads sem essa estrutura —
		// bundles ".app", instaladores, pastas de fotos soltas etc.
		if lm.Cover == nil {
			continue
		}
		out = append(out, lm)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Manga) < strings.ToLower(out[j].Manga)
	})
	return out, nil
}

// summarizeManga resume uma obra a partir da sua pasta: conta volumes/capítulos
// (sem contar páginas) e escolhe a 1ª página como miniatura.
func summarizeManga(dir, manga string) domain.LibraryManga {
	lm := domain.LibraryManga{Manga: manga, Path: dir}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return lm
	}
	volPrefix := Sanitize(manga) + " "
	var firstVol, firstLoose string
	for _, e := range entries {
		if !e.IsDir() || isHidden(e.Name()) {
			continue
		}
		name := e.Name()
		if _, ok := strings.CutPrefix(name, volPrefix); ok {
			lm.Volumes++
			lm.Chapters += countChapters(filepath.Join(dir, name))
			if firstVol == "" {
				firstVol = name
			}
			continue
		}
		lm.Loose++
		if firstLoose == "" {
			firstLoose = name
		}
	}
	lm.Cover = coverPointer(dir, firstVol, firstLoose)
	return lm
}

// countChapters conta as subpastas (capítulos) de um volume, ignorando ocultas.
func countChapters(volDir string) int {
	entries, err := os.ReadDir(volDir)
	if err != nil {
		return 0
	}
	n := 0
	for _, e := range entries {
		if e.IsDir() && !isHidden(e.Name()) {
			n++
		}
	}
	return n
}

// coverPointer escolhe a 1ª página para miniatura: a 001 do 1º capítulo do 1º
// volume (por ordem de nome, já numérica com zero-padding) ou, na ausência de
// volumes, a 1ª imagem do 1º capítulo solto. nil quando não há imagem.
func coverPointer(mangaDir, firstVol, firstLoose string) *domain.LibraryCover {
	if firstVol != "" {
		volDir := filepath.Join(mangaDir, firstVol)
		if ch, ok := firstChapterFolder(volDir); ok {
			if imgs := imagesIn(filepath.Join(volDir, ch)); len(imgs) > 0 {
				return &domain.LibraryCover{Volume: firstVol, Chapter: ch, Name: imgs[0]}
			}
		}
	}
	if firstLoose != "" {
		if imgs := imagesIn(filepath.Join(mangaDir, firstLoose)); len(imgs) > 0 {
			return &domain.LibraryCover{Volume: "", Chapter: firstLoose, Name: imgs[0]}
		}
	}
	return nil
}

// scanChapters lê as pastas de capítulo dentro de um volume, em ordem numérica.
func scanChapters(volDir string) []domain.ChapterNode {
	entries, err := os.ReadDir(volDir)
	if err != nil {
		return []domain.ChapterNode{}
	}
	out := []domain.ChapterNode{}
	for _, e := range entries {
		if !e.IsDir() || isHidden(e.Name()) {
			continue
		}
		out = append(out, chapterNode(filepath.Join(volDir, e.Name()), e.Name()))
	}
	sortChapters(out)
	return out
}

// chapterNode monta o nó de um capítulo a partir da sua pasta.
func chapterNode(dir, folder string) domain.ChapterNode {
	imgs := imagesIn(dir)
	node := domain.ChapterNode{
		Folder: folder,
		Number: strings.TrimSpace(strings.TrimPrefix(folder, "Cap ")),
		Pages:  len(imgs),
	}
	if len(imgs) > 0 {
		node.FirstPage = imgs[0]
	}
	return node
}

// ReadRawPage lê os bytes de uma página endereçada por nomes de pasta (editor).
// Rejeita segmentos inseguros (path traversal).
func (s *Store) ReadRawPage(manga, volFolder, chapterFolder, name string) ([]byte, error) {
	if !safeSeg(chapterFolder) || !safeSeg(name) {
		return nil, os.ErrNotExist
	}
	if volFolder != "" && !safeSeg(volFolder) {
		return nil, os.ErrNotExist
	}
	return os.ReadFile(filepath.Join(s.subdir(manga, volFolder), chapterFolder, name))
}

// MoveChapter move a pasta de um capítulo de um volume para outro (os.Rename no
// mesmo FS). Cria o volume destino; colisão → ErrChapterExists; remove o volume
// origem se ficar vazio. As páginas internas não são tocadas.
func (s *Store) MoveChapter(manga, fromVol, toVol, chapterFolder string) error {
	if !safeSeg(chapterFolder) {
		return os.ErrNotExist
	}
	if (fromVol != "" && !safeSeg(fromVol)) || (toVol != "" && !safeSeg(toVol)) {
		return os.ErrNotExist
	}
	srcParent := s.subdir(manga, fromVol)
	dstParent := s.subdir(manga, toVol)
	src := filepath.Join(srcParent, chapterFolder)
	dst := filepath.Join(dstParent, chapterFolder)
	if src == dst {
		return nil
	}
	if _, err := os.Stat(dst); err == nil {
		return domain.ErrChapterExists
	}
	if err := os.MkdirAll(dstParent, 0o755); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err != nil {
		return err
	}
	if fromVol != "" {
		removeIfEmpty(srcParent)
	}
	return nil
}

// DeleteChapter apaga a pasta inteira de um capítulo. Os demais capítulos do
// volume mantêm seus números (não há renumeração). Remove o volume se ficar
// vazio. Rejeita segmentos inseguros (path traversal).
func (s *Store) DeleteChapter(manga, volFolder, chapterFolder string) error {
	if !safeSeg(chapterFolder) {
		return os.ErrNotExist
	}
	if volFolder != "" && !safeSeg(volFolder) {
		return os.ErrNotExist
	}
	parent := s.subdir(manga, volFolder)
	if err := os.RemoveAll(filepath.Join(parent, chapterFolder)); err != nil {
		return err
	}
	if volFolder != "" {
		removeIfEmpty(parent)
	}
	return nil
}

// RenameChapter corrige o número de um capítulo renomeando a pasta "Cap old"
// para "Cap new" no mesmo volume. Colisão com um número existente → ErrChapterExists.
func (s *Store) RenameChapter(manga, volFolder, oldNumber, newNumber string) error {
	oldFolder := Sanitize("Cap " + oldNumber)
	newFolder := Sanitize("Cap " + newNumber)
	if !safeSeg(oldFolder) || !safeSeg(newFolder) {
		return os.ErrNotExist
	}
	if volFolder != "" && !safeSeg(volFolder) {
		return os.ErrNotExist
	}
	parent := s.subdir(manga, volFolder)
	src := filepath.Join(parent, oldFolder)
	dst := filepath.Join(parent, newFolder)
	if src == dst {
		return nil
	}
	if _, err := os.Stat(dst); err == nil {
		return domain.ErrChapterExists
	}
	return os.Rename(src, dst)
}

// coverChapterDir resolve o diretório do capítulo-alvo das operações de "capa".
// chapterFolder vazio = 1º capítulo do volume (a capa do volume inteiro);
// preenchido = aquele capítulo específico (1ª página só daquele capítulo).
// Rejeita segmentos inseguros (path traversal).
func (s *Store) coverChapterDir(manga, volFolder, chapterFolder string) (string, error) {
	if volFolder != "" && !safeSeg(volFolder) {
		return "", os.ErrNotExist
	}
	parent := s.subdir(manga, volFolder)
	if chapterFolder != "" {
		if !safeSeg(chapterFolder) {
			return "", os.ErrNotExist
		}
		return filepath.Join(parent, chapterFolder), nil
	}
	chFolder, ok := firstChapterFolder(parent)
	if !ok {
		return "", os.ErrNotExist
	}
	return filepath.Join(parent, chFolder), nil
}

// SetCover grava a 001.jpg do capítulo-alvo (ver coverChapterDir): sem
// chapterFolder é a capa do volume (1º capítulo); com ele é a 1ª página daquele
// capítulo. insert=true empurra as páginas em +1 (adicionar); insert=false
// sobrescreve a 001.jpg (trocar). O jpeg já vem convertido pelo handler.
//
// Antes de tudo, normaliza a numeração para 001..N (renumber): assim, se a pasta
// veio sem 001.jpg (ex.: a capa do site era 002.jpg), o "trocar" sobrescreve a
// página certa em vez de criar uma 001 extra (duplicata).
func (s *Store) SetCover(manga, volFolder, chapterFolder string, jpeg []byte, insert bool) error {
	dir, err := s.coverChapterDir(manga, volFolder, chapterFolder)
	if err != nil {
		return err
	}
	if err := renumber(dir); err != nil {
		return err
	}
	if insert {
		if err := shiftPagesUp(dir); err != nil {
			return err
		}
	}
	return os.WriteFile(filepath.Join(dir, "001.jpg"), jpeg, 0o644)
}

// FormatCover redimensiona a capa (1ª página) de UM capítulo-alvo para
// width×height, mantendo alta qualidade. Serve para quando o mangá já veio com
// capa e só se quer ajustar o tamanho, sem subir imagem nova. chapterFolder
// vazio = capa do volume (1º capítulo). width/height <= 0 é no-op.
func (s *Store) FormatCover(manga, volFolder, chapterFolder string, width, height int) error {
	if width <= 0 || height <= 0 {
		return nil
	}
	dir, err := s.coverChapterDir(manga, volFolder, chapterFolder)
	if err != nil {
		return err
	}
	if err := renumber(dir); err != nil {
		return err
	}
	cover := filepath.Join(dir, "001.jpg")
	data, err := os.ReadFile(cover)
	if err != nil {
		if os.IsNotExist(err) {
			return domain.ErrNoCover
		}
		return err
	}
	out, err := imageconv.ToJPEGSized(data, width, height)
	if err != nil {
		return err
	}
	return os.WriteFile(cover, out, 0o644)
}

// FormatCovers redimensiona a capa (1ª página do 1º capítulo) de TODOS os
// volumes da obra para width×height, mantendo alta qualidade (ToJPEGSized). É a
// versão em massa do "editar capa": a capa de cada volume é sempre a 001.jpg do
// seu 1º capítulo. Volumes sem capítulo/página são pulados. width/height <= 0 é
// no-op (o "Original" do frontend nem chega aqui).
func (s *Store) FormatCovers(manga string, width, height int) error {
	if width <= 0 || height <= 0 {
		return nil
	}
	tree, err := s.ScanManga(manga)
	if err != nil {
		return err
	}
	for _, vol := range tree.Volumes {
		dir, err := s.coverChapterDir(manga, vol.Folder, "")
		if err != nil {
			continue // volume sem capítulo
		}
		if err := renumber(dir); err != nil {
			return err
		}
		cover := filepath.Join(dir, "001.jpg")
		data, err := os.ReadFile(cover)
		if err != nil {
			continue // volume sem páginas
		}
		out, err := imageconv.ToJPEGSized(data, width, height)
		if err != nil {
			return err
		}
		if err := os.WriteFile(cover, out, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// AddPage acrescenta uma nova página ao FINAL do capítulo (00N+1.jpg), sem
// mexer nas existentes — o oposto de SetCover, que entra na 001.jpg. Endereçado
// por nomes de pasta, como o resto do editor. Normaliza a numeração antes
// (renumber) para o índice do fim ser exato. Rejeita segmentos inseguros.
func (s *Store) AddPage(manga, volFolder, chapterFolder string, jpeg []byte) error {
	if !safeSeg(chapterFolder) {
		return os.ErrNotExist
	}
	if volFolder != "" && !safeSeg(volFolder) {
		return os.ErrNotExist
	}
	dir := filepath.Join(s.subdir(manga, volFolder), chapterFolder)
	if err := renumber(dir); err != nil {
		return err
	}
	next := len(imagesIn(dir)) + 1
	return os.WriteFile(filepath.Join(dir, fmt.Sprintf("%03d.jpg", next)), jpeg, 0o644)
}

// RemoveCover apaga a 1ª página do capítulo-alvo (ver coverChapterDir) e
// renumera o restante. Sem páginas → ErrNoCover.
func (s *Store) RemoveCover(manga, volFolder, chapterFolder string) error {
	dir, err := s.coverChapterDir(manga, volFolder, chapterFolder)
	if err != nil {
		return err
	}
	names := imagesIn(dir)
	if len(names) == 0 {
		return domain.ErrNoCover
	}
	if err := os.Remove(filepath.Join(dir, names[0])); err != nil {
		return err
	}
	return renumber(dir)
}

// DeleteTreePage apaga uma página específica de um capítulo (endereçado por
// nomes de pasta, como o resto do editor) e renumera o restante para
// 001.jpg…00N.jpg. Rejeita segmentos inseguros (path traversal).
func (s *Store) DeleteTreePage(manga, volFolder, chapterFolder, name string) error {
	if !safeSeg(chapterFolder) || !safeSeg(name) {
		return os.ErrNotExist
	}
	if volFolder != "" && !safeSeg(volFolder) {
		return os.ErrNotExist
	}
	dir := filepath.Join(s.subdir(manga, volFolder), chapterFolder)
	if err := os.Remove(filepath.Join(dir, name)); err != nil {
		return err
	}
	return renumber(dir)
}

// ReorderPages reordena as páginas de um capítulo para a sequência em `order`
// (os nomes de arquivo atuais na ordem desejada) e as renumera para
// 001.jpg…00N.jpg. `order` precisa ser uma permutação exata das imagens no
// disco. A troca é feita em duas fases (nomes temporários → finais) para não
// colidir nomes existentes. Rejeita segmentos inseguros (path traversal).
func (s *Store) ReorderPages(manga, volFolder, chapterFolder string, order []string) error {
	if !safeSeg(chapterFolder) {
		return os.ErrNotExist
	}
	if volFolder != "" && !safeSeg(volFolder) {
		return os.ErrNotExist
	}
	dir := filepath.Join(s.subdir(manga, volFolder), chapterFolder)
	current := imagesIn(dir)
	if len(order) != len(current) {
		return domain.ErrBadOrder
	}
	remaining := make(map[string]bool, len(current))
	for _, n := range current {
		remaining[n] = true
	}
	for _, n := range order {
		if !safeSeg(n) || !remaining[n] {
			return domain.ErrBadOrder // nome desconhecido ou duplicado em `order`
		}
		delete(remaining, n)
	}
	// Fase 1: cada arquivo para um nome temporário oculto (não é imagem, então
	// imagesIn/renumber o ignoram se algo interromper no meio).
	for i, n := range order {
		tmp := fmt.Sprintf(".reorder_%03d", i+1)
		if err := os.Rename(filepath.Join(dir, n), filepath.Join(dir, tmp)); err != nil {
			return err
		}
	}
	// Fase 2: temporários → 001.jpg…00N.jpg na ordem pedida.
	for i := range order {
		tmp := fmt.Sprintf(".reorder_%03d", i+1)
		want := fmt.Sprintf("%03d.jpg", i+1)
		if err := os.Rename(filepath.Join(dir, tmp), filepath.Join(dir, want)); err != nil {
			return err
		}
	}
	return nil
}

// shiftPagesUp renomeia 00N→00N+1 (do maior para o menor) para abrir a 001.jpg.
func shiftPagesUp(dir string) error {
	names := imagesIn(dir)
	for i := len(names) - 1; i >= 0; i-- {
		want := fmt.Sprintf("%03d.jpg", i+2)
		if names[i] != want {
			if err := os.Rename(filepath.Join(dir, names[i]), filepath.Join(dir, want)); err != nil {
				return err
			}
		}
	}
	return nil
}

// firstChapterFolder devolve a pasta do capítulo numericamente primeiro de um volume.
func firstChapterFolder(parent string) (string, bool) {
	entries, err := os.ReadDir(parent)
	if err != nil {
		return "", false
	}
	var folders []string
	for _, e := range entries {
		if e.IsDir() && !isHidden(e.Name()) {
			folders = append(folders, e.Name())
		}
	}
	if len(folders) == 0 {
		return "", false
	}
	sort.Slice(folders, func(i, j int) bool { return numVal(folders[i]) < numVal(folders[j]) })
	return folders[0], true
}

// imagesIn lista as imagens de uma pasta em ordem numérica, sem criá-la.
func imagesIn(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && isImageName(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sortNumeric(names)
	return names
}

// sortChapters ordena capítulos pelo valor numérico do número (aceita "10.5").
func sortChapters(chs []domain.ChapterNode) {
	sort.Slice(chs, func(i, j int) bool { return numVal(chs[i].Number) < numVal(chs[j].Number) })
}

// removeIfEmpty remove a pasta se ela não tiver nenhuma entrada visível (ignora
// dotfiles como .DS_Store/._*). No-op se ainda houver conteúdo real.
func removeIfEmpty(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !isHidden(e.Name()) {
			return
		}
	}
	_ = os.RemoveAll(dir)
}

// isHidden reporta dotfiles (inclui .DS_Store e AppleDouble "._*").
func isHidden(name string) bool { return strings.HasPrefix(name, ".") }

// safeSeg valida que s é um único segmento de caminho seguro (sem separadores,
// sem "..", não vazio) — barreira contra path traversal nos endpoints do editor.
func safeSeg(s string) bool {
	if s == "" || s == "." || s == ".." {
		return false
	}
	return !strings.ContainsAny(s, `/\`) && !strings.ContainsRune(s, 0)
}

// numVal extrai o primeiro número (com decimal) de uma string, ex.: "Cap 10.5"→10.5,
// "Volume 15"→15. Sem dígitos → 0.
func numVal(s string) float64 {
	i := 0
	for i < len(s) && (s[i] < '0' || s[i] > '9') {
		i++
	}
	start := i
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i < len(s) && s[i] == '.' {
		i++
		for i < len(s) && s[i] >= '0' && s[i] <= '9' {
			i++
		}
	}
	if start == i {
		return 0
	}
	var whole, frac float64
	var fracDiv float64 = 1
	seenDot := false
	for _, c := range s[start:i] {
		if c == '.' {
			seenDot = true
			continue
		}
		d := float64(c - '0')
		if seenDot {
			fracDiv *= 10
			frac += d / fracDiv
		} else {
			whole = whole*10 + d
		}
	}
	return whole + frac
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
