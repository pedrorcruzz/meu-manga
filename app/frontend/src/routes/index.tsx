import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Eye, Heart, Loader2, Search, Star } from 'lucide-react'
import { api, NoSessionError, type SearchResult } from '~/api/client'
import { useSessionContext } from '~/context/session'

export const Route = createFileRoute('/')({
  component: SearchPage,
})

const MIN_QUERY = 2
const DEBOUNCE_MS = 450

function SearchPage() {
  const { refresh: refreshSession } = useSessionContext()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSessionError, setIsSessionError] = useState(false)
  const [open, setOpen] = useState(false)

  // cache por termo (normalizado) - evita re-buscar o que já foi digitado
  const cache = useRef(new Map<string, SearchResult[]>())
  // id da última requisição - descarta respostas obsoletas
  const reqId = useRef(0)

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim()
      if (q.length < MIN_QUERY) {
        setResults([])
        setLoading(false)
        return
      }
      const key = q.toLowerCase()
      const cached = cache.current.get(key)
      if (cached) {
        setResults(cached)
        setLoading(false)
        setError(null)
        return
      }
      const id = ++reqId.current
      setLoading(true)
      setError(null)
      setIsSessionError(false)
      try {
        const r = await api.search('sakura', q)
        if (id !== reqId.current) return // resposta obsoleta
        cache.current.set(key, r)
        setResults(r)
      } catch (err) {
        if (id !== reqId.current) return
        if (err instanceof NoSessionError) {
          setIsSessionError(true)
          refreshSession()
        }
        setError(err instanceof Error ? err.message : String(err))
        setResults([])
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    },
    [refreshSession],
  )

  // busca ao vivo com debounce enquanto digita
  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY) {
      setResults([])
      setError(null)
      setLoading(false)
      return
    }
    setOpen(true)
    const t = setTimeout(() => runSearch(q), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, runSearch])

  const showPanel = open && query.trim().length >= MIN_QUERY

  return (
    <div className="relative -mx-4 -my-6 flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-4">
      <div className="retro-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative text-center">
        <p className="retro-title mb-3 inline-flex items-center gap-1 text-xs uppercase tracking-[0.4em] text-neutral-500">
          <ChevronRight size={11} aria-hidden="true" />
          INSERIR MANGÁ
        </p>
        <h1 className="retro-title retro-cursor bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-5xl font-bold uppercase tracking-[0.15em] text-transparent sm:text-6xl">
          Meu Mangá
        </h1>
        <p className="mt-4 font-mono text-sm text-neutral-500">
          busque · baixe · monte volumes
        </p>
      </div>

      <div className="relative z-10 w-full max-w-xl">
        <div className="relative">
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500"
            aria-hidden="true"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.trim().length >= MIN_QUERY && setOpen(true)}
            placeholder="Buscar mangá…"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 py-3 pl-11 pr-11 outline-none placeholder:text-neutral-500 focus:border-neutral-600"
          />
          {loading && (
            <Loader2
              size={18}
              className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-neutral-500"
              aria-hidden="true"
            />
          )}
        </div>

        {showPanel && (
          <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-[52vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/95 p-1.5 shadow-2xl backdrop-blur">
            {error ? (
              <p
                className={`rounded-lg px-3 py-2.5 text-sm ${
                  isSessionError ? 'text-amber-300' : 'text-red-400'
                }`}
              >
                {isSessionError
                  ? 'Sessão Cloudflare inválida - resolva o desafio (veja o aviso acima).'
                  : error}
              </p>
            ) : results.length === 0 && !loading ? (
              <p className="px-3 py-2.5 text-sm text-neutral-500">
                Nenhum resultado.
              </p>
            ) : (
              results.map((m) => (
                <SuggestionRow key={`${m.source}-${m.slug}`} manga={m} />
              ))
            )}
          </div>
        )}
      </div>

      <Link
        to="/downloads"
        className="relative font-mono text-xs uppercase tracking-widest text-neutral-500 transition hover:text-neutral-200"
      >
        [ ver downloads ]
      </Link>
    </div>
  )
}

function SuggestionRow({ manga }: { manga: SearchResult }) {
  const textParts: string[] = [
    manga.status || '',
    manga.year ? String(manga.year) : '',
    manga.demographic || '',
  ].filter(Boolean)

  const hasRating = !!(manga.rating && manga.rating !== '0.0')
  const hasViews = !!(manga.views && manga.views !== '0')
  const hasFavorites = !!(manga.favorites && manga.favorites !== '0')
  const hasMeta = textParts.length > 0 || hasRating || hasViews || hasFavorites

  return (
    <Link
      to="/obra/$source/$slug"
      params={{ source: manga.source, slug: manga.slug }}
      className="flex flex-col gap-0.5 rounded-lg border border-transparent px-3 py-2.5 transition hover:border-neutral-800 hover:bg-neutral-800/50"
    >
      <p className="truncate text-sm font-medium text-neutral-100">
        {manga.title}
      </p>
      {hasMeta && (
        <p className="flex items-center gap-1 truncate font-mono text-[11px] text-neutral-500">
          {textParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">·</span>}
              {part}
            </span>
          ))}
          {hasRating && (
            <span className="flex items-center gap-0.5">
              {textParts.length > 0 && <span aria-hidden="true">·</span>}
              <Star
                size={10}
                aria-hidden="true"
                className="shrink-0 fill-neutral-400 text-neutral-400"
              />
              {manga.rating}
            </span>
          )}
          {hasViews && (
            <span className="flex items-center gap-0.5">
              <span aria-hidden="true">·</span>
              <Eye size={10} aria-hidden="true" className="shrink-0" />
              {manga.views}
            </span>
          )}
          {hasFavorites && (
            <span className="flex items-center gap-0.5">
              <span aria-hidden="true">·</span>
              <Heart size={10} aria-hidden="true" className="shrink-0" />
              {manga.favorites}
            </span>
          )}
        </p>
      )}
    </Link>
  )
}
