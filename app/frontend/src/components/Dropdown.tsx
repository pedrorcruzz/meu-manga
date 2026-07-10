import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type DropdownOption<T extends string | number> = {
  value: T
  label: string
}

/**
 * Dropdown genérico com UI própria (não usa o <select> nativo do browser),
 * para casar com o visual do app. Fecha ao clicar fora ou apertar Esc.
 * Substitui os selects nativos em todo o sistema.
 */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  align = 'left',
  fullWidth = false,
  triggerClassName,
}: {
  value: T
  options: readonly DropdownOption<T>[]
  onChange: (v: T) => void
  ariaLabel?: string
  /** De que lado o menu abre em relação ao gatilho. */
  align?: 'left' | 'right'
  /** Gatilho ocupa toda a largura disponível (e o menu acompanha). */
  fullWidth?: boolean
  /** Estilo do botão-gatilho, para casar com o contexto onde é usado. */
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value) ?? options[0]

  return (
    <div ref={ref} className={`relative ${fullWidth ? 'w-full' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={
          triggerClassName ??
          'flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-200 transition-colors hover:border-neutral-500 focus:border-neutral-500 focus:outline-none'
        }
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown
          size={13}
          className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className={`absolute z-30 mt-1 max-h-64 min-w-full overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-lg shadow-black/40 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((o) => {
            const active = o.value === value
            return (
              <li key={String(o.value)} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-xs transition-colors ${
                    active
                      ? 'bg-violet-600/30 text-violet-100'
                      : 'text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  <Check
                    size={12}
                    className={`shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`}
                    aria-hidden="true"
                  />
                  {o.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
