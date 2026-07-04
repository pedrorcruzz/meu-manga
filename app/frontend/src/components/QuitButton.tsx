// Botão para encerrar o programa (backend + frontend), com popup de confirmação.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Power } from 'lucide-react'
import { api } from '~/api/client'

type State = 'idle' | 'confirming' | 'done'

const pill =
  'rounded-lg border px-3 py-1.5 font-mono text-xs uppercase tracking-wide transition'

export function QuitButton() {
  const [state, setState] = useState<State>('idle')

  // Esc fecha o popup de confirmação
  useEffect(() => {
    if (state !== 'confirming') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setState('idle')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])

  async function handleConfirm() {
    setState('done')
    await api.quit()
  }

  // Tela final de "encerrado" — via portal para centralizar na viewport
  if (state === 'done') {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-neutral-950 px-4 text-center">
        <Power size={40} className="mb-4 text-neutral-600" aria-hidden="true" />
        <p className="text-2xl font-semibold text-neutral-100">
          Programa encerrado.
        </p>
        <p className="mt-2 text-neutral-400">Você já pode fechar esta aba.</p>
        <p className="mt-6 text-sm text-neutral-600">
          Para reiniciar, rode{' '}
          <code className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-neutral-400">
            make
          </code>{' '}
          no terminal.
        </p>
      </div>,
      document.body,
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setState('confirming')}
        className={`${pill} inline-flex items-center gap-1.5 border-red-900/60 bg-neutral-900/60 text-red-400/80 hover:border-red-800 hover:bg-red-950/40 hover:text-red-300`}
      >
        <Power size={12} aria-hidden="true" />
        Encerrar
      </button>

      {state === 'confirming' &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
            onClick={() => setState('idle')}
            role="dialog"
            aria-modal="true"
          >
          <div
            className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-900/50 bg-red-950/40">
              <Power size={22} className="text-red-400" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold text-neutral-100">
              Encerrar o programa?
            </h2>
            <p className="mt-2 text-sm text-neutral-400">
              Isso desliga o backend e o frontend e libera as portas. Para voltar,
              rode{' '}
              <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-neutral-300">
                make
              </code>
              .
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setState('idle')}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
              >
                <Power size={14} aria-hidden="true" />
                Encerrar
              </button>
            </div>
          </div>
        </div>,
          document.body,
        )}
    </>
  )
}
