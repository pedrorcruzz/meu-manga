// Popup centralizado que exibe os volumes propostos como "capas" lado a lado.
// O usuário escolhe quais volumes quer montar (selecionar tudo / desmarcar tudo)
// antes de confirmar. Usado tanto pelo preset do Sakura quanto pelo N-por-volume.

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, Layers, X } from 'lucide-react'
import type { Volume } from './VolumeCard'

/** Faixa de capítulos de um volume, ex.: "Cap. 1 – 14" ou "Cap. 7". */
function chapterRange(vol: Volume): string {
  if (vol.chapters.length === 0) return 'vazio'
  const sorted = [...vol.chapters].sort(
    (a, b) => parseFloat(a.number) - parseFloat(b.number),
  )
  const first = sorted[0].number
  const last = sorted[sorted.length - 1].number
  return first === last ? `Cap. ${first}` : `Cap. ${first} – ${last}`
}

/** Lista completa dos capítulos para o tooltip da capa. */
function chaptersTooltip(vol: Volume): string {
  if (vol.chapters.length === 0) return 'Sem capítulos'
  const nums = [...vol.chapters]
    .sort((a, b) => parseFloat(a.number) - parseFloat(b.number))
    .map((c) => c.number)
  return `${vol.name} — Cap. ${nums.join(', ')}`
}

interface VolumeSelectModalProps {
  title: string
  /** Volumes propostos a exibir como capas. */
  volumes: Volume[]
  /** Recebe apenas os volumes marcados pelo usuário. */
  onConfirm: (selected: Volume[]) => void
  onClose: () => void
}

export function VolumeSelectModal({
  title,
  volumes,
  onConfirm,
  onClose,
}: VolumeSelectModalProps) {
  // Começa com todos os volumes marcados.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(volumes.map((v) => v.id)),
  )

  // ESC fecha o popup.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const totalChapters = useMemo(
    () => volumes.reduce((sum, v) => sum + v.chapters.length, 0),
    [volumes],
  )
  const selectedChapters = useMemo(
    () =>
      volumes
        .filter((v) => selected.has(v.id))
        .reduce((sum, v) => sum + v.chapters.length, 0),
    [volumes, selected],
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(volumes.map((v) => v.id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  function invert() {
    setSelected((prev) => {
      const next = new Set<string>()
      volumes.forEach((v) => {
        if (!prev.has(v.id)) next.add(v.id)
      })
      return next
    })
  }

  function confirm() {
    const chosen = volumes.filter((v) => selected.has(v.id))
    if (chosen.length === 0) return
    onConfirm(chosen)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="vol-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="vol-modal-panel flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Layers size={18} className="text-indigo-400" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-neutral-100">{title}</h2>
              <p className="text-xs text-neutral-500">
                {volumes.length} {volumes.length === 1 ? 'volume' : 'volumes'} ·{' '}
                {totalChapters} capítulos — escolha quais montar
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Barra de seleção */}
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900/60 px-5 py-2.5">
          <button
            type="button"
            onClick={selectAll}
            className="text-xs font-medium text-neutral-300 transition-colors hover:text-white"
          >
            Selecionar tudo
          </button>
          <span className="text-neutral-700" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-200"
          >
            Desmarcar tudo
          </button>
          <span className="text-neutral-700" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={invert}
            className="text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-200"
          >
            Inverter
          </button>
          <span className="ml-auto font-mono text-xs text-neutral-500">
            {selected.size}/{volumes.length} vol.
          </span>
        </div>

        {/* Grade de capas */}
        <div className="retro-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {volumes.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-600">
              Nenhum volume para montar.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {volumes.map((vol, i) => {
                const checked = selected.has(vol.id)
                return (
                  <button
                    key={vol.id}
                    type="button"
                    onClick={() => toggle(vol.id)}
                    aria-pressed={checked}
                    title={chaptersTooltip(vol)}
                    className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all ${
                      checked
                        ? 'border-indigo-500/70 bg-indigo-950/30 ring-1 ring-indigo-500/40'
                        : 'border-neutral-800 bg-neutral-900/60 opacity-60 hover:opacity-100'
                    }`}
                  >
                    {/* Marca de seleção */}
                    <span
                      className={`absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                        checked
                          ? 'border-indigo-400 bg-indigo-500 text-white'
                          : 'border-neutral-600 bg-neutral-900/80 text-transparent'
                      }`}
                    >
                      <Check size={12} strokeWidth={3} aria-hidden="true" />
                    </span>

                    {/* Área da "capa" */}
                    <div
                      className={`relative flex aspect-[3/4] items-center justify-center overflow-hidden ${
                        vol.coverImage
                          ? ''
                          : 'bg-gradient-to-br from-neutral-800 to-neutral-950'
                      }`}
                    >
                      {vol.coverImage ? (
                        <img
                          src={vol.coverImage}
                          alt={`Capa de ${vol.name}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1.5 px-2 text-center">
                          <BookOpen
                            size={22}
                            className="text-neutral-600"
                            aria-hidden="true"
                          />
                          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                            Volume
                          </span>
                          <span className="font-mono text-2xl font-bold leading-none text-neutral-200">
                            {i + 1}
                          </span>
                        </div>
                      )}
                      {/* Lombada decorativa */}
                      <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-black/40" />
                    </div>

                    {/* Rótulo do volume */}
                    <div className="space-y-0.5 border-t border-neutral-800 px-2.5 py-2">
                      <p className="truncate font-mono text-xs font-bold text-neutral-100">
                        {vol.name}
                        {vol.label && (
                          <span className="ml-1 font-sans font-normal text-neutral-600">
                            {vol.label}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-neutral-400">
                        {chapterRange(vol)}
                      </p>
                      <p className="text-[10px] text-neutral-600">
                        {vol.chapters.length}{' '}
                        {vol.chapters.length === 1 ? 'capítulo' : 'capítulos'}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Rodapé com ações */}
        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 px-5 py-4">
          <button
            type="button"
            onClick={confirm}
            disabled={selected.size === 0}
            className="flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2 font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Layers size={15} aria-hidden="true" />
            Montar {selected.size} {selected.size === 1 ? 'volume' : 'volumes'}
          </button>
          {selected.size > 0 && (
            <span className="text-xs text-neutral-500">
              {selectedChapters} capítulos serão organizados
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
