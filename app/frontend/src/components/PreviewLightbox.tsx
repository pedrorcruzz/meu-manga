// Lightbox simples para ampliar as páginas de preview de um volume.
// Recebe a lista de imagens (data URLs) e o índice inicial; permite navegar
// entre elas com as setas do teclado e fecha com Esc ou clique fora.

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

interface PreviewLightboxProps {
  images: string[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}

export function PreviewLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: PreviewLightboxProps) {
  const total = images.length
  const clamped = Math.max(0, Math.min(index, total - 1))

  useEffect(() => {
    if (typeof window === 'undefined') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && clamped < total - 1)
        onIndexChange(clamped + 1)
      else if (e.key === 'ArrowLeft' && clamped > 0) onIndexChange(clamped - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clamped, total, onIndexChange, onClose])

  if (total === 0) return null
  const src = images[clamped]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Página ampliada"
      className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-black/95 p-4"
      onClick={onClose}
    >
      {/* Fechar */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar visualização"
        className="absolute right-4 top-4 rounded-full bg-neutral-800/80 p-2 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
      >
        <X size={20} />
      </button>

      {/* Anterior */}
      {clamped > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onIndexChange(clamped - 1)
          }}
          aria-label="Página anterior"
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-neutral-800/80 p-2 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
        >
          <ChevronLeft size={22} />
        </button>
      )}

      <img
        src={src}
        alt={`Página ${clamped + 1} de ${total}`}
        className="max-h-full max-w-full cursor-default object-contain"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Próxima */}
      {clamped < total - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onIndexChange(clamped + 1)
          }}
          aria-label="Próxima página"
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-neutral-800/80 p-2 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
        >
          <ChevronRight size={22} />
        </button>
      )}

      {/* Contador */}
      {total > 1 && (
        <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 font-mono text-xs text-neutral-300">
          {clamped + 1} / {total}
        </span>
      )}
    </div>
  )
}
