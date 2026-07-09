// Popup centralizado que exibe os volumes propostos como "capas" lado a lado.
// O usuário escolhe quais volumes quer montar (selecionar tudo / desmarcar tudo)
// antes de confirmar. Capítulos que a fonte não colocou em nenhum volume
// (lançamentos recentes) aparecem num painel próprio, onde dá para montá-los
// em volumes escolhendo os capítulos e quantos por volume.

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  ArrowDownUp,
  BookOpen,
  Check,
  ImagePlus,
  Layers,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { type Chapter } from '~/api/client'
import type { Volume } from './VolumeCard'
import { SortMenu } from './SortMenu'
import { useIncremental } from '~/hooks/useIncremental'
import {
  DEFAULT_VOLUME_FORMAT,
  formatVolumeName,
  type VolumeNameFormat,
} from '~/lib/volumeName'

/** Lê um arquivo de imagem como data URL base64 (qualquer formato). */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'))
    reader.readAsDataURL(file)
  })
}

/** Faixa de capítulos de um volume, ex.: "Cap. 1 - 14" ou "Cap. 7". */
function chapterRange(vol: Volume): string {
  if (vol.chapters.length === 0) return 'vazio'
  const sorted = [...vol.chapters].sort(
    (a, b) => parseFloat(a.number) - parseFloat(b.number),
  )
  const first = sorted[0].number
  const last = sorted[sorted.length - 1].number
  return first === last ? `Cap. ${first}` : `Cap. ${first} - ${last}`
}

/** Lista completa dos capítulos para o tooltip da capa. */
function chaptersTooltip(vol: Volume): string {
  if (vol.chapters.length === 0) return 'Sem capítulos'
  const nums = [...vol.chapters]
    .sort((a, b) => parseFloat(a.number) - parseFloat(b.number))
    .map((c) => c.number)
  return `${vol.name} - Cap. ${nums.join(', ')}`
}

/** true se o volume bate com a busca (nome, rótulo ou número de capítulo). */
function matchesQuery(vol: Volume, q: string): boolean {
  if (!q) return true
  if (vol.name.toLowerCase().includes(q)) return true
  if (vol.label && vol.label.toLowerCase().includes(q)) return true
  return vol.chapters.some((c) => c.number.toLowerCase().includes(q))
}

/**
 * Detecta o padrão de capítulos por volume a partir dos volumes já montados
 * pela fonte: `mode` = quantidade mais comum, `avg` = média arredondada.
 * Ignora o último volume se ele for parcial (menor que os demais).
 */
function typicalPerVol(vols: Volume[]): { mode: number; avg: number } | null {
  const counts = vols.map((v) => v.chapters.length).filter((n) => n > 0)
  if (counts.length === 0) return null
  // Descarta o último se for claramente parcial (volume ainda em andamento).
  const trimmed =
    counts.length > 1 && counts[counts.length - 1] < Math.max(...counts)
      ? counts.slice(0, -1)
      : counts
  const freq = new Map<number, number>()
  for (const n of trimmed) freq.set(n, (freq.get(n) ?? 0) + 1)
  let mode = trimmed[0]
  let best = 0
  for (const [n, f] of freq) {
    if (f > best) {
      best = f
      mode = n
    }
  }
  const avg = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length)
  return { mode, avg }
}

