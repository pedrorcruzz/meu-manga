// Chip de filtro reutilizável (ativo/inativo) para os pools de capítulos.

import type { ReactNode } from 'react'

interface FilterChipProps {
  active: boolean
  onClick: () => void
  /** Contador opcional exibido ao lado do rótulo (ex.: quantos capítulos batem). */
  count?: number
  children: ReactNode
}

export function FilterChip({
  active,
  onClick,
  count,
  children,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200'
          : 'border-neutral-700/70 bg-neutral-800/40 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'
      }`}
    >
      {children}
      {count !== undefined && (
        <span
          className={`rounded-full px-1 tabular-nums ${
            active ? 'bg-indigo-500/30 text-indigo-100' : 'bg-neutral-700/60'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}
