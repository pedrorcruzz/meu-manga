import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Loader2, Search } from 'lucide-react'
import {
  api,
  NoSessionError,
  type Chapter,
  type DownloadRequest,
  type VolumeInput,
} from '~/api/client'
import { ChapterList, sortChapters } from '~/components/ChapterList'
import { VolumeBuilder } from '~/components/VolumeBuilder'
import { useSessionContext } from '~/context/session'
import { useAsync } from '~/hooks/useAsync'
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
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSessionError, setSubmitSessionError] = useState(false)

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
    if (!f) return sortedChapters
    return sortedChapters.filter(
      (c) => c.number.includes(f) || c.title.toLowerCase().includes(f),
    )
  }, [sortedChapters, filter])

  const allFilteredSelected =
    filteredChapters.length > 0 &&
    filteredChapters.every((c) => selected.has(c.id))

  function toggleChapter(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
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

  async function submitDownload(chapters: Chapter[], volumes?: VolumeInput[]) {
    if (!data) return
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSessionError(false)
    try {
      const body: DownloadRequest = {
        source,
        slug,
        title: data.manga.title,
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
          Sessão Cloudflare inválida — resolva o desafio no Navegador (veja o aviso
          acima).{' '}
          <button onClick={reload} className="underline hover:text-amber-200">
            Tentar de novo
          </button>
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
        <div className="flex flex-col justify-end gap-1.5 pb-1">
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-neutral-100 sm:text-3xl">
            {data.manga.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1 font-mono text-xs font-semibold text-neutral-300">
              <BookOpen size={13} aria-hidden="true" />
              {sortedChapters.length} capítulos
            </span>
            <span className="font-mono text-xs text-neutral-600">{source}</span>
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
            ? 'Sessão Cloudflare inválida — resolva o desafio no Navegador (veja o aviso acima).'
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

                {/* Linha 3: selecionar / limpar + contador */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={allFilteredSelected ? clearAll : selectAllFiltered}
                    className="text-xs text-neutral-500 transition-colors hover:text-neutral-200"
                  >
                    {allFilteredSelected ? 'Limpar' : 'Selecionar todos'}
                  </button>
                  {selected.size > 0 && !allFilteredSelected && (
                    <>
                      <span className="text-neutral-700" aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-xs text-neutral-500 transition-colors hover:text-neutral-200"
                      >
                        Limpar
                      </button>
                    </>
                  )}
                  {selected.size > 0 && (
                    <span className="ml-auto font-mono text-xs text-neutral-600">
                      {selected.size} / {sortedChapters.length} sel.
                    </span>
                  )}
                </div>
              </div>

              {/* Linhas de capítulos */}
              <ChapterList
                chapters={filteredChapters}
                selected={selected}
                onToggle={toggleChapter}
                bare
              />
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
          chapters={sortedChapters}
          submitting={submitting}
          onDownload={handleVolumeDownload}
        />
      )}
    </div>
  )
}
