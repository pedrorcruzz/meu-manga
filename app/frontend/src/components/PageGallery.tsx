// Galeria de páginas de um capítulo baixado: visualização em grade com lightbox
// e exclusão individual de páginas (ex.: marca d'água do tradutor).

import { useEffect, useState } from 'react'
import { Loader2, Trash2, X } from 'lucide-react'
import { api } from '~/api/client'
import { useAsync } from '~/hooks/useAsync'

interface PageGalleryProps {
  jobId: string
  taskIndex: number
  chapterNumber: string
  onClose: () => void
}

export function PageGallery({
  jobId,
  taskIndex,
  chapterNumber,
  onClose,
}: PageGalleryProps) {
  const { data, reload, loading } = useAsync(
    () => api.listPages(jobId, taskIndex),
    [jobId, taskIndex],
  )

  const [lightboxPage, setLightboxPage] = useState<string | null>(null)
  const [deletingPage, setDeletingPage] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ESC fecha lightbox ou galeria
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (lightboxPage !== null) {
        setLightboxPage(null)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxPage, onClose])

  async function handleDelete(name: string) {
    setDeletingPage(name)
    setDeleteError(null)
    try {
      await api.deletePage(jobId, taskIndex, name)
      reload()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingPage(null)
    }
  }

  const pages = data?.pages ?? []

  return (
    <>
      {/* Overlay / painel principal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Páginas do capítulo ${chapterNumber}`}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
          {/* Cabeçalho */}
          <div className="flex items-center justify-between border-b border-neutral-800 p-4">
            <div>
              <h2 className="font-semibold">
                Capítulo {chapterNumber}
              </h2>
              <p className="text-xs text-neutral-500">
                {loading ? 'Carregando…' : `${pages.length} página${pages.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar galeria"
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <X size={18} />
            </button>
          </div>

          {/* Dica de uso */}
          <div className="border-b border-neutral-800 bg-neutral-950/40 px-4 py-2.5">
            <p className="text-xs text-neutral-500 leading-relaxed">
              Clique numa miniatura para ampliar. Use{' '}
              <Trash2 size={10} className="inline-block" aria-hidden="true" />{' '}
              para remover páginas desnecessárias (ex.: a marca d'água do tradutor
              na página 001) — as demais são renumeradas automaticamente. Pressione{' '}
              <kbd className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[10px]">Esc</kbd>{' '}
              para fechar.
            </p>
          </div>

          {/* Erro de exclusão */}
          {deleteError && (
            <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-2 text-xs text-red-400">
              Erro ao excluir: {deleteError}
            </div>
          )}

          {/* Conteúdo */}
          <div className="overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-neutral-500" />
              </div>
            ) : pages.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-500">
                Nenhuma página encontrada.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {pages.map((page) => (
                  <PageThumb
                    key={page}
                    page={page}
                    jobId={jobId}
                    taskIndex={taskIndex}
                    deleting={deletingPage === page}
                    onOpen={() => setLightboxPage(page)}
                    onDelete={() => void handleDelete(page)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxPage !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Página ${lightboxPage} em tamanho maior`}
          className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/95 p-4"
          onClick={() => setLightboxPage(null)}
        >
          <img
            src={api.pageImageUrl(jobId, taskIndex, lightboxPage)}
            alt={`Página ${lightboxPage}`}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxPage(null)}
            aria-label="Fechar visualização"
            className="absolute right-4 top-4 rounded-full bg-neutral-800/80 p-2 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  )
}

interface PageThumbProps {
  page: string
  jobId: string
  taskIndex: number
  deleting: boolean
  onOpen: () => void
  onDelete: () => void
}

function PageThumb({
  page,
  jobId,
  taskIndex,
  deleting,
  onOpen,
  onDelete,
}: PageThumbProps) {
  return (
    <div className="group relative">
      {/* Miniatura clicável */}
      <button
        type="button"
        className="w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        onClick={onOpen}
        aria-label={`Abrir página ${page} em tamanho maior`}
      >
        <img
          src={api.pageImageUrl(jobId, taskIndex, page)}
          alt={`Página ${page}`}
          loading="lazy"
          className="aspect-[2/3] w-full object-cover transition duration-150 group-hover:brightness-75"
        />
      </button>

      {/* Número da página */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300"
      >
        {page}
      </span>

      {/* Botão de exclusão */}
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        aria-label={`Excluir página ${page}`}
        className="absolute right-1 top-1 rounded bg-red-900/80 p-1 text-red-300 opacity-0 transition duration-150 group-hover:opacity-100 hover:bg-red-700 disabled:cursor-wait"
      >
        {deleting ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Trash2 size={12} />
        )}
      </button>
    </div>
  )
}
