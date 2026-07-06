// Editor "Consertar volumes": lê a pasta em disco da obra e deixa reorganizar
// sem re-scrapear o site — mover capítulos entre volumes (drag-and-drop),
// adicionar/trocar/remover capa e corrigir o número de um capítulo. Tudo mexe só
// na pasta; as páginas se renumeram sozinhas no backend.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FilePlus,
  FolderInput,
  Hash,
  ImagePlus,
  Layers,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  type MangaTree,
  type TreeChapter,
  type TreeEditorApi,
  type TreeVolume,
} from '~/api/client'
import { ConfirmDialog } from '~/components/ConfirmDialog'
import { volumeNumber } from '~/lib/volumeName'

interface VolumeEditorProps {
  /** Adaptador do backend (download do histórico ou pasta arbitrária no disco). */
  editor: TreeEditorApi
  title: string
  /**
   * Número do volume a focar ao abrir (ex.: aberto a partir de um download
   * específico). Presente → começa mostrando só esse volume, com opção de ver
   * todos. Ausente → mostra todos (ex.: aberto por "Meus Mangás").
   */
  focusVolume?: number
  /**
   * Modo somente-leitura: nenhuma ação de conserto/edição aparece (sem mover,
   * capa, renumerar, apagar/reordenar páginas). Serve como preview puro do que
   * já está no disco — capítulos e páginas continuam abrindo em tela cheia.
   */
  readOnly?: boolean
  onClose: () => void
}

/** URL de uma página (do adaptador ativo). */
type PageUrl = TreeEditorApi['pageUrl']

/** Capítulo sendo arrastado (origem). */
type Drag = { fromVolume: string; chapter: string }
/** Capítulo aberto no preview de páginas (nº de páginas vem sempre da árvore viva). */
type Preview = { volume: string; folder: string; number: string }

/** Acha um capítulo na árvore por volume+pasta (volume "" = capítulo solto). */
function findChapter(
  tree: MangaTree | null,
  volume: string,
  folder: string,
): TreeChapter | undefined {
  if (!tree) return undefined
  const list =
    volume === ''
      ? tree.loose
      : tree.volumes.find((v) => v.folder === volume)?.chapters
  return list?.find((c) => c.folder === folder)
}

