// "Meus Mangas" — a biblioteca. Aponte a pasta CENTRAL onde ficam todas as suas
// obras (ex.: ".../Mangas", que é a MESMA pasta dos downloads) e o app varre cada
// subpasta como uma obra. Um popup em tela cheia (100vh) lista tudo com scroll
// infinito; cada obra tem "Consertar", que abre o editor folder-first lendo/
// gravando direto na pasta. Nada é re-baixado. A pasta central é persistida no
// SQLite (é o mesmo `downloadDir`).

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Download,
  FolderSearch,
  HardDrive,
  Layers,
  Library,
  Loader2,
  Search,
  Wrench,
  X,
} from 'lucide-react'
import { api, type LibraryManga } from '~/api/client'
import { HelpButton } from '~/components/HelpButton'
import { VolumeEditor } from '~/components/VolumeEditor'
import { useIncremental } from '~/hooks/useIncremental'

export const Route = createFileRoute('/pasta')({
  component: MeusMangasPage,
})

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function MeusMangasPage() {
  const [path, setPath] = useState('')
  const [mangas, setMangas] = useState<LibraryManga[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  // A pasta central persistida ainda existe no disco? (falso = SSD externo
  // desconectado / pasta movida). Enquanto falso, mostramos um banner em vez de
  // varrer (a varredura devolveria "0 obras" e confundiria com pasta vazia).
  const [available, setAvailable] = useState(true)
  const [editing, setEditing] = useState<LibraryManga | null>(null)
  // Bumpa após fechar o editor para re-varrer a biblioteca (refletir as mudanças).
  const [rev, setRev] = useState(0)

  // A pasta central é a própria pasta de downloads (biblioteca e destino
  // unificados) — persistida no SQLite.
  useEffect(() => {
    let alive = true
    api
      .getSettings()
      .then((s) => {
        if (!alive) return
        setPath(s.downloadDir || '')
        setAvailable(s.downloadDirExists)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // (Re)varre a biblioteca sempre que a pasta muda ou após uma edição.
  useEffect(() => {
    if (!path || !available) {
      setMangas(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    api
      .folderLibrary()
      .then((list) => {
        if (alive) setMangas(list)
      })
      .catch((e) => {
        if (alive) {
          setError(errMsg(e))
          setMangas(null)
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [path, rev, available])

  // Escolher a pasta central = escolher a pasta de downloads (unificado).
  async function pick() {
    setPicking(true)
    setError(null)
    try {
      const s = await api.pickFolder()
      if (s.downloadDir) {
        setPath(s.downloadDir)
        setAvailable(s.downloadDirExists)
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setPicking(false)
    }
  }

  const editor = useMemo(
    () => (editing ? api.folderEditor(editing.path) : null),
    [editing],
  )

  const count = mangas?.length ?? 0
  const empty = mangas != null && count === 0

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

      {/* Cabeçalho */}
      <div className="flex items-center gap-2.5">
        <Library size={20} className="text-violet-400/80" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Meus Mangás</h1>
          <p className="text-xs text-neutral-500">
            Aponte a pasta central onde ficam suas obras e organize os volumes
            lendo direto do disco.
          </p>
        </div>
      </div>

      {/* Explicação */}
      <div className="flex items-start gap-2.5 rounded-xl border border-sky-900/40 bg-sky-950/20 p-3">
        <FolderSearch
          size={14}
          className="mt-0.5 shrink-0 text-sky-400"
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-sky-200/70">
          Escolha a{' '}
          <span className="font-semibold text-sky-200">pasta central</span> que
          guarda todas as suas obras — é a{' '}
          <span className="font-semibold text-sky-200">
            mesma pasta dos seus downloads
          </span>
          .
        </p>
        <HelpButton label="Como funciona a pasta central?" align="right">
          É a pasta que contém uma subpasta por obra, ex.:{' '}
          <span className="font-mono">Mangas</span>, com{' '}
          <span className="font-mono">Mangas/Witch Hat Atelier</span>,{' '}
          <span className="font-mono">Mangas/Sakamoto Days</span>… Como é a mesma
          pasta dos seus downloads, o que você baixa já aparece aqui. O app varre
          cada subpasta como uma obra; nada é re-baixado, só lido e reorganizado.
          Funciona quando as pastas seguem o padrão do sistema.
        </HelpButton>
      </div>

      {/* Seletor da pasta central */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="min-w-0 flex-1 truncate rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 font-mono text-xs text-neutral-300">
          {path || '(nenhuma pasta escolhida)'}
        </p>
        <button
          type="button"
          onClick={() => void pick()}
          disabled={picking}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-xs transition-colors hover:bg-neutral-700 disabled:opacity-50"
        >
          {picking ? (
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          ) : (
            <FolderSearch size={13} aria-hidden="true" />
          )}
          {picking ? 'Abrindo…' : 'Escolher pasta central…'}
        </button>
      </div>

      {/* Erro */}
      {error && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-3 font-mono text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Pasta persistida sumiu (ex.: SSD externo desconectado) */}
      {path && !available && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-900/50 bg-amber-950/30 p-4">
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-amber-400"
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-semibold text-amber-200">
              Pasta central indisponível
            </p>
            <p className="text-xs leading-relaxed text-amber-200/70">
              A pasta salva não está acessível agora:{' '}
              <span className="break-all font-mono text-amber-100">{path}</span>.
              Se ela fica num HD/SSD externo, conecte-o e reabra esta tela — ou
              escolha outra pasta central.
            </p>
            <button
              type="button"
              onClick={() => void pick()}
              disabled={picking}
              className="flex items-center gap-1.5 rounded-lg border border-amber-700/60 bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-900/50 disabled:opacity-50"
            >
              {picking ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <FolderSearch size={13} aria-hidden="true" />
              )}
              Trocar de pasta…
            </button>
          </div>
        </div>
      )}

      {/* Biblioteca inline: as obras aparecem aqui mesmo, com scroll infinito */}
      {path && available && !error && (
        <>
          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 font-mono text-sm text-neutral-500">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              Varrendo a biblioteca…
            </div>
          ) : empty ? (
            <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 py-2 text-center">
              <p className="text-sm text-neutral-500">
                Nenhuma obra encontrada nesta pasta. Confira se você apontou a
                pasta central (a que contém as pastas das obras).
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
              >
                <Search size={14} aria-hidden="true" />
                Baixar um mangá
              </Link>
            </div>
          ) : mangas ? (
            <LibraryGrid
              mangas={mangas}
              onFix={(m) => setEditing(m)}
              rev={rev}
            />
          ) : null}
        </>
      )}

      {/* Editor "Consertar volumes" sobre a obra escolhida */}
      {editing && editor && (
        <VolumeEditor
          editor={editor}
          title={editing.manga}
          onChanged={() => setRev((r) => r + 1)}
          onClose={() => {
            setEditing(null)
            setRev((r) => r + 1)
          }}
        />
      )}
    </div>
  )
}

// ── Biblioteca inline: lista todas as obras aqui mesmo, com scroll infinito ────

function LibraryGrid({
  mangas,
  onFix,
  rev,
}: {
  mangas: LibraryManga[]
  onFix: (m: LibraryManga) => void
  /** Versão para furar o cache das capas após uma edição. */
  rev: number
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return mangas
    return mangas.filter((m) => m.manga.toLowerCase().includes(q))
  }, [mangas, query])

  // O scroll infinito acompanha o scroll da própria página (sem limite de 100vh).
  const { visible, sentinelRef, hasMore } = useIncremental(filtered, 48)

  return (
    <div className="space-y-4">
      {/* Contagem + busca */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        <div className="flex items-center gap-2">
          <BookOpen
            size={16}
            className="shrink-0 text-violet-300"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-neutral-100">
            {mangas.length} {mangas.length === 1 ? 'obra' : 'obras'} na
            biblioteca
          </span>
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar obra…"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-2 pl-9 pr-9 text-sm placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            aria-label="Buscar obra na biblioteca"
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

      {/* Grade com scroll infinito (na própria página) */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-600">
          Nenhuma obra encontrada para “{query}”.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {visible.map((m) => (
            <MangaTile
              key={m.path}
              manga={m}
              onFix={() => onFix(m)}
              rev={rev}
            />
          ))}
        </div>
      )}
      {hasMore && (
        <div
          ref={sentinelRef}
          className="py-4 text-center font-mono text-[11px] text-neutral-700"
        >
          carregando mais obras…
        </div>
      )}
    </div>
  )
}

// ── Card de uma obra na biblioteca ────────────────────────────────────────────

function MangaTile({
  manga,
  onFix,
  rev,
}: {
  manga: LibraryManga
  onFix: () => void
  rev: number
}) {
  const cover = manga.cover
    ? api.folderPageUrl(
        manga.path,
        manga.cover.volume,
        manga.cover.chapter,
        manga.cover.name,
        rev,
      )
    : null

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60">
      <div
        className={`relative flex aspect-[3/4] items-center justify-center overflow-hidden ${
          cover ? '' : 'bg-gradient-to-br from-neutral-800 to-neutral-950'
        }`}
      >
        {cover ? (
          <img
            src={cover}
            alt={`Capa de ${manga.manga}`}
            className="h-full w-full object-cover"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        ) : (
          <BookOpen size={22} className="text-neutral-600" aria-hidden="true" />
        )}
        <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-black/40" />
      </div>
      <div className="space-y-1 border-t border-neutral-800 px-2.5 py-2">
        <p
          className="truncate text-xs font-semibold text-neutral-100"
          title={manga.manga}
        >
          {manga.manga}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-neutral-500">
          <span className="flex items-center gap-1">
            <Layers size={10} aria-hidden="true" />
            {manga.volumes} {manga.volumes === 1 ? 'vol' : 'vols'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {manga.chapters + manga.loose}{' '}
            {manga.chapters + manga.loose === 1 ? 'cap' : 'caps'}
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={onFix}
        className="flex items-center justify-center gap-1.5 border-t border-neutral-800 bg-neutral-800/40 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
      >
        <Wrench size={12} aria-hidden="true" />
        Ver & Editar
      </button>
    </div>
  )
}
