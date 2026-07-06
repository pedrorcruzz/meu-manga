// Editor "Consertar volumes": lê a pasta em disco da obra e deixa reorganizar
// sem re-scrapear o site — mover capítulos entre volumes (drag-and-drop),
// adicionar/trocar/remover capa e corrigir o número de um capítulo. Tudo mexe só
// na pasta; as páginas se renumeram sozinhas no backend.

import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FolderInput,
  Hash,
  ImagePlus,
  Layers,
  Loader2,
  Trash2,
  X,
} from 'lucide-react'
import {
  api,
  type MangaTree,
  type TreeChapter,
  type TreeVolume,
} from '~/api/client'

interface VolumeEditorProps {
  jobId: string
  title: string
  onClose: () => void
}

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

export function VolumeEditor({ jobId, title, onClose }: VolumeEditorProps) {
  const [tree, setTree] = useState<MangaTree | null>(null)
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
    api
      .getMangaTree(jobId)
      .then((t) => alive && setTree(t))
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [jobId])

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
    void run(() => api.moveChapter(jobId, { fromVolume, toVolume, chapter }))
  }

  async function setCover(volume: string, mode: 'insert' | 'replace') {
    const file = await pickImageFile()
    if (!file) return
    const image = await fileToDataURL(file)
    void run(() => api.setCover(jobId, { volume, image, mode }))
  }

  function removeCover(volume: string) {
    void run(() => api.removeCover(jobId, volume))
  }

  function rename(volume: string, oldNumber: string, newNumber: string) {
    const n = newNumber.trim()
    if (n === '' || n === oldNumber) return
    void run(() => api.renameChapter(jobId, { volume, oldNumber, newNumber: n }))
  }

  function deletePage(volume: string, chapter: string, name: string) {
    void run(() => api.deleteTreePage(jobId, { volume, chapter, name }))
  }

  function reorderPages(volume: string, chapter: string, order: string[]) {
    void run(() => api.reorderPages(jobId, { volume, chapter, order }))
  }

  const empty =
    tree != null && tree.volumes.length === 0 && tree.loose.length === 0

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Consertar volumes de ${title}`}
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
                <Layers size={16} className="text-neutral-400" aria-hidden="true" />
                Consertar volumes
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
            <p className="text-xs leading-relaxed text-neutral-500">
              Arraste um capítulo para outro volume para movê-lo. Use a capa para{' '}
              <span className="text-neutral-400">adicionar</span> (cria uma nova 1ª
              página) ou <span className="text-neutral-400">trocar</span> a 001.jpg.
              Abra um capítulo para{' '}
              <span className="text-neutral-400">reordenar</span> ou{' '}
              <span className="text-neutral-400">apagar</span> páginas. As páginas se
              renumeram sozinhas. Nada é re-baixado — só a pasta em disco é alterada.
            </p>
          </div>

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
            ) : (
              <div className="space-y-4">
                {tree?.volumes.map((vol) => (
                  <VolumeSection
                    key={vol.folder}
                    jobId={jobId}
                    vol={vol}
                    drag={drag}
                    isDropTarget={dropTarget === vol.folder}
                    onDragChapter={setDrag}
                    onDragEnter={() => drag && setDropTarget(vol.folder)}
                    onDrop={() => drag && move(drag.fromVolume, vol.folder, drag.chapter)}
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
                    onRename={(oldN, newN) => rename(vol.folder, oldN, newN)}
                    busy={busy}
                  />
                ))}

                {/* Capítulos soltos (modo simples / sem volume) */}
                {tree && tree.loose.length > 0 && (
                  <VolumeSection
                    jobId={jobId}
                    vol={{ folder: '', name: 'Sem volume', chapters: tree.loose }}
                    drag={drag}
                    isDropTarget={dropTarget === '__loose__'}
                    onDragChapter={setDrag}
                    onDragEnter={() => drag && setDropTarget('__loose__')}
                    onDrop={() => drag && move(drag.fromVolume, '', drag.chapter)}
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
          jobId={jobId}
          preview={preview}
          pages={findChapter(tree, preview.volume, preview.folder)?.pages ?? 0}
          rev={rev}
          busy={busy}
          onOpenLightbox={setLightbox}
          onDeletePage={(name) =>
            deletePage(preview.volume, preview.folder, name)
          }
          onReorder={(order) =>
            reorderPages(preview.volume, preview.folder, order)
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
            src={api.mangaPageUrl(
              jobId,
              preview.volume,
              preview.folder,
              lightbox,
              rev,
            )}
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
  jobId: string
  vol: TreeVolume
  drag: Drag | null
  isDropTarget: boolean
  onDragChapter: (d: Drag | null) => void
  onDragEnter: () => void
  onDrop: () => void
  onOpenChapter: (ch: TreeChapter) => void
  onRename: (oldNumber: string, newNumber: string) => void
  busy: boolean
  /** Seção de capítulos soltos: sem controles de capa. */
  loose?: boolean
  onAddCover?: () => void
  onReplaceCover?: () => void
  onRemoveCover?: () => void
}

function VolumeSection({
  jobId,
  vol,
  drag,
  isDropTarget,
  onDragChapter,
  onDragEnter,
  onDrop,
  onOpenChapter,
  onRename,
  busy,
  loose,
  onAddCover,
  onReplaceCover,
  onRemoveCover,
}: VolumeSectionProps) {
  const dragging = drag != null
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
        <Layers size={12} className="shrink-0 text-neutral-500" aria-hidden="true" />
        <span className="font-mono text-xs font-bold text-neutral-200">
          {vol.name || 'Sem volume'}
        </span>
        <span className="font-mono text-[11px] text-neutral-600">
          {vol.chapters.length} cap.
        </span>
        {!loose && (
          <div className="ml-auto flex items-center gap-1.5">
            <CoverButton
              label="Adicionar capa"
              icon={<ImagePlus size={11} aria-hidden="true" />}
              onClick={onAddCover}
              disabled={busy || vol.chapters.length === 0}
              title="Escolhe uma imagem e cria uma nova 1ª página (001.jpg), empurrando as demais"
            />
            <CoverButton
              label="Trocar 1ª pág."
              onClick={onReplaceCover}
              disabled={busy || vol.chapters.length === 0}
              title="Substitui a 001.jpg atual do 1º capítulo, sem empurrar as páginas"
            />
            <CoverButton
              label="Remover 1ª pág."
              icon={<Trash2 size={11} aria-hidden="true" />}
              onClick={onRemoveCover}
              disabled={busy || vol.chapters.length === 0}
              title="Apaga a 001.jpg (capa) do 1º capítulo e renumera o restante"
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
              jobId={jobId}
              volumeFolder={vol.folder}
              ch={ch}
              onDragStart={() =>
                onDragChapter({ fromVolume: vol.folder, chapter: ch.folder })
              }
              onDragEnd={() => onDragChapter(null)}
              onOpen={() => onOpenChapter(ch)}
              onRename={(newN) => onRename(ch.number, newN)}
              busy={busy}
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
  jobId: string
  volumeFolder: string
  ch: TreeChapter
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
  onRename: (newNumber: string) => void
  busy: boolean
}

function ChapterCard({
  jobId,
  volumeFolder,
  ch,
  onDragStart,
  onDragEnd,
  onOpen,
  onRename,
  busy,
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
      draggable={!editing}
      onDragStart={(e) => {
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
            src={api.mangaPageUrl(jobId, volumeFolder, ch.folder, ch.firstPage)}
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
              Cap. <span className="font-medium text-neutral-100">{ch.number}</span>
            </span>
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
          </>
        )}
      </div>
    </div>
  )
}

// ── Preview das páginas de um capítulo ───────────────────────────────────────────

interface ChapterPreviewProps {
  jobId: string
  preview: Preview
  /** Nº de páginas no disco (vem da árvore viva). */
  pages: number
  /** Contador de mutações para furar o cache de <img>. */
  rev: number
  busy: boolean
  onOpenLightbox: (name: string) => void
  onDeletePage: (name: string) => void
  onReorder: (order: string[]) => void
  onClose: () => void
}

function ChapterPreview({
  jobId,
  preview,
  pages,
  rev,
  busy,
  onOpenLightbox,
  onDeletePage,
  onReorder,
  onClose,
}: ChapterPreviewProps) {
  // As páginas em disco são sempre 001.jpg…00N.jpg (renumeradas pelo backend).
  const names = Array.from(
    { length: pages },
    (_, i) => `${String(i + 1).padStart(3, '0')}.jpg`,
  )
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

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
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Apagar a página ${name}? As demais serão renumeradas.`)
    )
      return
    onDeletePage(name)
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
              {pages} página{pages !== 1 ? 's' : ''} · arraste para reordenar,
              use as setas ou apague
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
        <div className="overflow-y-auto p-4">
          {names.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Capítulo sem páginas.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {names.map((name, i) => (
                <div
                  key={name}
                  draggable={!busy}
                  onDragStart={(e) => {
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
                    busy ? '' : 'cursor-grab active:cursor-grabbing'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenLightbox(name)}
                    aria-label={`Ampliar página ${name}`}
                    className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    <img
                      src={api.mangaPageUrl(
                        jobId,
                        preview.volume,
                        preview.folder,
                        name,
                        rev,
                      )}
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
