// Seletor de formato da capa: "Original" (mantém o tamanho baixado), presets de
// Kindle (busca por modelo) e "Personalizado" (largura×altura à mão, com trava de
// proporção opcional). Usado tanto no popup de adicionar capa quanto na ação em
// massa "Editar capa" (que redimensiona a capa de todos os volumes).

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import {
  KINDLE_PRESETS,
  presetLabel,
  searchPresets,
  type CoverFormat,
} from '~/lib/kindleFormats'

export function CoverFormatPicker({
  value,
  onChange,
  aspect,
}: {
  value: CoverFormat
  onChange: (f: CoverFormat) => void
  /** Proporção (largura/altura) da imagem atual, para a trava de proporção do custom. */
  aspect?: number
}) {
  const [query, setQuery] = useState('')
  // Campos do "Personalizado" como texto, para deixar apagar/digitar livremente.
  const [cw, setCw] = useState(value.kind === 'custom' ? String(value.width) : '')
  const [ch, setCh] = useState(value.kind === 'custom' ? String(value.height) : '')
  const [lockRatio, setLockRatio] = useState(true)

  const results = useMemo(() => searchPresets(query), [query])
  const selectedKindleId = value.kind === 'kindle' ? value.id : null
  const customActive = value.kind === 'custom'

  function pushCustom(nextW: string, nextH: string) {
    const w = parseInt(nextW, 10)
    const h = parseInt(nextH, 10)
    onChange({
      kind: 'custom',
      width: Number.isFinite(w) ? w : 0,
      height: Number.isFinite(h) ? h : 0,
    })
  }

  function onCustomWidth(v: string) {
    const clean = v.replace(/[^0-9]/g, '')
    setCw(clean)
    let nextH = ch
    if (lockRatio && aspect && aspect > 0) {
      const w = parseInt(clean, 10)
      if (Number.isFinite(w) && w > 0) {
        nextH = String(Math.round(w / aspect))
        setCh(nextH)
      }
    }
    pushCustom(clean, nextH)
  }

  function onCustomHeight(v: string) {
    const clean = v.replace(/[^0-9]/g, '')
    setCh(clean)
    let nextW = cw
    if (lockRatio && aspect && aspect > 0) {
      const h = parseInt(clean, 10)
      if (Number.isFinite(h) && h > 0) {
        nextW = String(Math.round(h * aspect))
        setCw(nextW)
      }
    }
    pushCustom(nextW, clean)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Original */}
      <button
        type="button"
        onClick={() => onChange({ kind: 'original' })}
        aria-pressed={value.kind === 'original'}
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
          value.kind === 'original'
            ? 'border-violet-500/60 bg-violet-600/10 text-neutral-100'
            : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-600'
        }`}
      >
        <span
          className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors ${
            value.kind === 'original'
              ? 'border-violet-500 bg-violet-500 text-white'
              : 'border-neutral-600 bg-transparent text-transparent'
          }`}
          aria-hidden="true"
        >
          <Check size={11} strokeWidth={3} />
        </span>
        <span className="min-w-0">
          <span className="font-medium">Original</span>
          <span className="ml-1.5 text-xs text-neutral-500">
            mantém o tamanho da capa como veio
          </span>
        </span>
      </button>

      {/* Personalizado (em cima: funciona para qualquer aparelho, não só Kindle) */}
      <div
        className={`rounded-lg border px-3 py-2.5 ${
          customActive ? 'border-violet-500/60 bg-violet-600/10' : 'border-neutral-800 bg-neutral-900'
        }`}
      >
        <p className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
          Personalizado
        </p>
        <p className="mb-2 text-[11px] leading-snug text-neutral-500">
          Escolha qualquer largura×altura, em pixels — serve para qualquer
          aparelho (tablet, celular, e-reader), não só Kindle.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            L
            <input
              type="text"
              inputMode="numeric"
              value={cw}
              onChange={(e) => onCustomWidth(e.target.value)}
              placeholder="largura"
              className="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-center text-xs focus:border-neutral-500 focus:outline-none"
              aria-label="Largura personalizada"
            />
          </label>
          <span className="text-neutral-600">×</span>
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            A
            <input
              type="text"
              inputMode="numeric"
              value={ch}
              onChange={(e) => onCustomHeight(e.target.value)}
              placeholder="altura"
              className="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-center text-xs focus:border-neutral-500 focus:outline-none"
              aria-label="Altura personalizada"
            />
          </label>
          <span className="text-[11px] text-neutral-600">px</span>
          {aspect && aspect > 0 && (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-400">
              <input
                type="checkbox"
                checked={lockRatio}
                onChange={(e) => setLockRatio(e.target.checked)}
                className="accent-violet-500"
              />
              manter proporção
            </label>
          )}
        </div>
      </div>

      {/* Kindle (embaixo: atalhos com as resoluções das telas de Kindle) */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900">
        <div className="border-b border-neutral-800 px-3 py-2">
          <p className="mb-2 text-[11px] leading-snug text-neutral-400">
            Se você usa <span className="font-medium text-neutral-200">Kindle</span>,
            experimente esses (a resolução exata de cada tela):
          </p>
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar o seu Kindle… (ex: Paperwhite, Oasis, 1236)"
              className="w-full rounded-md border border-neutral-800 bg-neutral-950/60 py-1.5 pl-8 pr-8 text-xs placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
              aria-label="Buscar modelo de Kindle"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-600 hover:text-neutral-300"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        <ul className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label="Modelos de Kindle">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-center text-xs text-neutral-600">
              Nenhum Kindle encontrado.
            </li>
          ) : (
            results.map((p) => {
              const active = selectedKindleId === p.id
              return (
                <li key={p.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        kind: 'kindle',
                        id: p.id,
                        label: presetLabel(p),
                        width: p.width,
                        height: p.height,
                      })
                    }
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      active
                        ? 'bg-violet-600/25 text-violet-100'
                        : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    <Check
                      size={12}
                      className={`shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-neutral-500">
                      {p.width}×{p.height}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}