/** Número real do volume, lido do rótulo/nome (ex.: "Volume 16" → 16). */
function volumeNumberOf(vol: Volume): number | null {
  const m = (vol.label ?? vol.name).match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

/** Maior número já usado entre os nomes/rótulos dos volumes. */
function maxVolNum(vols: Volume[]): number {
  let max = 0
  for (const v of vols) {
    const nm = v.name.match(/\d+/)
    if (nm) max = Math.max(max, parseInt(nm[0], 10))
    const lm = v.label?.match(/\d+/)
    if (lm) max = Math.max(max, parseInt(lm[0], 10))
  }
  return max
}

interface VolumeSelectModalProps {
  title: string
  /** Volumes propostos automaticamente. */
  volumes: Volume[]
  /** Capítulos que a fonte não colocou em nenhum volume. */
  leftoverChapters?: Chapter[]
  /** Formato de nome para os volumes montados aqui (leftover). */
  nameFormat?: VolumeNameFormat
  /** Recebe apenas os volumes marcados pelo usuário (propostos + montados aqui). */
  onConfirm: (selected: Volume[]) => void
  onClose: () => void
}

export function VolumeSelectModal({
  title,
  volumes,
  leftoverChapters = [],
  nameFormat = DEFAULT_VOLUME_FORMAT,
  onConfirm,
  onClose,
}: VolumeSelectModalProps) {
  // Volumes montados dentro do popup a partir dos capítulos sem volume.
  const [extraVols, setExtraVols] = useState<Volume[]>([])
  const extraIdRef = useRef(0)

  // Personalizações feitas aqui dentro sobre os volumes propostos:
  // `edits` sobrescreve os capítulos de um volume (add/remove); `removedVolIds`
  // marca volumes excluídos. Ambos keyed por id (vale p/ propostos e extras).
  const [edits, setEdits] = useState<Record<string, Chapter[]>>({})
  const [removedVolIds, setRemovedVolIds] = useState<Set<string>>(new Set())
  // Volume aberto no editor de capítulos (null = fechado).
  const [editingVolId, setEditingVolId] = useState<string | null>(null)

  const extraIds = useMemo(
    () => new Set(extraVols.map((v) => v.id)),
    [extraVols],
  )

  // Volumes efetivos: propostos + extras, sem os excluídos, com `edits` aplicados.
  const allVolumes = useMemo(() => {
    const base = [...volumes, ...extraVols].filter(
      (v) => !removedVolIds.has(v.id),
    )
    return base.map((v) => (edits[v.id] ? { ...v, chapters: edits[v.id] } : v))
  }, [volumes, extraVols, removedVolIds, edits])

  // Começa com todos os volumes propostos marcados.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(volumes.map((v) => v.id)),
  )
  const [query, setQuery] = useState('')
  // Ordenação por número do volume (padrão: mais antigos primeiro).
  const [sort, setSort] = useState<'recent' | 'old'>('old')

  // Ids já atribuídos a algum volume (após edições/exclusões).
  const assignedIds = useMemo(
    () => new Set(allVolumes.flatMap((v) => v.chapters.map((c) => c.id))),
    [allVolumes],
  )
  // Capítulos "sem volume" ainda não usados em nenhum volume.
  const remainingLeftovers = useMemo(
    () => leftoverChapters.filter((c) => !assignedIds.has(c.id)),
    [leftoverChapters, assignedIds],
  )

  // Universo de capítulos conhecidos (dos volumes propostos + os sem volume),
  // sem repetição — base do pool de "adicionar ao volume".
  const allKnownChapters = useMemo(() => {
    const seen = new Set<string>()
    const out: Chapter[] = []
    for (const c of [
      ...volumes.flatMap((v) => v.chapters),
      ...leftoverChapters,
    ]) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
    }
    return out
  }, [volumes, leftoverChapters])

  // Capítulos disponíveis para adicionar a um volume: os que não estão em nenhum
  // volume no momento (inclui os "sem volume" e os que você removeu de volumes).
  const poolChapters = useMemo(
    () =>
      allKnownChapters
        .filter((c) => !assignedIds.has(c.id))
        .sort((a, b) => parseFloat(a.number) - parseFloat(b.number)),
    [allKnownChapters, assignedIds],
  )

  const [leftoverSel, setLeftoverSel] = useState<Set<string>>(
    () => new Set(leftoverChapters.map((c) => c.id)),
  )
  // Padrão de capítulos por volume detectado na fonte (para sugerir ao usuário).
  const detected = useMemo(() => typicalPerVol(volumes), [volumes])
  const [perVol, setPerVol] = useState(() => {
    const t = typicalPerVol(volumes)
    return t ? String(t.mode) : '10'
  })
  const [showLeftover, setShowLeftover] = useState(leftoverChapters.length > 0)

  // ── Capa por volume ─────────────────────────────────────────────────────────
  // Capas escolhidas aqui dentro, por id de volume. Sobrepõem vol.coverImage.
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const [coverErrors, setCoverErrors] = useState<Record<string, string>>({})
  // Input de arquivo único, reaproveitado para qualquer volume (via target).
  const coverInputRef = useRef<HTMLInputElement>(null)
  const coverTargetRef = useRef<string | null>(null)

  /** Capa efetiva do volume: a escolhida aqui tem prioridade sobre a da fonte. */
  function effectiveCover(vol: Volume): string | null {
    return vol.id in covers ? covers[vol.id] : vol.coverImage
  }

  function pickCover(volId: string) {
    coverTargetRef.current = volId
    coverInputRef.current?.click()
  }

  async function onCoverFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const volId = coverTargetRef.current
    if (!file || !volId) return
    setCoverErrors((prev) => {
      const next = { ...prev }
      delete next[volId]
      return next
    })
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setCovers((prev) => ({ ...prev, [volId]: dataUrl }))
    } catch (err) {
      setCoverErrors((prev) => ({
        ...prev,
        [volId]: err instanceof Error ? err.message : 'Erro ao carregar imagem',
      }))
    } finally {
      e.target.value = ''
    }
  }

  function removeCover(volId: string) {
    setCovers((prev) => ({ ...prev, [volId]: null }))
  }

  // Volumes visíveis após a busca - as ações de marcar operam sobre este subconjunto.
  const visibleVolumes = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allVolumes
    return allVolumes.filter((v) => matchesQuery(v, q))
  }, [allVolumes, query])

  // Ordena por número real do volume (a fonte pode entregar em ordem decrescente).
  const sortedVolumes = useMemo(() => {
    const arr = [...visibleVolumes]
    arr.sort((a, b) => {
      const na = volumeNumberOf(a) ?? 0
      const nb = volumeNumberOf(b) ?? 0
      return sort === 'recent' ? nb - na : na - nb
    })
    return arr
  }, [visibleVolumes, sort])

  // Renderiza as capas em lotes (scroll infinito) para aguentar coleções grandes
  // como One Piece (100+ volumes) sem travar. Seleção/contagem seguem no total.
  const {
    visible: pagedVolumes,
    sentinelRef: volSentinelRef,
    hasMore: volHasMore,
  } = useIncremental(sortedVolumes, 48)

  // Número real de cada volume (posição na lista completa), para o rótulo "VOLUME N".
  const volNumber = useMemo(
    () => new Map(allVolumes.map((v, i) => [v.id, i + 1])),
    [allVolumes],
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
    () => allVolumes.reduce((sum, v) => sum + v.chapters.length, 0),
    [allVolumes],
  )
  const selectedChapters = useMemo(
    () =>
      allVolumes
        .filter((v) => selected.has(v.id))
        .reduce((sum, v) => sum + v.chapters.length, 0),
    [allVolumes, selected],
  )

  // ── Seleção de volumes ─────────────────────────────────────────────────────

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      visibleVolumes.forEach((v) => next.add(v.id))
      return next
    })
  }

  function clearAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      visibleVolumes.forEach((v) => next.delete(v.id))
      return next
    })
  }

  function confirm() {
    const chosen = allVolumes
      .filter((v) => selected.has(v.id))
      .map((v) => (v.id in covers ? { ...v, coverImage: covers[v.id] } : v))
    if (chosen.length === 0) return
    onConfirm(chosen)
  }

  // ── Editar capítulos / excluir volume ──────────────────────────────────────

  /** Capítulos efetivos de um volume (com edições aplicadas). */
  function chaptersOf(volId: string): Chapter[] {
    return allVolumes.find((v) => v.id === volId)?.chapters ?? []
  }

  function setVolChapters(volId: string, chs: Chapter[]) {
    setEdits((prev) => ({ ...prev, [volId]: chs }))
  }

  function removeChapterFromVol(volId: string, chId: string) {
    setVolChapters(
      volId,
      chaptersOf(volId).filter((c) => c.id !== chId),
    )
  }

  function addChaptersToVol(volId: string, chs: Chapter[]) {
    const existing = new Set(chaptersOf(volId).map((c) => c.id))
    const merged = [
      ...chaptersOf(volId),
      ...chs.filter((c) => !existing.has(c.id)),
    ].sort((a, b) => parseFloat(a.number) - parseFloat(b.number))
    setVolChapters(volId, merged)
  }

  function deleteVol(volId: string) {
    if (extraIds.has(volId)) {
      setExtraVols((prev) => prev.filter((v) => v.id !== volId))
    } else {
      setRemovedVolIds((prev) => new Set(prev).add(volId))
    }
    setEdits((prev) => {
      const next = { ...prev }
      delete next[volId]
      return next
    })
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(volId)
      return next
    })
    if (editingVolId === volId) setEditingVolId(null)
  }

  // Volume atualmente aberto no editor de capítulos.
  const editingVol = editingVolId
    ? (allVolumes.find((v) => v.id === editingVolId) ?? null)
    : null

  // ── Capítulos sem volume → montar em volumes ───────────────────────────────

  function toggleLeftover(id: string) {
    setLeftoverSel((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAllLeftover() {
    setLeftoverSel(new Set(remainingLeftovers.map((c) => c.id)))
  }

  function clearLeftover() {
    setLeftoverSel(new Set())
  }

  function addLeftoverVolumes() {
    const chosen = remainingLeftovers
      .filter((c) => leftoverSel.has(c.id))
      .sort((a, b) => parseFloat(a.number) - parseFloat(b.number))
    if (chosen.length === 0) return
    const n = Math.max(1, parseInt(perVol, 10) || 10)

    let start = maxVolNum(allVolumes) + 1
    const created: Volume[] = []
    for (let i = 0; i < chosen.length; i += n) {
      created.push({
        id: `extra-${++extraIdRef.current}`,
        name: formatVolumeName(start++, nameFormat),
        chapters: chosen.slice(i, i + n),
        coverImage: null,
      })
    }
    setExtraVols((prev) => [...prev, ...created])
    setSelected((prev) => {
      const next = new Set(prev)
      created.forEach((v) => next.add(v.id))
      return next
    })
    // Os capítulos consumidos saem da lista automaticamente (via assignedIds).
  }

  const leftoverSelCount = remainingLeftovers.filter((c) =>
    leftoverSel.has(c.id),
  ).length

  return (
    <>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="vol-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="vol-modal-panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Input de arquivo único, reaproveitado para a capa de qualquer volume */}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onCoverFile}
          aria-label="Escolher capa do volume"
        />
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Layers size={18} className="text-violet-400/80" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-neutral-100">{title}</h2>
              <p className="text-xs text-neutral-500">
                {allVolumes.length}{' '}
                {allVolumes.length === 1 ? 'volume' : 'volumes'} ·{' '}
                {totalChapters} capítulos - escolha quais montar
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

        {/* Barra de busca */}
        <div className="border-b border-neutral-800 px-5 py-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar volume ou capítulo… (ex: 003, 3, 42)"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-800/60 py-2 pl-9 pr-9 text-sm placeholder:text-neutral-700 focus:border-neutral-600 focus:outline-none"
              aria-label="Buscar volumes"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpar busca"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-600 transition-colors hover:text-neutral-300"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Barra de seleção */}
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900/60 px-5 py-2.5">
          <button
            type="button"
            onClick={selectAll}
            className="text-xs font-medium text-neutral-300 transition-colors hover:text-white"
          >
            {query ? 'Marcar filtrados' : 'Selecionar tudo'}
          </button>
          <span className="text-neutral-700" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-200"
          >
            {query ? 'Desmarcar filtrados' : 'Desmarcar tudo'}
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <ArrowDownUp size={12} aria-hidden="true" />
              <SortMenu
                value={sort}
                onChange={setSort}
                ariaLabel="Ordenar volumes"
                options={
                  [
                    { value: 'old', label: 'Mais antigos' },
                    { value: 'recent', label: 'Mais recentes' },
                  ] as const
                }
              />
            </div>
            <span className="font-mono text-xs text-neutral-500">
              {query ? `${visibleVolumes.length} achados · ` : ''}
              {selected.size}/{allVolumes.length} vol.
            </span>
          </div>
        </div>

        {/* Corpo com scroll */}
        <div className="retro-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Painel dos capítulos sem volume */}
          {remainingLeftovers.length > 0 && (
            <div className="rounded-xl border border-amber-700/40 bg-neutral-800/30 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle
                  size={14}
                  className="text-neutral-400"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium text-neutral-200">
                  {remainingLeftovers.length} capítulo
                  {remainingLeftovers.length !== 1 ? 's' : ''} sem volume
                  detectado
                </span>
                <span className="text-xs text-neutral-500">
                  - a fonte não agrupou; monte manualmente aqui
                </span>
                <button
                  type="button"
                  onClick={() => setShowLeftover((s) => !s)}
                  className="ml-auto text-xs text-neutral-400 transition-colors hover:text-neutral-200"
                >
                  {showLeftover ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>

              {showLeftover && (
                <div className="mt-3 space-y-2.5">
                  {/* Ações rápidas */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={selectAllLeftover}
                      className="text-neutral-300 transition-colors hover:text-white"
                    >
                      Selecionar todos
                    </button>
                    <span className="text-neutral-700" aria-hidden="true">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={clearLeftover}
                      className="text-neutral-400 transition-colors hover:text-neutral-200"
                    >
                      Limpar
                    </button>
                    <span className="ml-auto font-mono text-neutral-500">
                      {leftoverSelCount}/{remainingLeftovers.length} sel.
                    </span>
                  </div>

                  {/* Checklist dos capítulos */}
                  <div className="retro-scroll max-h-40 overflow-y-auto rounded-lg border border-neutral-700/50 bg-neutral-900/50">
                    <div className="flex flex-wrap gap-1.5 p-2">
                      {remainingLeftovers.map((c) => {
                        const checked = leftoverSel.has(c.id)
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleLeftover(c.id)}
                            aria-pressed={checked}
                            className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                              checked
                                ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                                : 'border-neutral-700 bg-neutral-800/60 text-neutral-500 hover:text-neutral-300'
                            }`}
                          >
                            Cap. {c.number}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Padrão detectado na fonte */}
                  {detected && (
                    <p className="text-xs text-neutral-400">
                      Os volumes da fonte têm cerca de{' '}
                      <strong className="text-neutral-200">
                        {detected.mode} capítulos
                      </strong>{' '}
                      cada
                      {detected.avg !== detected.mode
                        ? ` (média ${detected.avg})`
                        : ''}
                      . Sugerimos usar esse mesmo número aqui.
                    </p>
                  )}

                  {/* Montar em volumes */}
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor="leftover-per-vol"
                      className="text-xs text-neutral-400"
                    >
                      Capítulos por volume:
                    </label>
                    <input
                      id="leftover-per-vol"
                      type="number"
                      min="1"
                      value={perVol}
                      onChange={(e) => setPerVol(e.target.value)}
                      className="w-16 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-center text-sm focus:border-neutral-500 focus:outline-none"
                    />
                    {detected && perVol !== String(detected.mode) && (
                      <button
                        type="button"
                        onClick={() => setPerVol(String(detected.mode))}
                        className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:text-neutral-200"
                      >
                        usar {detected.mode}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={addLeftoverVolumes}
                      disabled={leftoverSelCount === 0}
                      className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus size={14} aria-hidden="true" />
                      Adicionar em volumes
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Grade de capas */}
          {allVolumes.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-600">
              Nenhum volume detectado. Use o painel acima para montar os
              capítulos em volumes.
            </p>
          ) : visibleVolumes.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-600">
              Nenhum volume encontrado para “{query}”.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {pagedVolumes.map((vol) => {
                const checked = selected.has(vol.id)
                // Número real do volume (não a posição na grade), para o placeholder.
                const num = volumeNumberOf(vol) ?? volNumber.get(vol.id) ?? 0
                const isExtra = extraIds.has(vol.id)
                const coverErr = coverErrors[vol.id]
                const cover = effectiveCover(vol)
                return (
                  <div
                    key={vol.id}
                    className={`group relative flex flex-col overflow-hidden rounded-xl border transition-all ${
                      checked
                        ? 'border-neutral-200/80 bg-neutral-800/40 ring-1 ring-neutral-200/20'
                        : 'border-neutral-800 bg-neutral-900/60 opacity-60 hover:opacity-100'
                    }`}
                  >
                    {/* Região de seleção (capa + rótulo) */}
                    <button
                      type="button"
                      onClick={() => toggle(vol.id)}
                      aria-pressed={checked}
                      title={chaptersTooltip(vol)}
                      className="flex flex-col text-left"
                    >
                      {/* Marca de seleção */}
                      <span
                        className={`absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                          checked
                            ? 'border-neutral-200 bg-neutral-100 text-neutral-900'
                            : 'border-neutral-600 bg-neutral-900/80 text-transparent'
                        }`}
                      >
                        <Check size={12} strokeWidth={3} aria-hidden="true" />
                      </span>

                      {/* Área da "capa" */}
                      <div
                        className={`relative flex aspect-[3/4] items-center justify-center overflow-hidden ${
                          cover
                            ? ''
                            : 'bg-gradient-to-br from-neutral-800 to-neutral-950'
                        }`}
                      >
                        {cover ? (
                          <img
                            src={cover}
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
                              {num}
                            </span>
                          </div>
                        )}
                        {/* Lombada decorativa */}
                        <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-black/40" />
                        {isExtra && (
                          <span className="absolute left-2 top-2 rounded bg-violet-600/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                            novo
                          </span>
                        )}
                        {vol.id in covers && covers[vol.id] && (
                          <span className="absolute bottom-2 left-2 rounded bg-emerald-600/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                            capa
                          </span>
                        )}
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

                    {/* Ações: editar capítulos, excluir volume e capa */}
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-800 bg-neutral-950/40 px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => setEditingVolId(vol.id)}
                        className="flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-[10px] text-neutral-300 transition-colors hover:bg-neutral-800"
                        title="Editar os capítulos deste volume"
                      >
                        <Pencil size={11} aria-hidden="true" />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => pickCover(vol.id)}
                        className="flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-[10px] text-neutral-300 transition-colors hover:bg-neutral-800"
                      >
                        <ImagePlus size={11} aria-hidden="true" />
                        {effectiveCover(vol) ? 'Trocar capa' : 'Capa'}
                      </button>
                      {effectiveCover(vol) && (
                        <button
                          type="button"
                          onClick={() => removeCover(vol.id)}
                          className="text-[10px] text-neutral-600 transition-colors hover:text-neutral-400"
                        >
                          Remover capa
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteVol(vol.id)}
                        className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-neutral-600 transition-colors hover:bg-red-950/40 hover:text-red-400"
                        title="Excluir este volume da montagem"
                      >
                        <Trash2 size={11} aria-hidden="true" />
                        Excluir
                      </button>
                      {coverErr && (
                        <p className="w-full text-[10px] leading-tight text-red-400">
                          {coverErr}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {/* Sentinela do scroll infinito das capas */}
          {volHasMore && (
            <div
              ref={volSentinelRef}
              className="py-3 text-center text-[11px] text-neutral-700"
            >
              carregando mais volumes…
            </div>
          )}
        </div>

        {/* Rodapé com ações */}
        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 px-5 py-4">
          <button
            type="button"
            onClick={confirm}
            disabled={selected.size === 0}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2 font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
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

    {/* Editor de capítulos de um volume (add/remove) */}
    {editingVol && (
      <VolumeChaptersEditor
        vol={editingVol}
        pool={poolChapters}
        onRemoveChapter={(cid) => removeChapterFromVol(editingVol.id, cid)}
        onAddChapters={(chs) => addChaptersToVol(editingVol.id, chs)}
        onClose={() => setEditingVolId(null)}
      />
    )}
    </>
  )
}

// ── Editor de capítulos de um volume (dentro do popup) ───────────────────────

interface VolumeChaptersEditorProps {
  vol: Volume
  /** Capítulos disponíveis para adicionar (não atribuídos a nenhum volume). */
  pool: Chapter[]
  onRemoveChapter: (chapterId: string) => void
  onAddChapters: (chapters: Chapter[]) => void
  onClose: () => void
}

function VolumeChaptersEditor({
  vol,
  pool,
  onRemoveChapter,
  onAddChapters,
  onClose,
}: VolumeChaptersEditorProps) {
  // Seleção no pool de "adicionar".
  const [addSel, setAddSel] = useState<Set<string>>(new Set())
  const [poolQuery, setPoolQuery] = useState('')

  // ESC fecha só este editor.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chapters = [...vol.chapters].sort(
    (a, b) => parseFloat(a.number) - parseFloat(b.number),
  )
  const q = poolQuery.trim().toLowerCase()
  const visiblePool = q
    ? pool.filter((c) => c.number.toLowerCase().includes(q))
    : pool

  function toggleAdd(id: string) {
    setAddSel((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function applyAdd() {
    const chosen = pool.filter((c) => addSel.has(c.id))
    if (chosen.length === 0) return
    onAddChapters(chosen)
    setAddSel(new Set())
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Editar capítulos de ${vol.name}`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Pencil size={16} className="text-violet-400/80" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-neutral-100">
                Editar {vol.name}
              </h3>
              <p className="text-xs text-neutral-500">
                {vol.chapters.length}{' '}
                {vol.chapters.length === 1 ? 'capítulo' : 'capítulos'} neste
                volume
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="retro-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Capítulos do volume (removíveis) */}
          <div className="space-y-2">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
              Capítulos do volume
            </p>
            {chapters.length === 0 ? (
              <p className="text-xs italic text-neutral-700">
                Volume vazio. Adicione capítulos abaixo.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {chapters.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-700/60 bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
                  >
                    <span className="font-medium">Cap. {c.number}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveChapter(c.id)}
                      className="ml-0.5 rounded text-neutral-600 transition-colors hover:text-red-400"
                      aria-label={`Remover capítulo ${c.number} do volume`}
                    >
                      <X size={10} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Adicionar capítulos sem volume */}
          <div className="space-y-2 border-t border-neutral-800/60 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                Adicionar capítulos
              </p>
              <span className="text-[11px] text-neutral-600">
                ({pool.length} disponíveis)
              </span>
              {pool.length > 0 && (
                <button
                  type="button"
                  onClick={applyAdd}
                  disabled={addSel.size === 0}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={14} aria-hidden="true" />
                  Adicionar {addSel.size > 0 ? addSel.size : ''}
                </button>
              )}
            </div>
            {pool.length === 0 ? (
              <p className="text-xs italic text-neutral-700">
                Nenhum capítulo sem volume disponível.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={poolQuery}
                    onChange={(e) => setPoolQuery(e.target.value)}
                    placeholder="Filtrar por número…"
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-800/60 py-1.5 pl-8 pr-3 text-sm placeholder:text-neutral-700 focus:border-neutral-600 focus:outline-none"
                    aria-label="Filtrar capítulos disponíveis"
                  />
                </div>
                <div className="retro-scroll max-h-56 overflow-y-auto rounded-lg border border-neutral-700/50 bg-neutral-900/50">
                  <div className="flex flex-wrap gap-1.5 p-2">
                    {visiblePool.map((c) => {
                      const checked = addSel.has(c.id)
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleAdd(c.id)}
                          aria-pressed={checked}
                          className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                            checked
                              ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                              : 'border-neutral-700 bg-neutral-800/60 text-neutral-500 hover:text-neutral-300'
                          }`}
                        >
                          Cap. {c.number}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end border-t border-neutral-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors hover:bg-white"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  )
}
