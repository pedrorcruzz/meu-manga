import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type SortOption<T extends string> = { value: T; label: string }

/**
 * Dropdown de ordenação com UI própria (não usa o <select> nativo do browser),
 * para casar com o visual do app. Fecha ao clicar fora ou apertar Esc.
 */
export function SortMenu<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: readonly SortOption<T>[]
  onChange: (v: T) => void
  ariaLabel?: string
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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900/60 px-2 py-1 font-mono text-[11px] text-neutral-300 transition-colors hover:border-neutral-600 focus:border-neutral-600 focus:outline-none"
      >
        <span>{current?.label}</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 mt-1 min-w-[8rem] overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-lg shadow-black/40"
        >
          {options.map((o) => {
            const active = o.value === value
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors ${
                    active
                      ? 'bg-violet-600/30 text-violet-100'
                      : 'text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  <Check
                    size={11}
                    className={active ? 'opacity-100' : 'opacity-0'}
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
