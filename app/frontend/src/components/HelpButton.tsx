// Ícone de interrogação que, ao clicar, exibe uma breve explicação num popover.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'

interface HelpButtonProps {
  /** Texto (ou conteúdo) exibido no popover. */
  children: ReactNode
  /** Rótulo acessível do botão. */
  label?: string
  /** Alinhamento horizontal do popover. */
  align?: 'left' | 'right'
}

export function HelpButton({
  children,
  label = 'O que é isto?',
  align = 'left',
}: HelpButtonProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
          open
            ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200'
            : 'border-neutral-700 bg-neutral-800/60 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
        }`}
      >
        <HelpCircle size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="tooltip"
          className={`absolute top-full z-30 mt-2 w-64 rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-xs leading-relaxed text-neutral-300 shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
