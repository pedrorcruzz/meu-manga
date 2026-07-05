// Lista de capítulos com checkboxes. O chamador passa os capítulos já ordenados.

import type { Chapter } from '~/api/client'

export type SortOrder = 'asc' | 'desc'

/**
 * Ordena capítulos numericamente (suporta decimais como "10.5").
 * Retorna uma nova array - não muta a original.
 */
export function sortChapters(chapters: Chapter[], order: SortOrder): Chapter[] {
  return [...chapters].sort((a, b) => {
    const diff = parseFloat(a.number) - parseFloat(b.number)
    return order === 'asc' ? diff : -diff
  })
}

interface ChapterListProps {
  /** Capítulos já ordenados e filtrados pelo chamador. */
  chapters: Chapter[]
  selected: Set<string>
  /**
   * Alterna um capítulo. `shiftKey` indica seleção em intervalo (shift+clique):
   * o chamador seleciona do último item clicado até este.
   */
  onToggle: (id: string, shiftKey: boolean) => void
  /**
   * Quando true, remove borda/arredondamento do <ul> - use quando o contêiner
   * pai já fornece borda e arredondamento (ex.: painel com scroll interno).
   */
  bare?: boolean
}

export function ChapterList({
  chapters,
  selected,
  onToggle,
  bare,
}: ChapterListProps) {
  if (chapters.length === 0) {
    return (
      <div
        className={
          bare
            ? 'py-10 text-center'
            : 'rounded-xl border border-dashed border-neutral-800 py-10 text-center'
        }
      >
        <p className="text-sm text-neutral-600">Nenhum capítulo encontrado.</p>
      </div>
    )
  }

  return (
    <ul
      className={
        bare
          ? 'divide-y divide-neutral-800/60'
          : 'divide-y divide-neutral-800/60 overflow-hidden rounded-xl border border-neutral-800'
      }
    >
      {chapters.map((c) => {
        const checked = selected.has(c.id)
        return (
          <li key={c.id}>
            <div
              role="checkbox"
              aria-checked={checked}
              tabIndex={0}
              onClick={(e) => onToggle(c.id, e.shiftKey)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  onToggle(c.id, e.shiftKey)
                }
              }}
              className="flex cursor-pointer select-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-900 focus:bg-neutral-900 focus:outline-none"
            >
              <input
                type="checkbox"
                checked={checked}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-none h-4 w-4 shrink-0 accent-zinc-400"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium text-neutral-200">
                  Cap. {c.number}
                </span>
                {c.title && c.title !== c.number && (
                  <span className="text-neutral-500"> - {c.title}</span>
                )}
              </span>
              {c.date && (
                <span className="shrink-0 text-xs text-neutral-600">
                  {c.date}
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
