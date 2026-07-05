// Construtor de volumes - automático ("Volume Inteligente") ou manual em dois painéis.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  Plus,
  Search,
  X,
  Zap,
} from 'lucide-react'
import { api, type Chapter, type VolumeInput } from '~/api/client'
import { VolumeCard, type Volume, type PreviewState } from './VolumeCard'
import { VolumeSelectModal } from './VolumeSelectModal'
import { FilterChip } from './FilterChip'
import { HelpButton } from './HelpButton'
import { useIncremental } from '~/hooks/useIncremental'

let _volCounter = 0
function nextVolId(): string {
  return `vol-${++_volCounter}`
}

function padName(index: number): string {
  return `V${String(index + 1).padStart(3, '0')}`
}

/**
 * Extrai o número inteiro de um rótulo como "Volume 15" → 15.
 * Retorna null se não encontrar dígitos.
 */
function parseSakuraVolumeNumber(label: string): number | null {
  const m = label.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

/**
 * Agrupa capítulos pelo campo `volume` retornado pelo Sakura e gera volumes.
 * - Preserva a ordem de aparecimento dos grupos.
 * - Ordena capítulos numericamente dentro de cada grupo.
 * - Capítulos com `volume === ""` são ignorados.
 */
function buildSakuraVolumes(chapters: Chapter[]): Volume[] {
  const groups = new Map<string, Chapter[]>()
  const groupOrder: string[] = []

  for (const ch of chapters) {
    const label = ch.volume ?? ''
    if (label === '') continue
    if (!groups.has(label)) {
      groups.set(label, [])
      groupOrder.push(label)
    }
    groups.get(label)!.push(ch)
  }

  return groupOrder.map((label) => {
    const chaps = groups.get(label)!
    const sorted = [...chaps].sort(
      (a, b) => parseFloat(a.number) - parseFloat(b.number),
    )
    const num = parseSakuraVolumeNumber(label)
    const name = num !== null ? `V${String(num).padStart(3, '0')}` : label
    return {
      id: nextVolId(),
      name,
      label,
      chapters: sorted,
      coverImage: null,
    }
  })
}

interface VolumeBuilderProps {
  /** Source id da obra, ex.: "sakura". Necessário para o endpoint de preview. */
  source: string
  /** Capítulos já ordenados pelo modo atual (crescente ou decrescente). */
  chapters: Chapter[]
  submitting: boolean
  onDownload: (volumes: VolumeInput[], allChapters: Chapter[]) => void
}

export function VolumeBuilder({
  source,
  chapters,
  submitting,
  onDownload,
}: VolumeBuilderProps) {
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [leftFilter, setLeftFilter] = useState('')
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set())
  const [targetVolId, setTargetVolId] = useState<string>('')
  // Âncora para seleção em intervalo no pool (shift+clique).
  const lastLeftRef = useRef<string | null>(null)

  // Filtros do pool: por volume da fonte e por estado de seleção/atribuição.
  const [volFilter, setVolFilter] = useState<'all' | 'with' | 'without'>('all')
  const [selFilter, setSelFilter] = useState<'all' | 'assigned' | 'unassigned'>(
    'all',
  )

  // ── Popup de seleção de volumes ──────────────────────────────────────────────
  const [pending, setPending] = useState<{
    volumes: Volume[]
    leftover: Chapter[]
    title: string
  } | null>(null)

  // Popup do montador manual.
  const [manualOpen, setManualOpen] = useState(false)

  // ESC fecha o montador manual.
  useEffect(() => {
    if (!manualOpen || typeof window === 'undefined') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setManualOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [manualOpen])

  // ── Carousel state ───────────────────────────────────────────────────────────
  const [currentVolIdx, setCurrentVolIdx] = useState(0)
  const [jumpQuery, setJumpQuery] = useState('')

  // ── Preview state ────────────────────────────────────────────────────────────
  /** Cache de imagens de preview, persistente entre gerações. Chave: `${chapter.id}:3`. */
  const previewCacheRef = useRef<Map<string, string[]>>(new Map())
  /** Número da epoch de fetch atual - incrementado a cada geração para cancelar fetches obsoletos. */
  const fetchEpochRef = useRef(0)
  const [volumePreviews, setVolumePreviews] = useState<Record<string, PreviewState>>({})

  // ── Success animation state ──────────────────────────────────────────────────
  const [sakuraSuccess, setSakuraSuccess] = useState(false)

  // ── Estado derivado ──────────────────────────────────────────────────────────

  const assignedIds = useMemo(
    () => new Set(volumes.flatMap((v) => v.chapters.map((c) => c.id))),
    [volumes],
  )

  const unassigned = useMemo(
    () => chapters.filter((c) => !assignedIds.has(c.id)),
    [chapters, assignedIds],
  )

  const hasSakuraVolumes = useMemo(
    () => chapters.some((c) => c.volume),
    [chapters],
  )

  const filteredLeft = useMemo(() => {
    const f = leftFilter.trim().toLowerCase()
    return chapters.filter((c) => {
      if (f && !(c.number.includes(f) || c.title.toLowerCase().includes(f)))
        return false
      if (volFilter === 'with' && !c.volume) return false
      if (volFilter === 'without' && c.volume) return false
      if (selFilter === 'assigned' && !assignedIds.has(c.id)) return false
      if (selFilter === 'unassigned' && assignedIds.has(c.id)) return false
      return true
    })
  }, [chapters, leftFilter, volFilter, selFilter, assignedIds])

  // Scroll infinito do pool - revela os capítulos em lotes conforme rola.
  const {
    visible: visibleLeft,
    sentinelRef: leftSentinelRef,
    hasMore: leftHasMore,
  } = useIncremental(filteredLeft, 50)

  // Contadores para os chips de filtro do pool.
  const poolCounts = useMemo(() => {
    const withVol = chapters.filter((c) => c.volume).length
    const assigned = chapters.filter((c) => assignedIds.has(c.id)).length
    return {
      withVol,
      withoutVol: chapters.length - withVol,
      assigned,
      unassigned: chapters.length - assigned,
    }
  }, [chapters, assignedIds])

  const poolFiltersActive = volFilter !== 'all' || selFilter !== 'all'

  /** Índice seguro: clampado dentro dos limites do array de volumes. */
  const safeCurrentVolIdx =
    volumes.length === 0
      ? 0
      : Math.max(0, Math.min(currentVolIdx, volumes.length - 1))

  /** Volume atualmente exibido no carousel. */
  const currentVol = volumes[safeCurrentVolIdx] ?? null

  /** targetVolId efectivo: fallback para o volume atual no carousel */
  const effectiveTargetVolId = useMemo(() => {
    if (volumes.find((v) => v.id === targetVolId)) return targetVolId
    return volumes[safeCurrentVolIdx]?.id ?? ''
  }, [volumes, targetVolId, safeCurrentVolIdx])

  const selectableInLeft = useMemo(
    () => filteredLeft.filter((c) => !assignedIds.has(c.id)).length,
    [filteredLeft, assignedIds],
  )

  const addableCount = useMemo(
    () =>
      [...leftSelected].filter((id) => !assignedIds.has(id)).length,
    [leftSelected, assignedIds],
  )

  const totalAssigned = chapters.length - unassigned.length

  // ── Preview fetch (2 workers em paralelo, cache por chapter id) ─────────────

  function triggerPreviews(vols: Volume[]) {
    const epoch = ++fetchEpochRef.current
    setVolumePreviews({})

    const tasks = vols.filter((v) => v.chapters.length > 0)
    if (tasks.length === 0) return

    let cursor = 0

    async function worker() {
      while (true) {
        if (fetchEpochRef.current !== epoch) return
        const idx = cursor++
        if (idx >= tasks.length) return

        const vol = tasks[idx]
        const ch = vol.chapters[0]
        const key = `${ch.id}:3`

        if (previewCacheRef.current.has(key)) {
          if (fetchEpochRef.current === epoch) {
            setVolumePreviews((prev) => ({
              ...prev,
              [vol.id]: { status: 'loaded', images: previewCacheRef.current.get(key)! },
            }))
          }
          continue
        }

        if (fetchEpochRef.current === epoch) {
          setVolumePreviews((prev) => ({ ...prev, [vol.id]: { status: 'loading' } }))
        }

        try {
          const res = await api.previewChapter(source, ch, 3)
          previewCacheRef.current.set(key, res.images)
          if (fetchEpochRef.current === epoch) {
            setVolumePreviews((prev) => ({
              ...prev,
              [vol.id]: { status: 'loaded', images: res.images },
            }))
          }
        } catch {
          if (fetchEpochRef.current === epoch) {
            setVolumePreviews((prev) => ({ ...prev, [vol.id]: { status: 'error' } }))
          }
        }
      }
    }

    void Promise.all([worker(), worker()])
  }

  // ── Volume Inteligente ───────────────────────────────────────────────────────

  /**
   * Abre o popup: detecta os volumes oficiais da fonte e reúne os capítulos
   * sem volume (lançamentos recentes) para o usuário montar como quiser.
   */
  function openSmartPopup() {
    const sakuraVols = buildSakuraVolumes(chapters)
    const inProposed = new Set(
      sakuraVols.flatMap((v) => v.chapters.map((c) => c.id)),
    )
    const leftover = chapters.filter((c) => !inProposed.has(c.id))
    if (sakuraVols.length === 0 && leftover.length === 0) return
    setPending({
      volumes: sakuraVols,
      leftover,
      title: 'Volume Inteligente',
    })
  }

  /** Aplica os volumes escolhidos no popup, mantendo os nomes já atribuídos. */
  function applyPending(chosen: Volume[]) {
    setPending(null)
    if (chosen.length === 0) return
    setVolumes(chosen)
    setCurrentVolIdx(0)
    setTargetVolId(chosen[0]?.id ?? '')
    setLeftSelected(new Set())
    setSakuraSuccess(true)
    setTimeout(() => setSakuraSuccess(false), 700)
    triggerPreviews(chosen)
  }

  // ── Gestão de volumes ────────────────────────────────────────────────────────

  function addEmptyVolume() {
    const newVol: Volume = {
      id: nextVolId(),
      name: padName(volumes.length),
      chapters: [],
      coverImage: null,
    }
    const newIdx = volumes.length
    setVolumes((prev) => [...prev, newVol])
    setCurrentVolIdx(newIdx)
    setTargetVolId(newVol.id)
  }

  function removeVolume(id: string) {
    const removedIdx = volumes.findIndex((v) => v.id === id)
    const newVols = volumes.filter((v) => v.id !== id)
    let newIdx = safeCurrentVolIdx
    if (removedIdx < safeCurrentVolIdx) {
      // volume removido estava antes do atual → desloca o índice para a esquerda
      newIdx = safeCurrentVolIdx - 1
    } else if (removedIdx === safeCurrentVolIdx) {
      // volume removido era o atual → permanece na mesma posição (novo vizinho)
      newIdx = Math.min(safeCurrentVolIdx, newVols.length - 1)
    }
    newIdx = Math.max(0, newIdx)
    setVolumes(newVols)
    setCurrentVolIdx(newIdx)
    setTargetVolId(newVols[newIdx]?.id ?? '')
  }

  function renameVolume(id: string, name: string) {
    setVolumes((prev) => prev.map((v) => (v.id === id ? { ...v, name } : v)))
  }

  function removeChapterFromVolume(volId: string, chapterId: string) {
    setVolumes((prev) =>
      prev.map((v) =>
        v.id === volId
          ? { ...v, chapters: v.chapters.filter((c) => c.id !== chapterId) }
          : v,
      ),
    )
  }

  function setCover(volId: string, dataUrl: string | null) {
    setVolumes((prev) =>
      prev.map((v) => (v.id === volId ? { ...v, coverImage: dataUrl } : v)),
    )
  }

  function pullNext(volId: string, n: number) {
    const toAdd = unassigned.slice(0, n)
    if (toAdd.length === 0) return
    setVolumes((prev) =>
      prev.map((v) =>
        v.id === volId ? { ...v, chapters: [...v.chapters, ...toAdd] } : v,
      ),
    )
  }

  // ── Navegação do carousel ────────────────────────────────────────────────────

  function goPrev() {
    const newIdx = Math.max(0, safeCurrentVolIdx - 1)
    setCurrentVolIdx(newIdx)
    setTargetVolId(volumes[newIdx]?.id ?? '')
  }

  function goNext() {
    const newIdx = Math.min(volumes.length - 1, safeCurrentVolIdx + 1)
    setCurrentVolIdx(newIdx)
    setTargetVolId(volumes[newIdx]?.id ?? '')
  }

  function goTo(idx: number) {
    if (idx >= 0 && idx < volumes.length) {
      setCurrentVolIdx(idx)
      setTargetVolId(volumes[idx]?.id ?? '')
    }
  }

  /** Navega automaticamente enquanto o usuário digita (número ou nome). */
  function handleJumpChange(value: string) {
    setJumpQuery(value)
    const q = value.trim()
    if (!q) return

    // Número puro → vai direto para o volume nessa posição (1-based).
    if (/^\d+$/.test(q)) {
      const num = parseInt(q, 10)
      if (num >= 1 && num <= volumes.length) goTo(num - 1)
      return
    }

    // Substring do nome (case-insensitive; ex: "V003", "003").
    const found = volumes.findIndex((v) =>
      v.name.toLowerCase().includes(q.toLowerCase()),
    )
    if (found !== -1) goTo(found)
  }

  // ── Painel de capítulos (esquerda) ───────────────────────────────────────────

  function toggleLeftChapter(id: string, shiftKey = false) {
    if (assignedIds.has(id)) return
    if (shiftKey && lastLeftRef.current) {
      const a = filteredLeft.findIndex((c) => c.id === lastLeftRef.current)
      const b = filteredLeft.findIndex((c) => c.id === id)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        const target = !leftSelected.has(id)
        setLeftSelected((prev) => {
          const next = new Set(prev)
          for (let i = lo; i <= hi; i++) {
            const cid = filteredLeft[i].id
            if (assignedIds.has(cid)) continue
            target ? next.add(cid) : next.delete(cid)
          }
          return next
        })
        lastLeftRef.current = id
        return
      }
    }
    setLeftSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    lastLeftRef.current = id
  }

  function selectAllUnassignedFiltered() {
    setLeftSelected(
      new Set(
        filteredLeft.filter((c) => !assignedIds.has(c.id)).map((c) => c.id),
      ),
    )
  }

  function clearLeftSelected() {
    setLeftSelected(new Set())
  }

  /** Inverte a seleção entre os capítulos filtrados ainda não atribuídos. */
  function invertLeftSelection() {
    setLeftSelected((prev) => {
      const next = new Set(prev)
      filteredLeft.forEach((c) => {
        if (assignedIds.has(c.id)) return
        next.has(c.id) ? next.delete(c.id) : next.add(c.id)
      })
      return next
    })
  }

  function clearPoolFilters() {
    setVolFilter('all')
    setSelFilter('all')
    setLeftFilter('')
  }

  function addSelectedToVolume() {
    if (!effectiveTargetVolId || leftSelected.size === 0) return
    const toAdd = chapters.filter(
      (c) => leftSelected.has(c.id) && !assignedIds.has(c.id),
    )
    if (toAdd.length === 0) return
    setVolumes((prev) =>
      prev.map((v) => {
        if (v.id !== effectiveTargetVolId) return v
        const existingIds = new Set(v.chapters.map((c) => c.id))
        const fresh = toAdd.filter((c) => !existingIds.has(c.id))
        return { ...v, chapters: [...v.chapters, ...fresh] }
      }),
    )
    setLeftSelected(new Set())
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  function handleDownload() {
    if (volumes.length === 0) return
    const volumeInputs: VolumeInput[] = volumes.map((v) => ({
      name: v.name,
      coverImage: v.coverImage,
      chapters: v.chapters.map((c) => ({
        id: c.id,
        number: c.number,
        url: c.url,
        title: c.title,
      })),
    }))
    onDownload(volumeInputs, chapters)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Montar volume ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-neutral-700/40 bg-neutral-900/50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-indigo-400" aria-hidden="true" />
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Montar volume
          </span>
          <span className="text-xs text-neutral-600">
            - escolha como agrupar os capítulos
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Opção: Volume Inteligente */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openSmartPopup}
              disabled={chapters.length === 0}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border border-indigo-700/50 bg-indigo-900/40 px-4 py-2.5 text-sm font-medium text-indigo-300 transition-colors hover:border-indigo-600/70 hover:bg-indigo-900/60 disabled:opacity-50${sakuraSuccess ? ' vol-success' : ''}`}
            >
              <Zap size={15} className="text-yellow-400" aria-hidden="true" />
              Volume Inteligente
            </button>
            <HelpButton label="O que é o Volume Inteligente?">
              Detecta automaticamente os volumes oficiais da fonte e monta as
              capas pra você - é só escolher quais baixar. Capítulos recentes
              que ainda não têm volume aparecem num painel à parte, onde você
              monta eles em volumes escolhendo os capítulos e quantos por
              volume.
            </HelpButton>
          </div>

          {/* Opção: Montar manualmente */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              disabled={chapters.length === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/60 px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800 disabled:opacity-50"
            >
              <Plus size={15} aria-hidden="true" />
              Montar manualmente
            </button>
            <HelpButton label="O que é o modo manual?" align="right">
              Abre um montador onde você organiza capítulo por capítulo em cada
              volume, com controle total: cria volumes, arrasta os capítulos do
              pool, define a capa e o nome de cada um. Ideal quando você quer
              montar do seu jeito, sem seguir os volumes da fonte.
            </HelpButton>
          </div>
        </div>
      </div>

      {/* ── Resumo ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="text-neutral-500">
          <span className="font-semibold text-neutral-200">{volumes.length}</span>{' '}
          {volumes.length === 1 ? 'volume' : 'volumes'}
        </span>
        <span className="text-neutral-500">
          <span className="font-semibold text-neutral-200">{totalAssigned}</span>/
          {chapters.length} caps. atribuídos
        </span>
        {unassigned.length > 0 && (
          <span className="flex items-center gap-1 font-medium text-amber-400">
            <AlertTriangle size={13} aria-hidden="true" />
            {unassigned.length} sem volume
          </span>
        )}
      </div>

      {/* ── Montador manual (em popup) ──────────────────────────────────────── */}
      {manualOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Montar volumes manualmente"
          className="vol-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setManualOpen(false)
          }}
        >
          <div className="vol-modal-panel flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Layers
                  size={18}
                  className="text-indigo-400"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="font-semibold text-neutral-100">
                    Montar volumes manualmente
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {volumes.length}{' '}
                    {volumes.length === 1 ? 'volume' : 'volumes'} ·{' '}
                    {totalAssigned}/{chapters.length} capítulos atribuídos
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Corpo com scroll */}
            <div className="retro-scroll min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[2fr_3fr]">
        {/* Painel de capítulos (esquerda) */}
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
          {/* Scroll container - header sticky dentro dele */}
          <div className="h-[55vh] overflow-y-auto">
            {/* Sticky header */}
            <div className="sticky top-0 z-10 space-y-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2.5">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                Pool de capítulos
              </p>
              {/* Campo de filtro */}
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={leftFilter}
                  onChange={(e) => setLeftFilter(e.target.value)}
                  placeholder="Filtrar por número ou título…"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-800/60 py-1.5 pl-8 pr-3 text-sm placeholder:text-neutral-700 focus:border-neutral-600 focus:outline-none"
                />
              </div>
              {/* Filtros de capítulos */}
              <div className="flex flex-wrap items-center gap-1">
                {hasSakuraVolumes && (
                  <>
                    <FilterChip
                      active={volFilter === 'with'}
                      count={poolCounts.withVol}
                      onClick={() =>
                        setVolFilter((v) => (v === 'with' ? 'all' : 'with'))
                      }
                    >
                      Com volume
                    </FilterChip>
                    <FilterChip
                      active={volFilter === 'without'}
                      count={poolCounts.withoutVol}
                      onClick={() =>
                        setVolFilter((v) =>
                          v === 'without' ? 'all' : 'without',
                        )
                      }
                    >
                      Sem volume
                    </FilterChip>
                  </>
                )}
                <FilterChip
                  active={selFilter === 'assigned'}
                  count={poolCounts.assigned}
                  onClick={() =>
                    setSelFilter((v) => (v === 'assigned' ? 'all' : 'assigned'))
                  }
                >
                  Já usados
                </FilterChip>
                <FilterChip
                  active={selFilter === 'unassigned'}
                  count={poolCounts.unassigned}
                  onClick={() =>
                    setSelFilter((v) =>
                      v === 'unassigned' ? 'all' : 'unassigned',
                    )
                  }
                >
                  Disponíveis
                </FilterChip>
                {(poolFiltersActive || leftFilter) && (
                  <button
                    type="button"
                    onClick={clearPoolFilters}
                    className="ml-1 flex items-center gap-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-200"
                  >
                    <X size={11} aria-hidden="true" />
                    Limpar filtros
                  </button>
                )}
              </div>
              {/* Selecionar todos / Inverter / Limpar */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllUnassignedFiltered}
                  disabled={selectableInLeft === 0}
                  className="text-xs text-neutral-500 transition-colors hover:text-neutral-200 disabled:opacity-40"
                >
                  Selecionar todos
                </button>
                <span className="text-neutral-700" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={invertLeftSelection}
                  disabled={selectableInLeft === 0}
                  className="text-xs text-neutral-500 transition-colors hover:text-neutral-200 disabled:opacity-40"
                >
                  Inverter
                </button>
                <span className="text-neutral-700" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={clearLeftSelected}
                  disabled={leftSelected.size === 0}
                  className="text-xs text-neutral-500 transition-colors hover:text-neutral-200 disabled:opacity-40"
                >
                  Limpar
                </button>
                <span className="hidden text-[11px] text-neutral-700 xl:inline">
                  shift+clique = intervalo
                </span>
                <span className="ml-auto text-xs text-neutral-600">
                  {poolFiltersActive || leftFilter
                    ? `${filteredLeft.length} filtrados · `
                    : ''}
                  {leftSelected.size} sel.
                </span>
              </div>
            </div>

            {/* Lista de capítulos */}
            <ul className="divide-y divide-neutral-800/50">
              {filteredLeft.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-neutral-700">
                  {leftFilter || volFilter !== 'all' || selFilter !== 'all'
                    ? 'Nenhum resultado.'
                    : 'Sem capítulos.'}
                </li>
              ) : (
                visibleLeft.map((c) => {
                  const assigned = assignedIds.has(c.id)
                  const checked = leftSelected.has(c.id)
                  return (
                    <li key={c.id}>
                      <div
                        role="checkbox"
                        aria-checked={checked}
                        aria-disabled={assigned}
                        tabIndex={assigned ? -1 : 0}
                        onClick={(e) =>
                          !assigned && toggleLeftChapter(c.id, e.shiftKey)
                        }
                        onKeyDown={(e) => {
                          if (assigned) return
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault()
                            toggleLeftChapter(c.id, e.shiftKey)
                          }
                        }}
                        className={`flex select-none items-center gap-2.5 px-3 py-2 transition-colors focus:outline-none ${
                          assigned
                            ? 'cursor-default opacity-40'
                            : 'cursor-pointer hover:bg-neutral-800/50 focus:bg-neutral-800/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={assigned}
                          readOnly
                          tabIndex={-1}
                          aria-hidden="true"
                          className="pointer-events-none h-3.5 w-3.5 shrink-0 accent-zinc-400 disabled:opacity-40"
                        />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          <span
                            className={
                              assigned
                                ? 'text-neutral-600'
                                : 'font-medium text-neutral-200'
                            }
                          >
                            Cap. {c.number}
                          </span>
                          {c.title && c.title !== c.number && (
                            <span className="text-neutral-600"> - {c.title}</span>
                          )}
                        </span>
                        {assigned && (
                          <Check
                            size={10}
                            className="shrink-0 text-neutral-700"
                            aria-label="já atribuído"
                          />
                        )}
                      </div>
                    </li>
                  )
                })
              )}
            </ul>
            {/* Sentinela do scroll infinito */}
            {leftHasMore && (
              <div
                ref={leftSentinelRef}
                className="py-3 text-center text-[11px] text-neutral-700"
              >
                carregando mais…
              </div>
            )}
          </div>

          {/* Ação: adicionar selecionados a um volume (fora do scroll) */}
          {volumes.length > 0 && (
            <div className="space-y-1.5 border-t border-neutral-800 p-3">
              <div className="flex items-center gap-2">
                <select
                  value={effectiveTargetVolId}
                  onChange={(e) => setTargetVolId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-300 focus:border-neutral-500 focus:outline-none"
                  aria-label="Volume de destino"
                >
                  {volumes.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addSelectedToVolume}
                  disabled={addableCount === 0 || !effectiveTargetVolId}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Adicionar
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
              {leftSelected.size > 0 && addableCount < leftSelected.size && (
                <p className="text-[11px] text-amber-500">
                  {leftSelected.size - addableCount} já{' '}
                  {leftSelected.size - addableCount === 1
                    ? 'atribuído'
                    : 'atribuídos'}{' '}
                  - será ignorado.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Painel de volumes (direita) - carousel */}
        <div className="space-y-3">
          {/* Cabeçalho do painel */}
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
              Volumes
            </p>
            <button
              type="button"
              onClick={addEmptyVolume}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-1.5 text-xs transition-colors hover:bg-neutral-800"
            >
              <Plus size={13} aria-hidden="true" />
              Novo volume
            </button>
          </div>

          {volumes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-800 py-12 text-center">
              <p className="text-sm text-neutral-600">Nenhum volume ainda.</p>
              <p className="mt-1 text-xs text-neutral-700">
                Clique em "Novo volume" para começar a montar.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Navegação do carousel */}
              <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={safeCurrentVolIdx === 0}
                  className="flex items-center justify-center rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Volume anterior"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <div className="flex flex-1 flex-col items-center gap-0.5">
                  <span className="font-mono text-sm font-bold text-neutral-200">
                    {currentVol?.name}
                  </span>
                  <span className="font-mono text-[10px] text-neutral-600">
                    {safeCurrentVolIdx + 1} / {volumes.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={safeCurrentVolIdx === volumes.length - 1}
                  className="flex items-center justify-center rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Próximo volume"
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>

              {/* Busca/salto - vai automático ao digitar o número ou nome */}
              <div className="relative">
                <Search
                  size={12}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={jumpQuery}
                  onChange={(e) => handleJumpChange(e.target.value)}
                  placeholder="Ir para volume… (digite 5 ou V005)"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-800/40 py-1.5 pl-7 pr-8 text-xs placeholder:text-neutral-700 focus:border-neutral-600 focus:outline-none"
                  aria-label="Ir para volume"
                  inputMode="numeric"
                />
                {jumpQuery && (
                  <button
                    type="button"
                    onClick={() => setJumpQuery('')}
                    aria-label="Limpar"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-600 transition-colors hover:text-neutral-300"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Pills de salto rápido (exibidas para coleções menores) */}
              {volumes.length <= 20 && (
                <div className="flex flex-wrap gap-1">
                  {volumes.map((v, i) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => goTo(i)}
                      title={v.name}
                      className={`rounded-md px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        i === safeCurrentVolIdx
                          ? 'bg-zinc-600 text-zinc-100'
                          : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}

              {/* Card do volume atual */}
              {currentVol && (
                <VolumeCard
                  key={currentVol.id}
                  volume={currentVol}
                  unassignedCount={unassigned.length}
                  onRename={(name) => renameVolume(currentVol.id, name)}
                  onRemoveChapter={(cid) =>
                    removeChapterFromVolume(currentVol.id, cid)
                  }
                  onCoverChange={(url) => setCover(currentVol.id, url)}
                  onRemove={() => removeVolume(currentVol.id)}
                  onPullNext={(n) => pullNext(currentVol.id, n)}
                  preview={volumePreviews[currentVol.id]}
                />
              )}
            </div>
          )}
        </div>
              </div>
            </div>

            {/* Rodapé do montador */}
            <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 px-5 py-4">
              <button
                type="button"
                onClick={handleDownload}
                disabled={volumes.length === 0 || submitting}
                className="flex items-center gap-2 rounded-xl bg-zinc-100 px-5 py-2 font-semibold text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={15} aria-hidden="true" />
                {submitting
                  ? 'Enviando…'
                  : `Baixar ${volumes.length} ${volumes.length === 1 ? 'volume' : 'volumes'}`}
              </button>
              {unassigned.length > 0 && volumes.length > 0 && (
                <p className="text-xs text-amber-400">
                  {unassigned.length} sem volume não{' '}
                  {unassigned.length !== 1 ? 'serão baixados' : 'será baixado'}.
                </p>
              )}
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="ml-auto rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Botão de download (página) ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 border-t border-neutral-800 pt-5">
        <button
          type="button"
          onClick={handleDownload}
          disabled={volumes.length === 0 || submitting}
          className="flex items-center gap-2 rounded-xl bg-zinc-100 px-6 py-2.5 font-semibold text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={16} aria-hidden="true" />
          {submitting
            ? 'Enviando…'
            : `Baixar ${volumes.length} ${volumes.length === 1 ? 'volume' : 'volumes'}`}
        </button>
        {unassigned.length > 0 && volumes.length > 0 && (
          <p className="text-xs text-amber-400">
            {unassigned.length} capítulo{unassigned.length !== 1 ? 's' : ''} sem
            volume não{unassigned.length !== 1 ? ' serão baixados' : ' será baixado'}.
          </p>
        )}
      </div>

      {/* ── Popup de seleção de volumes ──────────────────────────────────────── */}
      {pending && (
        <VolumeSelectModal
          title={pending.title}
          volumes={pending.volumes}
          leftoverChapters={pending.leftover}
          onConfirm={applyPending}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
