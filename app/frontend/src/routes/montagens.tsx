import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Layers,
  Trash2,
} from 'lucide-react'
import { api, type MountSummary } from '~/api/client'
import { ConfirmDialog } from '~/components/ConfirmDialog'
import { useAsync } from '~/hooks/useAsync'
import { thumbSrc } from '~/utils/img'

export const Route = createFileRoute('/montagens')({
  component: MontagensPage,
})

/** Formata um ISO-8601 para data/hora curta em pt-BR. */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MontagensPage() {
  const [tick, setTick] = useState(0)
  const { data, error } = useAsync(() => api.listMounts(), [tick])
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: React.ReactNode
    confirmLabel: string
    onConfirm: () => void
  } | null>(null)

  const list = data ?? []

  function remove(m: MountSummary) {
    setConfirmState({
      title: 'Remover montagem?',
      message: (
        <>
          Remove a montagem salva de{' '}
          <span className="font-semibold text-neutral-200">{m.title}</span>. Os
          capítulos já baixados no disco{' '}
          <span className="font-semibold text-neutral-200">NÃO</span> são
          apagados.
        </>
      ),
      confirmLabel: 'Remover',
      onConfirm: async () => {
        setConfirmState(null)
        try {
          await api.removeMount(m.source, m.slug)
        } catch {
          // a lista é atualizada a seguir de qualquer forma
        }
        setTick((t) => t + 1)
      },
    })
  }

  function clearAll() {
    setConfirmState({
      title: 'Limpar todas as montagens?',
      message: (
        <>
          Remove todas as montagens salvas da lista. Os capítulos já baixados no
          disco{' '}
          <span className="font-semibold text-neutral-200">NÃO</span> são
          apagados.
        </>
      ),
      confirmLabel: 'Limpar tudo',
      onConfirm: async () => {
        setConfirmState(null)
        try {
          await api.clearMounts()
        } catch {
          // idem
        }
        setTick((t) => t + 1)
      },
    })
  }

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
          <Layers size={20} className="text-violet-400/80" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">
              Montagens salvas
            </h1>
            <p className="text-xs text-neutral-500">
              {list.length}{' '}
              {list.length === 1 ? 'montagem salva' : 'montagens salvas'} · voltam
              ao reabrir o app
            </p>
          </div>
        </div>
        {list.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-red-900/50 hover:bg-red-950/30 hover:text-red-400"
          >
            <Trash2 size={13} aria-hidden="true" />
            Limpar tudo
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-950/60 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Lista */}
      {list.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-neutral-800 py-16 text-center">
          <Layers
            size={28}
            className="mx-auto mb-3 text-neutral-700"
            aria-hidden="true"
          />
          <p className="text-sm text-neutral-500">
            Nenhuma montagem salva ainda.
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            Ao montar volumes de uma obra, ela é salva aqui automaticamente.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Buscar um mangá
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((m) => (
            <MountCard
              key={`${m.source}-${m.slug}`}
              mount={m}
              onRemove={() => remove(m)}
            />
          ))}
        </div>
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  )
}

function MountCard({
  mount,
  onRemove,
}: {
  mount: MountSummary
  onRemove: () => void
}) {
  const cover = thumbSrc(mount.source, mount.thumbUrl)
  return (
    <div className="flex gap-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
      {/* Capa */}
      {cover ? (
        <img
          src={cover}
          alt={mount.title}
          className="h-28 w-20 shrink-0 rounded-lg object-cover"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      ) : (
        <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-lg bg-neutral-800/60 text-neutral-700">
          <BookOpen size={22} aria-hidden="true" />
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate font-medium text-neutral-100" title={mount.title}>
          {mount.title}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-neutral-500">
          <span className="flex items-center gap-1">
            <Layers size={11} aria-hidden="true" />
            {mount.volumeCount}{' '}
            {mount.volumeCount === 1 ? 'volume' : 'volumes'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {mount.chapterCount}{' '}
            {mount.chapterCount === 1 ? 'capítulo' : 'capítulos'}
          </span>
        </p>
        {mount.updatedAt && (
          <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
            {formatDate(mount.updatedAt)}
          </p>
        )}

        {/* Ações */}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Link
            to="/obra/$source/$slug"
            params={{ source: mount.source, slug: mount.slug }}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-white"
          >
            Continuar montagem
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-red-950/40 hover:text-red-400"
            aria-label={`Remover montagem de ${mount.title}`}
          >
            <Trash2 size={13} aria-hidden="true" />
            Remover
          </button>
        </div>
      </div>
    </div>
  )
}
