import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Loader2,
  Pencil,
  Search,
  X,
} from 'lucide-react'
import {
  api,
  NoSessionError,
  type Chapter,
  type DownloadRequest,
  type VolumeInput,
} from '~/api/client'
import { ChapterList, sortChapters } from '~/components/ChapterList'
import { FilterChip } from '~/components/FilterChip'
import { HelpButton } from '~/components/HelpButton'
import { VolumeBuilder } from '~/components/VolumeBuilder'
import { useSessionContext } from '~/context/session'
import { useAsync } from '~/hooks/useAsync'
import { useIncremental } from '~/hooks/useIncremental'
import { thumbSrc } from '~/utils/img'

export const Route = createFileRoute('/obra/$source/$slug')({
  component: ObraPage,
})

type Mode = 'simple' | 'volume'
type Order = 'asc' | 'desc'

function ObraPage() {
  const { source, slug } = Route.useParams()
  const navigate = useNavigate()
  const { refresh: refreshSession } = useSessionContext()

  const { data, error, rawError, loading, reload } = useAsync(
    () => api.chapters(source, slug),
    [source, slug],
  )

  const [mode, setMode] = useState<Mode>('simple')
  const [order, setOrder] = useState<Order>('asc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [volFilter, setVolFilter] = useState<'all' | 'with' | 'without'>('all')
  const [selFilter, setSelFilter] = useState<'all' | 'sel' | 'unsel'>('all')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSessionError, setSubmitSessionError] = useState(false)
  // null = sem override (usa o título original); string = título editado pelo usuário
  const [titleOverride, setTitleOverride] = useState<string | null>(null)

  const isSessionError = rawError instanceof NoSessionError

  useEffect(() => {
    if (isSessionError) refreshSession()
  }, [isSessionError, refreshSession])

  const sortedChapters = useMemo(
    () => sortChapters(data?.chapters ?? [], order),
    [data, order],
  )

  const filteredChapters = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return sortedChapters.filter((c) => {
      if (f && !(c.number.includes(f) || c.title.toLowerCase().includes(f)))
        return false
      if (volFilter === 'with' && !c.volume) return false
      if (volFilter === 'without' && c.volume) return false
      if (selFilter === 'sel' && !selected.has(c.id)) return false
      if (selFilter === 'unsel' && selected.has(c.id)) return false
      return true
    })
  }, [sortedChapters, filter, volFilter, selFilter, selected])

  const hasSourceVolumes = useMemo(
    () => sortedChapters.some((c) => c.volume),
    [sortedChapters],
  )

  const {
    visible: visibleChapters,
    sentinelRef: chapterSentinelRef,
    hasMore: chaptersHasMore,
  } = useIncremental(filteredChapters, 50)

  // Contadores para os chips de filtro.
  const poolCounts = useMemo(() => {
    const withVol = sortedChapters.filter((c) => c.volume).length
    const sel = sortedChapters.filter((c) => selected.has(c.id)).length
    return {
      withVol,
      withoutVol: sortedChapters.length - withVol,
      sel,
      unsel: sortedChapters.length - sel,
    }
  }, [sortedChapters, selected])

  const filtersActive = volFilter !== 'all' || selFilter !== 'all'

  const allFilteredSelected =
    filteredChapters.length > 0 &&
    filteredChapters.every((c) => selected.has(c.id))

  // Último capítulo alternado - âncora para seleção em intervalo (shift+clique).
  const lastToggledRef = useRef<string | null>(null)

  function toggleChapter(id: string, shiftKey = false) {
    if (shiftKey && lastToggledRef.current) {
      const a = filteredChapters.findIndex(
        (c) => c.id === lastToggledRef.current,
      )
      const b = filteredChapters.findIndex((c) => c.id === id)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        const target = !selected.has(id)
        setSelected((prev) => {
          const next = new Set(prev)
          for (let i = lo; i <= hi; i++) {
            const cid = filteredChapters[i].id
            target ? next.add(cid) : next.delete(cid)
          }
          return next
        })
        lastToggledRef.current = id
        return
      }
    }
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    lastToggledRef.current = id
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev)
      filteredChapters.forEach((c) => next.add(c.id))
      return next
    })
  }

  function clearAll() {
    setSelected(new Set())
  }

  /** Inverte a seleção dentro do subconjunto atualmente filtrado. */
  function invertFilteredSelection() {
    setSelected((prev) => {
      const next = new Set(prev)
      filteredChapters.forEach((c) =>
        next.has(c.id) ? next.delete(c.id) : next.add(c.id),
      )
      return next
    })
  }

  function clearFilters() {
    setVolFilter('all')
    setSelFilter('all')
    setFilter('')
  }

  async function submitDownload(chapters: Chapter[], volumes?: VolumeInput[]) {
    if (!data) return
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSessionError(false)
    try {
      const body: DownloadRequest = {
        source,
        slug,
        title: titleOverride ?? data.manga.title,
        order,
        chapters: chapters.map((c) => ({
          id: c.id,
          number: c.number,
          url: c.url,
          title: c.title,
        })),
      }
      if (volumes) body.volumes = volumes
      await api.createJob(body)
      navigate({ to: '/downloads' })
    } catch (err) {
      if (err instanceof NoSessionError) {
        setSubmitSessionError(true)
        refreshSession()
      }
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  function handleVolumeDownload(volumes: VolumeInput[], allChapters: Chapter[]) {
    void submitDownload(allChapters, volumes)
  }

  // ── Estados de carregamento / erro ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-neutral-500">
        <Loader2 size={28} className="animate-spin" aria-hidden="true" />
        <span className="font-mono text-sm">Carregando capítulos…</span>
      </div>
    )
  }

  if (error) {
    if (isSessionError) {
      return (
        <div className="rounded-xl bg-amber-950/50 px-5 py-4 text-sm text-amber-300">
          Sessão Cloudflare inválida - resolva o desafio no Navegador (veja o aviso
          acima).{' '}
          <button onClick={reload} className="underline hover:text-amber-200">
            Tentar de novo
          </button>
        </div>
      )
    }
    if (error?.startsWith('bloqueio temporário')) {
      return (
        <div className="space-y-2 rounded-xl border border-rose-800/50 bg-rose-950/40 px-5 py-4 text-sm text-rose-200">
          <p className="font-semibold text-rose-200">
            Bloqueio temporário do site (não é o Cloudflare)
          </p>
          <p className="text-rose-200/80">{error}</p>
          <p className="text-xs text-rose-300/60">
            Espere o horário indicado - tentar agora só prolonga o bloqueio.
          </p>
        </div>
      )
    }
    return (
      <div className="rounded-xl bg-red-950/60 px-5 py-4 text-sm text-red-400">
        {error}
      </div>
    )
  }

  if (!data) return null

  const selectedChapters = sortedChapters.filter((c) => selected.has(c.id))

  return (
    <div className="space-y-6">
      {/* Navegação de volta */}
      <Link
        to="/"
        className="flex w-fit items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-200"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Voltar
      </Link>

      {/* Cabeçalho da obra */}
      <div className="flex gap-5">
        {data.manga.thumbUrl && (
          <img
            src={thumbSrc(source, data.manga.thumbUrl)}
            alt={data.manga.title}
            className="h-44 w-32 shrink-0 rounded-xl object-cover shadow-lg"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        )}
        <div className="flex min-w-0 flex-col justify-end gap-2 pb-1">
          {/* Rótulo do campo editável + ajuda */}
          <div className="flex items-center gap-1.5">
            <Pencil size={12} className="text-neutral-500" aria-hidden="true" />
            <label
              htmlFor="obra-title"
              className="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
            >
              Nome do Manga
            </label>
            <HelpButton label="O que é o nome do mangá?">
              É o nome do mangá e também da pasta onde os capítulos ficam
              salvos no seu computador. Mudar aqui troca só o nome dessa pasta
              de destino. Não altera o site de origem nem o conteúdo baixado.
              No disco fica assim: Nome do Manga {'>'} Nome do Manga V001{' '}
              {'>'} Cap 1.
            </HelpButton>
          </div>
          {/* Campo do título com moldura clara de edição */}
          <div className="group flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 transition-colors focus-within:border-neutral-500">
            <input
              id="obra-title"
              type="text"
              value={titleOverride ?? data.manga.title}
              onChange={(e) => setTitleOverride(e.target.value)}
              className="w-full min-w-0 bg-transparent text-2xl font-bold leading-tight tracking-tight text-neutral-100 focus:outline-none sm:text-3xl"
              aria-label="Nome da pasta no disco (título da obra)"
            />
            <Pencil
              size={15}
              className="shrink-0 text-neutral-600 transition-colors group-focus-within:text-neutral-300"
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1 font-mono text-xs font-semibold text-neutral-300">
              <BookOpen size={13} aria-hidden="true" />
              {sortedChapters.length} capítulos
            </span>
            <span className="font-mono text-xs text-neutral-600">{source}</span>
            {titleOverride !== null && titleOverride !== data.manga.title && (
              <button
                type="button"
                onClick={() => setTitleOverride(null)}
                className="font-mono text-xs text-neutral-500 underline transition-colors hover:text-neutral-200"
              >
                restaurar título original
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Erro de envio */}
      {submitError && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            submitSessionError
              ? 'bg-amber-950/50 text-amber-300'
              : 'bg-red-950/60 text-red-400'
          }`}
        >
          {submitSessionError
            ? 'Sessão Cloudflare inválida - resolva o desafio no Navegador (veja o aviso acima).'
            : submitError}
        </div>
      )}

      {/* Barra de modo */}
      <div className="flex items-center gap-3">
        <div
          className="flex overflow-hidden rounded-lg border border-neutral-700 text-sm"
          role="group"
          aria-label="Modo de download"
        >
          <button
            type="button"
            onClick={() => setMode('simple')}
            className={`px-4 py-1.5 transition-colors ${
              mode === 'simple'
                ? 'bg-neutral-700 text-neutral-100'
                : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'
            }`}
          >
            Simples
          </button>
          <button
            type="button"
            onClick={() => setMode('volume')}
            className={`px-4 py-1.5 transition-colors ${
              mode === 'volume'
                ? 'bg-neutral-700 text-neutral-100'
                : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'
            }`}
          >
            Montar volumes
          </button>
        </div>
      </div>

      {/* ── Modo simples ──────────────────────────────────────────────────────── */}
      {mode === 'simple' && (
        <div className="space-y-4">
          {/* Painel de capítulos com header sticky */}
          <div className="overflow-hidden rounded-xl border border-neutral-800">
            <div className="h-[60vh] overflow-y-auto">
              {/* Header fixo com controles */}
              <div className="sticky top-0 z-10 space-y-2.5 border-b border-neutral-800 bg-neutral-950 px-4 py-3">
                {/* Linha 1: toggle de ordem */}
                <div
                  className="flex overflow-hidden rounded-lg border border-neutral-800 text-xs w-fit"
                  role="group"
                  aria-label="Ordem dos capítulos"
                >
                  <button
                    type="button"
                    onClick={() => setOrder('asc')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                      order === 'asc'
                        ? 'bg-neutral-800 text-neutral-100'
                        : 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300'
                    }`}
                  >
                    <ArrowUp size={12} aria-hidden="true" />
                    Crescente
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrder('desc')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                      order === 'desc'
                        ? 'bg-neutral-800 text-neutral-100'
                        : 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300'
                    }`}
                  >
                    <ArrowDown size={12} aria-hidden="true" />
                    Decrescente
                  </button>
                </div>

                {/* Linha 2: campo de filtro */}
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filtrar por número ou título…"
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-900 py-2 pl-9 pr-4 text-sm placeholder:text-neutral-600 focus:border-neutral-700 focus:outline-none"
                  />
                </div>

                {/* Linha 3: filtros de capítulos */}
                <div className="flex flex-wrap items-center gap-1">
                  {hasSourceVolumes && (
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
                    active={selFilter === 'sel'}
                    count={poolCounts.sel}
                    onClick={() =>
                      setSelFilter((v) => (v === 'sel' ? 'all' : 'sel'))
                    }
                  >
                    Selecionados
                  </FilterChip>
                  <FilterChip
                    active={selFilter === 'unsel'}
                    count={poolCounts.unsel}
                    onClick={() =>
                      setSelFilter((v) => (v === 'unsel' ? 'all' : 'unsel'))
                    }
                  >
                    Não selecionados
                  </FilterChip>
                  {(filtersActive || filter) && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="ml-1 flex items-center gap-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-200"
                    >
                      <X size={11} aria-hidden="true" />
                      Limpar filtros
                    </button>
                  )}
                </div>

                {/* Linha 4: selecionar / inverter / limpar + contador */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={allFilteredSelected ? clearAll : selectAllFiltered}
                    disabled={filteredChapters.length === 0}
                    className="text-xs text-neutral-500 transition-colors hover:text-neutral-200 disabled:opacity-40"
                  >
                    {allFilteredSelected ? 'Limpar visíveis' : 'Selecionar todos'}
                  </button>
                  <span className="text-neutral-700" aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={invertFilteredSelection}
                    disabled={filteredChapters.length === 0}
                    className="text-xs text-neutral-500 transition-colors hover:text-neutral-200 disabled:opacity-40"
                  >
                    Inverter
                  </button>
                  {selected.size > 0 && (
                    <>
                      <span className="text-neutral-700" aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-xs text-neutral-500 transition-colors hover:text-neutral-200"
                      >
                        Limpar tudo
                      </button>
                    </>
                  )}
                  <span className="hidden text-[11px] text-neutral-700 md:inline">
                    shift+clique = intervalo
                  </span>
                  <span className="ml-auto font-mono text-xs text-neutral-600">
                    {filtersActive || filter
                      ? `${filteredChapters.length} filtrados · `
                      : ''}
                    {selected.size} / {sortedChapters.length} sel.
                  </span>
                </div>
              </div>

              {/* Linhas de capítulos */}
              <ChapterList
                chapters={visibleChapters}
                selected={selected}
                onToggle={toggleChapter}
                bare
              />
              {/* Sentinela do scroll infinito */}
              {chaptersHasMore && (
                <div
                  ref={chapterSentinelRef}
                  className="py-3 text-center text-[11px] text-neutral-700"
                >
                  carregando mais…
                </div>
              )}
            </div>
          </div>

          {/* Ações de download (fora do scroll) */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void submitDownload(selectedChapters)}
              disabled={selected.size === 0 || submitting}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
            >
              {submitting
                ? 'Enviando…'
                : `Baixar ${selected.size > 0 ? String(selected.size) + ' ' : ''}selecionado${selected.size !== 1 ? 's' : ''}`}
            </button>
            <button
              type="button"
              onClick={() => void submitDownload(sortedChapters)}
              disabled={sortedChapters.length === 0 || submitting}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-800 disabled:opacity-50"
            >
              Baixar todos
            </button>
          </div>
        </div>
      )}

      {/* ── Modo volumes ──────────────────────────────────────────────────────── */}
      {mode === 'volume' && (
        <VolumeBuilder
          source={source}
          chapters={sortedChapters}
          submitting={submitting}
          onDownload={handleVolumeDownload}
        />
      )}
    </div>
  )
}