/** Cópia de `arr` com o item em `from` reposicionado para `to`. */
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice()
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function VolumeEditor({
  editor,
  title,
  focusVolume,
  readOnly = false,
  onClose,
}: VolumeEditorProps) {
  const [tree, setTree] = useState<MangaTree | null>(null)
  // Escopo do editor: 'all' = todos os volumes · número = só aquele volume.
  const [scope, setScope] = useState<number | 'all'>(focusVolume ?? 'all')
  // Busca por número de volume (filtra dentro do escopo "todos").
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  // Bumpa a cada mutação para furar o cache de <img> (o nome 001.jpg passa a
  // apontar para outro conteúdo após reordenar/apagar).
  const [rev, setRev] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    editor
      .getTree()
      .then((t) => alive && setTree(t))
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [editor])

  // ESC fecha o preview/lightbox aberto ou, se nada aberto, o editor.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (lightbox !== null) setLightbox(null)
      else if (preview !== null) setPreview(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, preview, onClose])

  // Aplica uma mutação que devolve a árvore fresca do backend.
  async function run(fn: () => Promise<MangaTree>) {
    setBusy(true)
    setError(null)
    try {
      setTree(await fn())
      setRev((r) => r + 1)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  function move(fromVolume: string, toVolume: string, chapter: string) {
    setDrag(null)
    setDropTarget(null)
    if (fromVolume === toVolume) return
    void run(() => editor.moveChapter({ fromVolume, toVolume, chapter }))
  }

  async function setCover(volume: string, mode: 'insert' | 'replace') {
    const file = await pickImageFile()
    if (!file) return
    const image = await fileToDataURL(file)
    void run(() => editor.setCover({ volume, image, mode }))
  }

  function removeCover(volume: string) {
    void run(() => editor.removeCover(volume))
  }

  // Remove a última página do volume: a última página do último capítulo. O
  // backend renumera sozinho (aqui já é o fim, então nada se desloca).
  function removeLastPage(vol: TreeVolume) {
    const last = vol.chapters[vol.chapters.length - 1]
    if (!last || last.pages <= 0) return
    const name = `${String(last.pages).padStart(3, '0')}.jpg`
    void run(() =>
      editor.deleteTreePage({ volume: vol.folder, chapter: last.folder, name }),
    )
  }

  // ── Ações escopadas a UM capítulo (dentro do preview) ──────────────────────
  // Mesmas operações da capa, mas mirando a pasta do capítulo aberto — afetam só
  // ele, sem tocar no resto do volume (o backend recebe o chapterFolder).

  async function setCoverChapter(
    volume: string,
    chapter: string,
    mode: 'insert' | 'replace',
  ) {
    const file = await pickImageFile()
    if (!file) return
    const image = await fileToDataURL(file)
    void run(() => editor.setCover({ volume, chapter, image, mode }))
  }

  // Acrescenta uma imagem escolhida como nova última página SÓ deste capítulo.
  async function addPageChapter(volume: string, chapter: string) {
    const file = await pickImageFile()
    if (!file) return
    const image = await fileToDataURL(file)
    void run(() => editor.addPage({ volume, chapter, image }))
  }

  function removeFirstPageChapter(volume: string, chapter: string) {
    void run(() => editor.removeCover(volume, chapter))
  }

  function removeLastPageChapter(
    volume: string,
    chapter: string,
    pages: number,
  ) {
    if (pages <= 0) return
    const name = `${String(pages).padStart(3, '0')}.jpg`
    void run(() => editor.deleteTreePage({ volume, chapter, name }))
  }

  function rename(volume: string, oldNumber: string, newNumber: string) {
    const n = newNumber.trim()
    if (n === '' || n === oldNumber) return
    void run(() => editor.renameChapter({ volume, oldNumber, newNumber: n }))
  }

  function deletePage(volume: string, chapter: string, name: string) {
    void run(() => editor.deleteTreePage({ volume, chapter, name }))
  }

  function reorderPages(volume: string, chapter: string, order: string[]) {
    void run(() => editor.reorderPages({ volume, chapter, order }))
  }

  const empty =
    tree != null && tree.volumes.length === 0 && tree.loose.length === 0

  // Volumes visíveis após escopo + busca. A busca casa nome/pasta do volume ou o
  // número de qualquer capítulo dele.
  const visibleVolumes = useMemo(() => {
    const all = tree?.volumes ?? []
    const q = query.trim().toLowerCase()
    return all.filter((vol) => {
      if (scope !== 'all' && volumeNumber(vol.name) !== scope) return false
      if (!q) return true
      if (vol.name.toLowerCase().includes(q)) return true
      if (vol.folder.toLowerCase().includes(q)) return true
      return vol.chapters.some((c) => c.number.toLowerCase().includes(q))
    })
  }, [tree, scope, query])

  // Opções do seletor de escopo (um volume por número, ordenado).
  const volumeOptions = useMemo(() => {
    const opts: { value: number; label: string }[] = []
    for (const vol of tree?.volumes ?? []) {
      const n = volumeNumber(vol.name)
      if (n != null) opts.push({ value: n, label: vol.name })
    }
    return opts.sort((a, b) => a.value - b.value)
  }, [tree])

  // Capítulos soltos só aparecem quando não há um volume específico em foco.
  const showLoose = scope === 'all' && (tree?.loose.length ?? 0) > 0
  // Nada casou o escopo/busca, embora a pasta tenha conteúdo.
  const noMatch =
    !empty && !loading && visibleVolumes.length === 0 && !showLoose

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${readOnly ? 'Visualizar' : 'Consertar'} volumes de ${title}`}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
          {/* Cabeçalho */}
          <div className="flex items-center justify-between border-b border-neutral-800 p-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 font-semibold text-neutral-100">
                <Layers
                  size={16}
                  className="text-neutral-400"
                  aria-hidden="true"
                />
                {readOnly ? 'Visualizar volume' : 'Consertar volumes'}
              </h2>
              <p className="truncate text-xs text-neutral-500">{title}</p>
            </div>
            <div className="flex items-center gap-2">
              {busy && (
                <Loader2
                  size={16}
                  className="animate-spin text-neutral-500"
                  aria-label="Aplicando…"
                />
              )}
              <button
                onClick={onClose}
                aria-label="Fechar editor"
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Dica */}
          <div className="border-b border-neutral-800 bg-neutral-950/40 px-4 py-2.5">
            {readOnly ? (
              <p className="text-xs leading-relaxed text-neutral-500">
                <span className="text-neutral-400">Abra um capítulo</span> para
                ver as páginas em tela cheia. É só um preview do que está no
                disco — nada aqui é alterado.
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-neutral-500">
                Arraste um capítulo para outro volume para movê-lo. Os botões{' '}
                <span className="text-neutral-400">Volume inteiro</span> no topo
                de cada volume mexem na capa/páginas do volume (1º/último
                capítulo).{' '}
                <span className="text-neutral-400">Abra um capítulo</span> para
                reordenar/apagar páginas ou mexer na capa e nas 1ª/última
                páginas <span className="text-neutral-400">só dele</span>. As
                páginas se renumeram sozinhas. Nada é re-baixado — só a pasta em
                disco é alterada.
              </p>
            )}
          </div>

          {/* Busca + escopo (só quando há volumes) */}
          {!loading && !empty && (tree?.volumes.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950/40 px-4 py-2.5">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar volume… (ex: 003, 3)"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-2 pl-9 pr-9 text-sm placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
                  aria-label="Buscar volume"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Limpar busca"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-600 transition-colors hover:text-neutral-300"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <select
                value={scope === 'all' ? 'all' : String(scope)}
                onChange={(e) =>
                  setScope(
                    e.target.value === 'all' ? 'all' : Number(e.target.value),
                  )
                }
                className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm text-neutral-200 focus:border-neutral-600 focus:outline-none"
                aria-label="Volume a exibir"
              >
                <option value="all">Todos os volumes</option>
                {volumeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {scope !== 'all' && (
                <button
                  type="button"
                  onClick={() => setScope('all')}
                  className="rounded-lg border border-neutral-700 px-2.5 py-2 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
                >
                  Ver todos
                </button>
              )}
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Conteúdo */}
          <div className="overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-neutral-500" />
              </div>
            ) : empty ? (
              <p className="py-8 text-center text-sm text-neutral-500">
                Nada encontrado na pasta desta obra.
              </p>
            ) : noMatch ? (
              <p className="py-8 text-center text-sm text-neutral-500">
                Nenhum volume corresponde à busca.
              </p>
            ) : (
              <div className="space-y-4">
                {visibleVolumes.map((vol) => (
                  <VolumeSection
                    key={vol.folder}
                    pageUrl={editor.pageUrl}
                    vol={vol}
                    drag={drag}
                    isDropTarget={dropTarget === vol.folder}
                    onDragChapter={setDrag}
                    onDragEnter={() => drag && setDropTarget(vol.folder)}
                    onDrop={() =>
                      drag && move(drag.fromVolume, vol.folder, drag.chapter)
                    }
                    onOpenChapter={(ch) =>
                      setPreview({
                        volume: vol.folder,
                        folder: ch.folder,
                        number: ch.number,
                      })
                    }
                    onAddCover={() => void setCover(vol.folder, 'insert')}
                    onReplaceCover={() => void setCover(vol.folder, 'replace')}
                    onRemoveCover={() => removeCover(vol.folder)}
                    onRemoveLastPage={() => removeLastPage(vol)}
                    onRename={(oldN, newN) => rename(vol.folder, oldN, newN)}
                    busy={busy}
                    rev={rev}
                    readOnly={readOnly}
                  />
                ))}

                {/* Capítulos soltos (modo simples / sem volume) */}
                {tree && showLoose && (
                  <VolumeSection
                    pageUrl={editor.pageUrl}
                    vol={{
                      folder: '',
                      name: 'Sem volume',
                      chapters: tree.loose,
                    }}
                    drag={drag}
                    isDropTarget={dropTarget === '__loose__'}
                    onDragChapter={setDrag}
                    onDragEnter={() => drag && setDropTarget('__loose__')}
                    onDrop={() =>
                      drag && move(drag.fromVolume, '', drag.chapter)
                    }
                    onOpenChapter={(ch) =>
                      setPreview({
                        volume: '',
                        folder: ch.folder,
                        number: ch.number,
                      })
                    }
                    loose
                    onRename={(oldN, newN) => rename('', oldN, newN)}
                    busy={busy}
                    rev={rev}
                    readOnly={readOnly}
                  />
                )}
              </div>
            )}
          </div>

          {/* Rodapé com o caminho da pasta */}
          {tree?.root && (
            <div className="border-t border-neutral-800 px-4 py-2">
              <p
                className="truncate font-mono text-[10px] text-neutral-600"
                title={tree.root}
              >
                {tree.root}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Preview das páginas de um capítulo */}
      {preview && (
        <ChapterPreview
          pageUrl={editor.pageUrl}
          preview={preview}
          pages={findChapter(tree, preview.volume, preview.folder)?.pages ?? 0}
          rev={rev}
          busy={busy}
          readOnly={readOnly}
          onOpenLightbox={setLightbox}
          onDeletePage={(name) =>
            deletePage(preview.volume, preview.folder, name)
          }
          onReorder={(order) =>
            reorderPages(preview.volume, preview.folder, order)
          }
          onAddCover={() =>
            void setCoverChapter(preview.volume, preview.folder, 'insert')
          }
          onReplaceCover={() =>
            void setCoverChapter(preview.volume, preview.folder, 'replace')
          }
          onAddPage={() => void addPageChapter(preview.volume, preview.folder)}
          onRemoveFirstPage={() =>
            removeFirstPageChapter(preview.volume, preview.folder)
          }
          onRemoveLastPage={() =>
            removeLastPageChapter(
              preview.volume,
              preview.folder,
              findChapter(tree, preview.volume, preview.folder)?.pages ?? 0,
            )
          }
          onClose={() => setPreview(null)}
        />
      )}

      {/* Lightbox de uma página */}
      {lightbox !== null && preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Página ampliada"
          className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-black/95 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={editor.pageUrl(preview.volume, preview.folder, lightbox, rev)}
            alt={`Página ${lightbox}`}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

// ── Seção de um volume ──────────────────────────────────────────────────────────

interface VolumeSectionProps {
  pageUrl: PageUrl
  vol: TreeVolume
  drag: Drag | null
  isDropTarget: boolean
  onDragChapter: (d: Drag | null) => void
  onDragEnter: () => void
  onDrop: () => void
  onOpenChapter: (ch: TreeChapter) => void
  onRename: (oldNumber: string, newNumber: string) => void
  busy: boolean
  /** Contador de mutações para furar o cache de <img> das miniaturas. */
  rev: number
  /** Preview puro: esconde os controles de conserto (mover/capa/renumerar). */
  readOnly?: boolean
  /** Seção de capítulos soltos: sem controles de capa. */
  loose?: boolean
  onAddCover?: () => void
  onReplaceCover?: () => void
  onRemoveCover?: () => void
  onRemoveLastPage?: () => void
}

function VolumeSection({
  pageUrl,
  vol,
  drag,
  isDropTarget,
  onDragChapter,
  onDragEnter,
  onDrop,
  onOpenChapter,
  onRename,
  busy,
  rev,
  readOnly,
  loose,
  onAddCover,
  onReplaceCover,
  onRemoveCover,
  onRemoveLastPage,
}: VolumeSectionProps) {
  const dragging = drag != null && !readOnly
  return (
    <div
      onDragOver={(e) => {
        if (dragging) e.preventDefault()
      }}
      onDragEnter={onDragEnter}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      className={`rounded-lg border bg-neutral-950/30 transition-colors ${
        isDropTarget && dragging
          ? 'border-sky-700/70 bg-sky-950/20'
          : 'border-neutral-800/70'
      }`}
    >
      {/* Cabeçalho do volume */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800/60 px-3 py-2">
        <Layers
          size={12}
          className="shrink-0 text-neutral-500"
          aria-hidden="true"
        />
        <span className="font-mono text-xs font-bold text-neutral-200">
          {vol.name || 'Sem volume'}
        </span>
        <span className="font-mono text-[11px] text-neutral-600">
          {vol.chapters.length} cap.
        </span>
        {!loose && !readOnly && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950/40 px-2 py-1">
            <span className="mr-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
              Volume inteiro
            </span>
            <CoverButton
              label="Adicionar capa"
              icon={<ImagePlus size={11} aria-hidden="true" />}
              onClick={onAddCover}
              disabled={busy || vol.chapters.length === 0}
              title="Capa do VOLUME: cria uma nova 1ª página (001.jpg) no 1º capítulo, empurrando as demais. Para um capítulo específico, abra-o e use as ações de dentro."
            />
            <CoverButton
              label="Trocar 1ª pág."
              onClick={onReplaceCover}
              disabled={busy || vol.chapters.length === 0}
              title="Capa do VOLUME: substitui a 001.jpg do 1º capítulo, sem empurrar as páginas"
            />
            <CoverButton
              label="Remover 1ª pág."
              icon={<Trash2 size={11} aria-hidden="true" />}
              onClick={onRemoveCover}
              disabled={busy || vol.chapters.length === 0}
              title="Capa do VOLUME: apaga a 001.jpg do 1º capítulo e renumera o restante"
            />
            <CoverButton
              label="Remover última pág."
              icon={<Trash2 size={11} aria-hidden="true" />}
              onClick={onRemoveLastPage}
              disabled={busy || vol.chapters.length === 0}
              title="Apaga a última página do ÚLTIMO capítulo do volume"
            />
          </div>
        )}
      </div>

      {/* Capítulos */}
      {vol.chapters.length === 0 ? (
        <p className="px-3 py-4 text-center font-mono text-[11px] text-neutral-600">
          {dragging ? 'Solte aqui para mover' : 'Volume vazio'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4">
          {vol.chapters.map((ch) => (
            <ChapterCard
              key={ch.folder}
              pageUrl={pageUrl}
              volumeFolder={vol.folder}
              ch={ch}
              onDragStart={() =>
                onDragChapter({ fromVolume: vol.folder, chapter: ch.folder })
              }
              onDragEnd={() => onDragChapter(null)}
              onOpen={() => onOpenChapter(ch)}
              onRename={(newN) => onRename(ch.number, newN)}
              busy={busy}
              rev={rev}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CoverButton({
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  label: string
  icon?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  )
}

// ── Card de capítulo (arrastável) ────────────────────────────────────────────────

interface ChapterCardProps {
  pageUrl: PageUrl
  volumeFolder: string
  ch: TreeChapter
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
  onRename: (newNumber: string) => void
  busy: boolean
  rev: number
  readOnly?: boolean
}

function ChapterCard({
  pageUrl,
  volumeFolder,
  ch,
  onDragStart,
  onDragEnd,
  onOpen,
  onRename,
  busy,
  rev,
  readOnly,
}: ChapterCardProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(ch.number)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    setEditing(false)
    onRename(value)
  }

  return (
    <div
      draggable={!editing && !readOnly}
      onDragStart={(e) => {
        if (readOnly) return
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/60 transition-colors hover:border-neutral-700"
    >
      {/* Miniatura clicável → preview */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Ver páginas do capítulo ${ch.number}`}
        className="relative block aspect-[2/3] w-full overflow-hidden bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
      >
        {ch.firstPage ? (
          <img
            src={pageUrl(volumeFolder, ch.folder, ch.firstPage, rev)}
            alt={`Capa do capítulo ${ch.number}`}
            loading="lazy"
            className="h-full w-full object-cover transition duration-150 group-hover:brightness-75"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-700">
            <Layers size={20} aria-hidden="true" />
          </div>
        )}
        <span className="pointer-events-none absolute right-1 top-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
          <FolderInput size={9} aria-hidden="true" />
          {ch.pages}p
        </span>
      </button>

      {/* Rodapé: número + corrigir número */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        {editing ? (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') {
                setValue(ch.number)
                setEditing(false)
              }
            }}
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 font-mono text-xs text-neutral-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
            aria-label="Novo número do capítulo"
          />
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-300">
              Cap.{' '}
              <span className="font-medium text-neutral-100">{ch.number}</span>
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  setValue(ch.number)
                  setEditing(true)
                }}
                disabled={busy}
                aria-label={`Corrigir o número do capítulo ${ch.number}`}
                title="Corrigir o número do capítulo"
                className="rounded p-0.5 text-neutral-500 opacity-0 transition hover:bg-neutral-800 hover:text-neutral-200 group-hover:opacity-100 disabled:opacity-40"
              >
                <Hash size={12} aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Preview das páginas de um capítulo ───────────────────────────────────────────

