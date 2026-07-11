// Popup "Editar capa": mostra SÓ o seletor de formato (Kindle / Personalizado) e,
// ao aplicar, redimensiona a(s) capa(s) existente(s) para o formato escolhido —
// serve tanto para a ação em massa (todos os volumes) quanto para um capítulo
// específico. "Original" não muda nada, então o botão de aplicar fica
// desabilitado nesse caso.

import { useState, type ReactNode } from 'react'
import { Loader2, RotateCcw, Wand2, X } from 'lucide-react'
import { CoverFormatPicker } from '~/components/CoverFormatPicker'
import {
  ORIGINAL_FORMAT,
  formatDims,
  formatMeta,
  type CoverFormat,
} from '~/lib/kindleFormats'

export function CoverFormatModal({
  title = 'Editar capa de todos os volumes',
  description,
  previewUrl,
  currentLabel,
  onRevert,
  busy,
  onApply,
  onClose,
}: {
  /** Título do cabeçalho. */
  title?: string
  /** Texto explicativo do que será redimensionado. */
  description: ReactNode
  /** Capa atual a exibir como prévia (mesma URL usada em downloads/Meus Mangás). */
  previewUrl?: string
  /** Rótulo do formato já aplicado nesta capa (mostra que foi alterada). */
  currentLabel?: string
  /** Se presente, mostra "Voltar ao original" (há um original guardado). */
  onRevert?: () => void
  busy?: boolean
  onApply: (b: {
    width: number
    height: number
    formatKind: string
    formatLabel: string
  }) => void
  onClose: () => void
}) {
  const [format, setFormat] = useState<CoverFormat>(ORIGINAL_FORMAT)
  const dims = formatDims(format)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 p-4">
          <h2 className="flex items-center gap-2 font-semibold text-neutral-100">
            <Wand2 size={16} className="text-neutral-400" aria-hidden="true" />
            {title}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          {previewUrl && (
            <div className="flex justify-center">
              <img
                src={previewUrl}
                alt="Capa atual"
                className="h-40 w-auto rounded-lg border border-neutral-800 object-contain"
              />
            </div>
          )}
          <p className="text-xs leading-snug text-neutral-500">{description}</p>
          {currentLabel && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
              <span className="text-xs text-neutral-400">
                Formato atual:{' '}
                <span className="font-medium text-neutral-200">{currentLabel}</span>
              </span>
              {onRevert && (
                <button
                  type="button"
                  onClick={onRevert}
                  disabled={busy}
                  className="ml-auto flex items-center gap-1.5 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-40"
                  title="Restaura a capa original que veio, desfazendo a edição"
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  Voltar ao original
                </button>
              )}
            </div>
          )}
          <CoverFormatPicker value={format} onChange={setFormat} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-800 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (!dims) return
              const meta = formatMeta(format)
              onApply({ ...dims, formatKind: meta.kind, formatLabel: meta.label })
            }}
            disabled={!dims || !!busy}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {dims ? `Aplicar ${dims.width}×${dims.height}` : 'Escolha um formato'}
          </button>
        </div>
      </div>
    </div>
  )
}
