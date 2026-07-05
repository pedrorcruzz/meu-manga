// Popup de confirmação da própria interface (substitui window.confirm/alert do
// browser). Renderizado via portal, com Esc/clique-fora para cancelar.

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'

export interface ConfirmDialogProps {
  /** Título em destaque. */
  title: string
  /** Corpo da mensagem (texto ou JSX). */
  message: ReactNode
  /** Rótulo do botão de confirmação. Padrão: "Confirmar". */
  confirmLabel?: string
  /** Rótulo do botão de cancelar. Padrão: "Cancelar". */
  cancelLabel?: string
  /** Tom do botão de confirmação: vermelho (destrutivo) ou neutro. */
  tone?: 'danger' | 'neutral'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Esc cancela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const confirmClass =
    tone === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-500'
      : 'bg-violet-600 text-white hover:bg-violet-500'
  const iconClass =
    tone === 'danger'
      ? 'border-red-900/50 bg-red-950/40 text-red-400'
      : 'border-violet-900/50 bg-violet-950/40 text-violet-300'

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex h-screen w-screen items-center justify-center bg-black/80 px-4 backdrop-blur-md"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border ${iconClass}`}
        >
          <AlertTriangle size={22} aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-neutral-400">
          {message}
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
