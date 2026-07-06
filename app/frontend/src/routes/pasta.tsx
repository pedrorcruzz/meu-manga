// "Consertar da pasta": aponte a pasta-pai de um mangá em qualquer lugar do disco
// (ex.: obra já baixada e movida para um SSD externo) e o app varre os volumes e
// capítulos que existirem ali — sem depender de um download registrado no
// histórico. A partir daí, o mesmo editor "Consertar volumes" reorganiza tudo
// lendo/gravando direto na pasta. A última pasta aberta é persistida no SQLite.

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  FolderSearch,
  HardDrive,
  Layers,
  Loader2,
  Wrench,
} from 'lucide-react'
import { api, type MangaTree } from '~/api/client'
import { VolumeEditor } from '~/components/VolumeEditor'

export const Route = createFileRoute('/pasta')({
  component: PastaPage,
})

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function PastaPage() {
  const [path, setPath] = useState('')
  const [tree, setTree] = useState<MangaTree | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState(false)
  // Bumpa após fechar o editor para re-varrer a pasta (refletir as mudanças).
  const [rev, setRev] = useState(0)

  // Restaura a última pasta aberta (persistida no SQLite).
  useEffect(() => {
    let alive = true
    api
      .getSettings()
      .then((s) => {
        if (alive && s.mangaFolder) setPath(s.mangaFolder)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // (Re)varre a pasta sempre que o caminho muda ou após uma edição.
  useEffect(() => {
    if (!path) {
      setTree(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    api
      .folderTree(path)
      .then((t) => {
        if (alive) setTree(t)
      })
      .catch((e) => {
        if (alive) {
          setError(errMsg(e))
          setTree(null)
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [path, rev])

  async function pick() {
    setPicking(true)
    setError(null)
    try {
      const { path: chosen } = await api.folderPick()
      if (chosen) {
        setPath(chosen)
        api.updateSettings({ mangaFolder: chosen }).catch(() => {})
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setPicking(false)
    }
  }

  const editor = useMemo(() => (path ? api.folderEditor(path) : null), [path])

  const totalChapters = tree
    ? tree.volumes.reduce((s, v) => s + v.chapters.length, 0) +
      tree.loose.length
    : 0
  const empty =
    tree != null && tree.volumes.length === 0 && tree.loose.length === 0

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <HardDrive size={20} className="text-violet-400/80" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">
              Consertar da pasta
            </h1>
            <p className="text-xs text-neutral-500">
              Abra um mangá que já está no seu computador e organize os volumes
              lendo direto da pasta.
            </p>
          </div>
        </div>
      </div>

      {/* Explicação */}
      <div className="flex items-start gap-2.5 rounded-xl border border-sky-900/40 bg-sky-950/20 p-3">
        <FolderSearch
          size={14}
          className="mt-0.5 shrink-0 text-sky-400"
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed text-sky-200/70">
          Escolha a{' '}
          <span className="font-semibold text-sky-200">pasta-pai do mangá</span>{' '}
          (a que tem o nome da obra, ex.:{' '}
          <span className="font-mono">Witch Hat Atelier</span>), com os volumes e
          capítulos dentro. O app varre a pasta e mostra o que encontrar — útil
          quando você já moveu os arquivos para outro lugar (um SSD, por exemplo)
          e o download não confere mais. Nada é re-baixado: só a pasta é lida e
          reorganizada.
        </p>
      </div>

      {/* Seletor de pasta */}
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
          {picking ? 'Abrindo…' : 'Escolher pasta…'}
        </button>
      </div>

      {/* Erro */}
      {error && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-3 font-mono text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Resumo do que foi encontrado */}
      {path && !error && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          {loading ? (
            <div className="flex items-center gap-2 font-mono text-sm text-neutral-500">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              Varrendo a pasta…
            </div>
          ) : empty ? (
            <p className="py-4 text-center text-sm text-neutral-500">
              Nenhum volume ou capítulo encontrado nesta pasta. Confira se você
              apontou a pasta-pai do mangá (a que contém os volumes).
            </p>
          ) : tree ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                <div className="flex items-center gap-2">
                  <BookOpen
                    size={16}
                    className="shrink-0 text-violet-300"
                    aria-hidden="true"
                  />
                  <span className="font-semibold text-neutral-100">
                    {tree.manga}
                  </span>
                </div>
                <span className="flex items-center gap-1.5 font-mono text-xs text-neutral-400">
                  <Layers size={12} aria-hidden="true" />
                  {tree.volumes.length}{' '}
                  {tree.volumes.length === 1 ? 'volume' : 'volumes'}
                </span>
                {tree.loose.length > 0 && (
                  <span className="font-mono text-xs text-neutral-400">
                    {tree.loose.length} solto
                    {tree.loose.length !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="font-mono text-xs text-neutral-500">
                  {totalChapters}{' '}
                  {totalChapters === 1 ? 'capítulo' : 'capítulos'}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
                >
                  <Wrench size={14} aria-hidden="true" />
                  Consertar volumes
                </button>
              </div>

              {/* Prévia dos volumes encontrados */}
              <div className="flex flex-wrap gap-1.5">
                {tree.volumes.map((v) => (
                  <span
                    key={v.folder}
                    className="rounded-md border border-neutral-800 bg-neutral-950/50 px-2 py-1 font-mono text-[11px] text-neutral-400"
                    title={`${v.chapters.length} capítulo${v.chapters.length !== 1 ? 's' : ''}`}
                  >
                    {v.name || v.folder}{' '}
                    <span className="text-neutral-600">
                      ({v.chapters.length})
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Editor "Consertar volumes" sobre a pasta escolhida */}
      {editing && editor && (
        <VolumeEditor
          editor={editor}
          title={tree?.manga || 'Pasta'}
          onClose={() => {
            setEditing(false)
            setRev((r) => r + 1)
          }}
        />
      )}
    </div>
  )
}