interface ChapterPreviewProps {
  pageUrl: PageUrl
  preview: Preview
  /** Nº de páginas no disco (vem da árvore viva). */
  pages: number
  /** Contador de mutações para furar o cache de <img>. */
  rev: number
  busy: boolean
  /** Preview puro: só ampliar/filtrar páginas, sem reordenar/apagar/capa. */
  readOnly?: boolean
  onOpenLightbox: (name: string) => void
  onDeletePage: (name: string) => void
  onReorder: (order: string[]) => void
  /** Ações que afetam SÓ este capítulo (espelham as globais do volume). */
  onAddCover: () => void
  onReplaceCover: () => void
  onAddPage: () => void
  onRemoveFirstPage: () => void
  onRemoveLastPage: () => void
  onClose: () => void
}

function ChapterPreview({
  pageUrl,
  preview,
  pages,
  rev,
  busy,
  readOnly,
  onOpenLightbox,
  onDeletePage,
  onReorder,
  onAddCover,
  onReplaceCover,
  onAddPage,
  onRemoveFirstPage,
  onRemoveLastPage,
  onClose,
}: ChapterPreviewProps) {
  // As páginas em disco são sempre 001.jpg…00N.jpg (renumeradas pelo backend).
  const names = Array.from(
    { length: pages },
    (_, i) => `${String(i + 1).padStart(3, '0')}.jpg`,
  )
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  // Página aguardando confirmação de exclusão (popup da própria interface).
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  // Busca por número da página (ex.: "45" ou "045"). Mantemos o índice real de
  // cada página (para reordenar/apagar), só escondemos as que não batem.
  const [pageQuery, setPageQuery] = useState('')
  const q = pageQuery.trim()
  const matchesQuery = (i: number) => {
    if (!q) return true
    const n = String(i + 1)
    return n.includes(q) || n.padStart(3, '0').includes(q)
  }
  const matchCount = q
    ? names.filter((_, i) => matchesQuery(i)).length
    : names.length

  // Reposiciona a página de `from` para `to` (envia a nova ordem ao backend).
  function moveTo(from: number, to: number) {
    if (busy || to < 0 || to >= names.length || from === to) return
    onReorder(arrayMove(names, from, to))
  }

  function handleDrop() {
    if (dragIdx !== null && overIdx !== null) moveTo(dragIdx, overIdx)
    setDragIdx(null)
    setOverIdx(null)
  }

  function handleDelete(name: string) {
    if (busy) return
    setConfirmDel(name)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Páginas do capítulo ${preview.number}`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 p-4">
          <div>
            <h3 className="font-semibold text-neutral-100">
              Capítulo {preview.number}
            </h3>
            <p className="text-xs text-neutral-500">
              {pages} página{pages !== 1 ? 's' : ''}
              {readOnly
                ? ' · clique para ampliar'
                : ' · arraste para reordenar, use as setas ou apague'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {busy && (
              <Loader2
                size={16}
                className="animate-spin text-neutral-500"
                aria-label="Aplicando…"
              />
            )}
            <button
              onClick={onClose}
              aria-label="Fechar preview"
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        {/* Ações que afetam SÓ este capítulo (espelham as globais do volume) */}
        {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-800 bg-neutral-950/40 px-4 py-2.5">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
            Só este capítulo
          </span>
          <CoverButton
            label="Adicionar capa"
            icon={<ImagePlus size={11} aria-hidden="true" />}
            onClick={onAddCover}
            disabled={busy}
            title="Escolhe uma imagem e cria uma nova 1ª página (001.jpg) SÓ neste capítulo, empurrando as demais"
          />
          <CoverButton
            label="Trocar 1ª pág."
            onClick={onReplaceCover}
            disabled={busy || pages === 0}
            title="Substitui a 001.jpg SÓ deste capítulo, sem empurrar as páginas"
          />
          <CoverButton
            label="Adicionar página"
            icon={<FilePlus size={11} aria-hidden="true" />}
            onClick={onAddPage}
            disabled={busy}
            title="Escolhe uma imagem e a acrescenta como nova última página SÓ deste capítulo"
          />
          <CoverButton
            label="Remover 1ª pág."
            icon={<Trash2 size={11} aria-hidden="true" />}
            onClick={onRemoveFirstPage}
            disabled={busy || pages === 0}
            title="Apaga a 1ª página (001.jpg) SÓ deste capítulo e renumera o restante"
          />
          <CoverButton
            label="Remover última pág."
            icon={<Trash2 size={11} aria-hidden="true" />}
            onClick={onRemoveLastPage}
            disabled={busy || pages === 0}
            title="Apaga a última página SÓ deste capítulo"
          />
        </div>
        )}

        {/* Busca por número da página */}
        {names.length > 0 && (
          <div className="border-b border-neutral-800 px-4 py-2.5">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"
                aria-hidden="true"
              />
              <input
                type="text"
                inputMode="numeric"
                value={pageQuery}
                onChange={(e) => setPageQuery(e.target.value)}
                placeholder="Filtrar por número da página… (ex: 45, 045)"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950/60 py-2 pl-9 pr-9 text-sm placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
                aria-label="Filtrar páginas por número"
              />
              {pageQuery && (
                <button
                  type="button"
                  onClick={() => setPageQuery('')}
                  aria-label="Limpar busca"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-600 transition-colors hover:text-neutral-300"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="overflow-y-auto p-4">
          {names.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Capítulo sem páginas.
            </p>
          ) : matchCount === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Nenhuma página com “{q}”.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {names.map((name, i) =>
                matchesQuery(i) ? (
                  <div
                    key={name}
                    draggable={!busy && !readOnly}
                    onDragStart={(e) => {
                      if (readOnly) return
                      e.dataTransfer.effectAllowed = 'move'
                      setDragIdx(i)
                    }}
                    onDragEnter={() => dragIdx !== null && setOverIdx(i)}
                    onDragOver={(e) => {
                      if (dragIdx !== null) e.preventDefault()
                    }}
                    onDragEnd={() => {
                      setDragIdx(null)
                      setOverIdx(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      handleDrop()
                    }}
                    className={`group relative overflow-hidden rounded-lg border bg-neutral-800 transition-colors ${
                      overIdx === i && dragIdx !== null && dragIdx !== i
                        ? 'border-sky-500 ring-2 ring-sky-500'
                        : 'border-neutral-800'
                    } ${dragIdx === i ? 'opacity-40' : ''} ${
                      busy || readOnly ? '' : 'cursor-grab active:cursor-grabbing'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenLightbox(name)}
                      aria-label={`Ampliar página ${name}`}
                      className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    >
                      <img
                        src={pageUrl(preview.volume, preview.folder, name, rev)}
                        alt={`Página ${name}`}
                        loading="lazy"
                        draggable={false}
                        className="aspect-[2/3] w-full object-cover transition duration-150 group-hover:brightness-50"
                      />
                    </button>
                    <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
                      {i + 1}
                    </span>
                    {/* Controles: mover ‹ ›, apagar */}
                    {!readOnly && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/80 to-transparent p-1 opacity-0 transition group-hover:opacity-100">
                      <PageBtn
                        label={`Mover página ${name} para trás`}
                        onClick={() => moveTo(i, i - 1)}
                        disabled={busy || i === 0}
                      >
                        <ChevronLeft size={13} aria-hidden="true" />
                      </PageBtn>
                      <PageBtn
                        label={`Mover página ${name} para frente`}
                        onClick={() => moveTo(i, i + 1)}
                        disabled={busy || i === names.length - 1}
                      >
                        <ChevronRight size={13} aria-hidden="true" />
                      </PageBtn>
                      <PageBtn
                        label={`Apagar página ${name}`}
                        onClick={() => handleDelete(name)}
                        disabled={busy}
                        danger
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </PageBtn>
                    </div>
                    )}
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
      </div>
      {confirmDel !== null && (
        <ConfirmDialog
          title="Apagar página?"
          message={
            <>
              Apagar a página{' '}
              <span className="font-semibold text-neutral-200">
                {confirmDel}
              </span>
              ? As demais serão renumeradas.
            </>
          }
          confirmLabel="Apagar"
          onConfirm={() => {
            onDeletePage(confirmDel)
            setConfirmDel(null)
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// Botão de controle de uma página (sobreposto na miniatura).
function PageBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`pointer-events-auto rounded p-1 text-neutral-100 transition disabled:opacity-30 ${
        danger
          ? 'bg-red-900/70 hover:bg-red-700'
          : 'bg-neutral-700/80 hover:bg-neutral-600'
      }`}
    >
      {children}
    </button>
  )
}

// ── Helpers de arquivo ───────────────────────────────────────────────────────────

/** Abre o seletor nativo de arquivo de imagem. Resolve null se cancelado. */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

/** Lê um File como data URL base64 (para enviar ao backend). */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
