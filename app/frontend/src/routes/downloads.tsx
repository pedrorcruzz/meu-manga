import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Eye,
  FileWarning,
  FolderOpen,
  FolderSearch,
  HardDrive,
  Hourglass,
  Layers,
  Loader2,
  RotateCcw,
  RotateCw,
  Search,
  ShieldCheck,
  Trash2,
  Turtle,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import {
  api,
  NoSessionError,
  type ChapterTask,
  type DownloadRequest,
  type JobStatus,
  type JobSummary,
  type VolumeInput,
} from '~/api/client'
import { useDownloadEvents } from '~/api/events'
import { ConfirmDialog } from '~/components/ConfirmDialog'
import { PageGallery } from '~/components/PageGallery'
import { VolumeEditor } from '~/components/VolumeEditor'
import { useSessionContext } from '~/context/session'
import { useAsync } from '~/hooks/useAsync'
import { useIncremental } from '~/hooks/useIncremental'
import {
  takePendingDownload,
  type PendingDownload,
} from '~/lib/pendingDownload'
import {
  loadVolumeFormat,
  setVolumeFormat,
  useVolumeFormat,
} from '~/lib/volumeFormatStore'
import {
  DIGITS_OPTIONS,
  PREFIX_OPTIONS,
  reformatVolumeName,
  volumeNameExample,
  type VolumeDigits,
  type VolumeNameFormat,
  type VolumePrefix,
} from '~/lib/volumeName'

/** Opções de retry: sem nada = tudo que falta; volume/capítulo restringe.
 *  force = re-baixa mesmo já concluído (arquivos sumiram da pasta). */
type RetryOpts = { volume?: string; chapterId?: string; force?: boolean }

// Progresso live de páginas: jobId → chapterNumber → {page, totalPages}
type ChapterProgress = { page: number; totalPages: number }
type LiveProgress = Record<string, Record<string, ChapterProgress>>
type FilterMode = 'all' | 'active' | 'done'

// Estado de download de um volume pendente, derivado do job que o baixa:
// idle = ainda não baixado · downloading = na fila/baixando · done = concluído ·
// failed = falhou/cancelado (dá para tentar de novo).
type VolumeDlStatus = 'idle' | 'downloading' | 'done' | 'failed'
type VolumeFilter = 'all' | 'idle' | 'downloading' | 'done'

export const Route = createFileRoute('/downloads')({
  component: DownloadsPage,
})

function DownloadsPage() {
  const { refresh: refreshSession } = useSessionContext()

  const [listTick, setListTick] = useState(0)
  const [progressMap, setProgressMap] = useState<LiveProgress>({})
  const [filter, setFilter] = useState<FilterMode>('all')
  // Popup de confirmação da própria interface (substitui window.confirm).
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: React.ReactNode
    confirmLabel: string
    onConfirm: () => void
  } | null>(null)

  // Seleção de volumes vinda da obra, aguardando o usuário escolher o que baixar.
  const [pending, setPending] = useState<PendingDownload | null>(null)
  const [staging, setStaging] = useState(false)
  // Nome do volume → jobId criado para baixá-lo. É daqui que sai o status de cada
  // capa (baixando/baixado): cruzamos o jobId com a lista de jobs. Some junto com
  // a seleção pendente (ambos vivem só nesta sessão da tela).
  const [volumeJobs, setVolumeJobs] = useState<Record<string, string>>({})
  // Formato do nome dos volumes — mesmo store da aba de montagem (persistido no
  // SQLite). Mexer aqui reflete lá e vice-versa; prevalece a última escolha.
  const nameFormat = useVolumeFormat()

  // Consome a seleção pendente uma vez, ao montar a tela, já reaplicando o formato
  // persistido aos nomes dos volumes (mantém a paridade com a aba de montagem).
  useEffect(() => {
    const p = takePendingDownload()
    if (!p || p.volumes.length === 0) return
    void loadVolumeFormat().then((fmt) => {
      setPending({
        ...p,
        volumes: p.volumes.map((v) => ({
          ...v,
          name: reformatVolumeName(v.name, fmt),
        })),
      })
    })
  }, [])

  // Troca o formato (persiste no SQLite e reflete na aba de montagem) e reaplica
  // aos volumes pendentes, preservando o número intrínseco de cada um.
  function changeFormat(fmt: VolumeNameFormat) {
    setVolumeFormat(fmt)
    setPending((prev) =>
      prev
        ? {
            ...prev,
            volumes: prev.volumes.map((v) => ({
              ...v,
              name: reformatVolumeName(v.name, fmt),
            })),
          }
        : prev,
    )
  }

  const { data, error, rawError } = useAsync(() => api.listJobs(), [listTick])

  useDownloadEvents((e) => {
    if (e.type === 'progress' && e.chapterNumber !== undefined) {
      const chapterNumber = e.chapterNumber
      setProgressMap((prev) => ({
        ...prev,
        [e.jobId]: {
          ...prev[e.jobId],
          [chapterNumber]: {
            page: e.page ?? 0,
            totalPages: e.totalPages ?? 0,
          },
        },
      }))
    } else {
      setListTick((t) => t + 1)
    }
  })

  const isSessionError = rawError instanceof NoSessionError

  useEffect(() => {
    if (isSessionError) refreshSession()
  }, [isSessionError, refreshSession])

  const list = data ?? []

  // Status de cada volume pendente a partir do job que o baixou. Sem job = idle
  // (ainda não clicou). Job sumiu da lista mas registramos = ainda entrando na
  // fila, tratamos como "baixando".
  const volumeStatuses = useMemo(() => {
    const m: Record<string, VolumeDlStatus> = {}
    for (const [name, jobId] of Object.entries(volumeJobs)) {
      const job = list.find((j) => j.jobId === jobId)
      if (!job) {
        m[name] = 'downloading'
      } else if (job.status === 'completed') {
        m[name] = 'done'
      } else if (job.status === 'failed' || job.status === 'canceled') {
        m[name] = 'failed'
      } else {
        m[name] = 'downloading'
      }
    }
    return m
  }, [volumeJobs, list])

  async function cancel(id: string) {
    try {
      await api.cancelJob(id)
    } catch (err) {
      if (err instanceof NoSessionError) refreshSession()
    }
    setListTick((t) => t + 1)
  }

  // Refaz capítulos que faltaram NO MESMO job (não cria outro card). Não perde o
  // que já baixou. Sem opts = tudo que faltou; opts.volume = só um volume;
  // opts.chapterId = 1 capítulo.
  async function retry(id: string, opts?: RetryOpts) {
    try {
      await api.retryJob(id, opts)
    } catch (err) {
      if (err instanceof NoSessionError) refreshSession()
    }
    setListTick((t) => t + 1)
  }

  // Remove do histórico. Os arquivos já salvos no disco não são apagados.
  function remove(id: string) {
    setConfirmState({
      title: 'Remover do histórico?',
      message: (
        <>
          Os capítulos já baixados no disco{' '}
          <span className="font-semibold text-neutral-200">NÃO</span> são
          apagados - isto só limpa a entrada aqui da lista.
        </>
      ),
      confirmLabel: 'Remover',
      onConfirm: async () => {
        setConfirmState(null)
        try {
          await api.removeJob(id)
        } catch {
          // ignora: a lista é atualizada a seguir de qualquer forma
        }
        setListTick((t) => t + 1)
      },
    })
  }

  const failedJobs = list.filter((j) => j.status === 'failed')
  // downloads finalizados mas incompletos (faltam capítulos para refazer)
  const incompleteJobs = list.filter(
    (j) =>
      (j.status === 'failed' || j.status === 'canceled') &&
      j.totalChapters - j.completedChapters > 0,
  )
  const activeCount = list.filter(
    (j) => j.status === 'running' || j.status === 'queued',
  ).length
  const finishedCount = list.length - activeCount

  // Limpa de uma vez tudo que já finalizou. Os arquivos no disco não são tocados.
  function clearHistory() {
    setConfirmState({
      title: 'Limpar histórico?',
      message: (
        <>
          Remove as entradas concluídas, falhas e canceladas da lista. Os
          downloads em andamento são mantidos e os arquivos já baixados no disco{' '}
          <span className="font-semibold text-neutral-200">NÃO</span> são
          apagados.
        </>
      ),
      confirmLabel: 'Limpar',
      onConfirm: async () => {
        setConfirmState(null)
        try {
          await api.clearHistory()
        } catch {
          // a lista é atualizada a seguir de qualquer forma
        }
        setListTick((t) => t + 1)
      },
    })
  }

  // Inicia o download dos volumes escolhidos. Um único job (sequencial) por
  // clique - baixar "todos" NÃO dispara vários jobs em paralelo, para não ser
  // agressivo com o site e evitar o bloqueio por "atividade incomum".
  async function startVolumes(vols: VolumeInput[]) {
    if (!pending || vols.length === 0 || staging) return
    setStaging(true)
    const body: DownloadRequest = {
      source: pending.source,
      slug: pending.slug,
      title: pending.title,
      order: pending.order,
      chapters: vols.flatMap((v) => v.chapters),
      volumes: vols,
    }
    try {
      const { jobId } = await api.createJob(body)
      // Não removemos mais o volume da lista: ele fica visível e passa a exibir
      // o estado (baixando → baixado). Associamos cada volume ao job criado.
      setVolumeJobs((prev) => {
        const next = { ...prev }
        for (const v of vols) next[v.name] = jobId
        return next
      })
    } catch (err) {
      if (err instanceof NoSessionError) refreshSession()
    } finally {
      setStaging(false)
      setListTick((t) => t + 1)
    }
  }

  const filteredList = list.filter((job) => {
    if (filter === 'active')
      return job.status === 'running' || job.status === 'queued'
    if (filter === 'done')
      return (
        job.status === 'completed' ||
        job.status === 'failed' ||
        job.status === 'canceled'
      )
    return true
  })

  // Agrupa os jobs pelo mangá pai (source+slug). Cada mangá vira um card só,
  // com seus volumes/downloads aninhados dentro (ver MangaCard).
  const mangaGroups = groupByManga(filteredList)

  const hasPending = pending != null && pending.volumes.length > 0

  // Coluna dos downloads (pasta + lista). Fica sozinha (largura cheia) quando não
  // há volumes para escolher, ou lado a lado com o painel de seleção quando há.
  const downloadsColumn = (
    <div className="flex min-w-0 flex-col gap-5 lg:min-h-0 lg:flex-1">
      {/* Pasta de downloads */}
      <DownloadFolderSection />

      {error ? (
        isSessionError ? (
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/30 px-4 py-3 font-mono text-sm text-amber-300">
            Sessão Cloudflare inválida - resolva o desafio no Navegador (veja o
            aviso acima).
          </div>
        ) : (
          <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-3 font-mono text-sm text-red-400">
            {error}
          </div>
        )
      ) : list.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
          {/* Cabeçalho: contagem e filtros */}
          <DashboardHeader
            total={list.length}
            activeCount={activeCount}
            filter={filter}
            onFilterChange={setFilter}
            canClear={finishedCount > 0}
            onClear={() => void clearHistory()}
          />

          {/* Por que demora: ritmo calmo para não tomar bloqueio */}
          {activeCount > 0 && <PaceNote />}

          {/* Aviso: downloads incompletos que dá para refazer sem perder nada */}
          {incompleteJobs.length > 0 && (
            <IncompleteNotice count={incompleteJobs.length} />
          )}

          {/* Alertas de captcha do leitor */}
          {failedJobs.map((job) => (
            <CaptchaJobAlert
              key={`captcha-${job.jobId}`}
              jobId={job.jobId}
              title={job.title}
              listTick={listTick}
            />
          ))}

          {/* Lista de mangás (cada um agrupa seus volumes) - scroll interno;
              no desktop preenche a coluna, no mobile mantém o teto de 60vh. */}
          <div className="retro-scroll max-h-[60vh] space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1">
            {filteredList.length === 0 ? (
              <div className="py-10 text-center font-mono text-sm text-neutral-600">
                Nenhum download nesta categoria.
              </div>
            ) : (
              mangaGroups.map((g) =>
                g.jobs.length === 1 ? (
                  // Mangá com um único download: mostra o card direto, sem aninhar.
                  <JobCard
                    key={g.jobs[0].jobId}
                    job={g.jobs[0]}
                    jobProgress={progressMap[g.jobs[0].jobId] ?? {}}
                    listTick={listTick}
                    onCancel={() => void cancel(g.jobs[0].jobId)}
                    onRetry={(opts) => void retry(g.jobs[0].jobId, opts)}
                    onRemove={() => remove(g.jobs[0].jobId)}
                  />
                ) : (
                  <MangaCard
                    key={g.key}
                    group={g}
                    progressMap={progressMap}
                    listTick={listTick}
                    onCancel={(id) => void cancel(id)}
                    onRetry={(id, opts) => void retry(id, opts)}
                    onRemove={remove}
                  />
                ),
              )
            )}
          </div>
        </div>
      )}
    </div>
  )

  return (
    // Com volumes pendentes, abrimos a página em tela cheia (full-bleed) e a
    // recentramos em max-w-7xl para o layout 50/50 não ficar estreito. Sem eles,
    // a página segue na largura padrão (max-w-5xl do <main>).
    <div
      className={
        hasPending
          ? 'relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6'
          : ''
      }
    >
      <div
        className={`mx-auto flex flex-col gap-4 lg:h-[calc(100dvh-10.5rem)] lg:min-h-0 ${hasPending ? 'max-w-7xl' : ''}`}
      >
        {/* Navegação de volta */}
        <Link
          to="/"
          className="flex w-fit shrink-0 items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-200"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Voltar
        </Link>

        {hasPending ? (
          <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:items-stretch">
            {/* Esquerda: seleção de volumes recém-montados */}
            <PendingVolumesPanel
              pending={pending}
              busy={staging}
              statuses={volumeStatuses}
              nameFormat={nameFormat}
              onChangeFormat={changeFormat}
              onDownloadVolume={(v) => void startVolumes([v])}
              onDownloadAll={() =>
                void startVolumes(
                  pending.volumes.filter(
                    (v) => volumeStatuses[v.name] !== 'done',
                  ),
                )
              }
              onDiscard={() => setPending(null)}
            />
            {/* Direita: downloads */}
            {downloadsColumn}
          </div>
        ) : (
          downloadsColumn
        )}

        {/* Popup de confirmação da nossa interface (sem alert do browser) */}
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
    </div>
  )
}

// ── Estado vazio ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-neutral-800/50 bg-neutral-900/30 py-20 text-center">
      <Clock size={28} className="text-neutral-700" aria-hidden="true" />
      <div className="space-y-1.5">
        <p className="font-mono text-sm text-neutral-500">
          Nenhum download ainda.
        </p>
        <p className="font-mono text-xs text-neutral-700">
          Busque um mangá e escolha capítulos para começar.
        </p>
      </div>
    </div>
  )
}

// ── Seleção de volumes a baixar (vinda da obra) ───────────────────────────────

/** Faixa "Cap. X - Y" a partir de capítulos com campo `number`. */
function numberRange(chs: { number: string }[]): string {
  if (chs.length === 0) return '-'
  const nums = chs.map((c) => c.number).sort((a, b) => parseFloat(a) - parseFloat(b))
  const first = nums[0]
  const last = nums[nums.length - 1]
  return first === last ? `Cap. ${first}` : `Cap. ${first} - ${last}`
}

function PendingVolumesPanel({
  pending,
  busy,
  statuses,
  nameFormat,
  onChangeFormat,
  onDownloadVolume,
  onDownloadAll,
  onDiscard,
}: {
  pending: PendingDownload
  busy: boolean
  statuses: Record<string, VolumeDlStatus>
  nameFormat: VolumeNameFormat
  onChangeFormat: (fmt: VolumeNameFormat) => void
  onDownloadVolume: (v: VolumeInput) => void
  onDownloadAll: () => void
  onDiscard: () => void
}) {
  const totalChapters = pending.volumes.reduce(
    (s, v) => s + v.chapters.length,
    0,
  )

  // Aba ativa: "safe" (padrão, 1 volume por vez) x "all" (tudo de uma vez).
  const [tab, setTab] = useState<'safe' | 'all'>('safe')

  // Filtro por estado de download (todos/não baixados/baixando/baixados).
  const [statusFilter, setStatusFilter] = useState<VolumeFilter>('all')
  const statusOf = (v: VolumeInput): VolumeDlStatus => statuses[v.name] ?? 'idle'

  // Contagens por estado, para os chips de filtro.
  const counts = useMemo(() => {
    const c = { all: pending.volumes.length, idle: 0, downloading: 0, done: 0 }
    for (const v of pending.volumes) {
      const s = statuses[v.name] ?? 'idle'
      // "failed" volta a contar como não baixado (dá para tentar de novo).
      if (s === 'downloading') c.downloading++
      else if (s === 'done') c.done++
      else c.idle++
    }
    return c
  }, [pending.volumes, statuses])

  // Busca por volume (nome ou número de capítulo).
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pending.volumes.filter((v) => {
      if (q) {
        const hit =
          v.name.toLowerCase().includes(q) ||
          v.chapters.some((c) => c.number.toLowerCase().includes(q))
        if (!hit) return false
      }
      if (statusFilter === 'all') return true
      const s = statuses[v.name] ?? 'idle'
      if (statusFilter === 'done') return s === 'done'
      if (statusFilter === 'downloading') return s === 'downloading'
      // "não baixados": idle + failed
      return s === 'idle' || s === 'failed'
    })
  }, [pending.volumes, query, statusFilter, statuses])

  // Renderiza as capas em lotes (scroll infinito) para aguentar coleções grandes.
  const { visible, sentinelRef, hasMore } = useIncremental(filtered, 48)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-violet-800/40 bg-violet-950/20 p-4 lg:h-full lg:min-h-0">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3">
        <Layers size={16} className="text-violet-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-100">
            Volumes prontos para baixar
          </p>
          <p className="truncate text-xs text-neutral-400">
            {pending.title} · {pending.volumes.length}{' '}
            {pending.volumes.length === 1 ? 'volume' : 'volumes'} ·{' '}
            {totalChapters} cap.
          </p>
        </div>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="ml-auto rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-50"
        >
          Descartar
        </button>
      </div>

      {/* Formato do nome dos volumes (mesma escolha da aba de montagem) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
          Formato do nome
        </span>
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          Prefixo
          <select
            value={nameFormat.prefix}
            onChange={(e) =>
              onChangeFormat({
                ...nameFormat,
                prefix: e.target.value as VolumePrefix,
              })
            }
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 focus:border-neutral-500 focus:outline-none"
            aria-label="Prefixo do nome do volume"
          >
            {PREFIX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          Números
          <select
            value={nameFormat.digits}
            onChange={(e) =>
              onChangeFormat({
                ...nameFormat,
                digits: Number(e.target.value) as VolumeDigits,
              })
            }
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 focus:border-neutral-500 focus:outline-none"
            aria-label="Forma dos números do volume"
          >
            {DIGITS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-xs text-neutral-500">
          ex.:
          <span className="rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-neutral-200">
            {volumeNameExample(nameFormat)}
          </span>
        </span>
      </div>

      {/* Abas: baixar seguro (padrão) x tudo de uma vez */}
      <div className="flex w-fit gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 p-1">
        <button
          type="button"
          onClick={() => setTab('safe')}
          aria-pressed={tab === 'safe'}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === 'safe'
              ? 'bg-emerald-600 text-white'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <ShieldCheck size={13} aria-hidden="true" />
          Baixar de forma segura
        </button>
        <button
          type="button"
          onClick={() => setTab('all')}
          aria-pressed={tab === 'all'}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === 'all'
              ? 'bg-amber-600 text-white'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Zap size={13} aria-hidden="true" />
          Baixar tudo de uma vez
        </button>
      </div>

      {/* Explicação + ação da aba ativa */}
      {tab === 'safe' ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3 text-xs leading-relaxed text-emerald-200/80">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold text-emerald-200">Recomendado.</span>{' '}
            Escolha um volume abaixo e baixe{' '}
            <span className="font-semibold text-emerald-100">um por vez</span>. Quando
            ele terminar, espere{' '}
            <span className="font-semibold text-emerald-100">15–20 min</span> antes de
            baixar o próximo — assim o site não detecta “atividade incomum” e não te
            bloqueia. Você escolhe a ordem; o que não baixar agora fica aqui.
          </span>
        </p>
      ) : (
        <div className="space-y-2.5 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-200/80">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Enfileira{' '}
              <span className="font-semibold text-amber-100">
                todos os {pending.volumes.length} volumes
              </span>{' '}
              de uma vez. Baixamos um capítulo por vez com pausas, mas em coleções
              grandes o site pode disparar o bloqueio por “atividade incomum”. Se
              acontecer, o download{' '}
              <span className="font-semibold text-amber-100">não para</span>: aguarda a
              liberação e continua sozinho — só demora mais.
            </span>
          </p>
          <button
            type="button"
            onClick={onDownloadAll}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={14} aria-hidden="true" />
            )}
            Baixar todos os {pending.volumes.length} volumes
          </button>
        </div>
      )}

      {/* Busca por volume */}
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
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-2 pl-9 pr-9 text-sm placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          aria-label="Buscar volumes para baixar"
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

      {/* Filtro por estado de download */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { key: 'all', label: 'Todos', count: counts.all },
            { key: 'idle', label: 'Não baixados', count: counts.idle },
            { key: 'downloading', label: 'Baixando', count: counts.downloading },
            { key: 'done', label: 'Baixados', count: counts.done },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            aria-pressed={statusFilter === f.key}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              statusFilter === f.key
                ? 'border-violet-500 bg-violet-600/30 text-violet-100'
                : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {f.label}
            <span
              className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                statusFilter === f.key
                  ? 'bg-violet-500/40 text-violet-50'
                  : 'bg-neutral-800 text-neutral-500'
              }`}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {/* Grade de volumes (rolagem interna para não esticar a página).
          No desktop preenche a coluna; no mobile mantém o teto de 38rem. */}
      <div className="max-h-[38rem] overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin] lg:max-h-none lg:min-h-0 lg:flex-1">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-600">
            {query
              ? `Nenhum volume encontrado para “${query}”.`
              : statusFilter === 'done'
                ? 'Nenhum volume baixado ainda.'
                : statusFilter === 'downloading'
                  ? 'Nenhum volume baixando agora.'
                  : statusFilter === 'idle'
                    ? 'Todos os volumes já foram baixados.'
                    : 'Nenhum volume.'}
          </p>
        ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visible.map((v) => {
          const s = statusOf(v)
          const done = s === 'done'
          const downloading = s === 'downloading'
          return (
          <div
            key={v.name}
            className={`flex flex-col overflow-hidden rounded-xl border bg-neutral-900/60 transition-colors ${
              done
                ? 'border-emerald-500/70 ring-1 ring-emerald-500/40'
                : downloading
                  ? 'border-sky-600/60'
                  : 'border-neutral-800'
            }`}
          >
            <div
              className={`relative flex aspect-[3/4] items-center justify-center overflow-hidden ${
                v.coverImage
                  ? ''
                  : 'bg-gradient-to-br from-neutral-800 to-neutral-950'
              }`}
            >
              {v.coverImage ? (
                <img
                  src={v.coverImage}
                  alt={`Capa de ${v.name}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1.5 px-2 text-center">
                  <BookOpen
                    size={20}
                    className={done ? 'text-emerald-400' : 'text-neutral-600'}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-sm font-bold text-neutral-300">
                    {v.name}
                  </span>
                </div>
              )}
              <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-black/40" />
              {/* Selo de estado sobre a capa */}
              {done && (
                <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                  <CheckCircle2 size={11} aria-hidden="true" />
                  Baixado
                </span>
              )}
              {downloading && (
                <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                  <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                  Baixando
                </span>
              )}
            </div>
            <div className="space-y-0.5 border-t border-neutral-800 px-2.5 py-2">
              <p className="truncate font-mono text-xs font-bold text-neutral-100">
                {v.name}
              </p>
              <p className="truncate text-[11px] text-neutral-400">
                {numberRange(v.chapters)}
              </p>
              <p className="text-[10px] text-neutral-600">
                {v.chapters.length}{' '}
                {v.chapters.length === 1 ? 'capítulo' : 'capítulos'}
              </p>
            </div>
            {done ? (
              <div className="flex items-center justify-center gap-1.5 border-t border-emerald-500/40 bg-emerald-600/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300">
                <CheckCircle2 size={12} aria-hidden="true" />
                Baixado
              </div>
            ) : downloading ? (
              <div className="flex items-center justify-center gap-1.5 border-t border-sky-600/40 bg-sky-600/15 px-2.5 py-1.5 text-xs font-semibold text-sky-300">
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                Baixando…
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onDownloadVolume(v)}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 border-t border-neutral-800 bg-neutral-800/40 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {s === 'failed' ? (
                  <>
                    <RotateCw size={12} aria-hidden="true" />
                    Baixar de novo
                  </>
                ) : (
                  <>
                    <Download size={12} aria-hidden="true" />
                    Baixar
                  </>
                )}
              </button>
            )}
          </div>
          )
          })}
        </div>
        )}
        {hasMore && (
          <div
            ref={sentinelRef}
            className="py-3 text-center text-[11px] text-neutral-700"
          >
            carregando mais volumes…
          </div>
        )}
      </div>
    </div>
  )
}

// ── Aviso de ritmo calmo (por que demora) ─────────────────────────────────────

function PaceNote() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-sky-900/40 bg-sky-950/20 p-3">
      <Turtle
        size={14}
        className="mt-0.5 shrink-0 text-sky-400"
        aria-hidden="true"
      />
      <p className="text-xs leading-relaxed text-sky-200/70">
        <span className="font-semibold text-sky-200">
          Baixando com calma, de propósito.
        </span>{' '}
        Vamos um capítulo por vez, com pausas, para não disparar o bloqueio do
        site ("atividade incomum na rede"). Pode demorar mais que o normal, mas
        assim é bem mais seguro - e se o site bloquear mesmo assim, o download{' '}
        <span className="font-semibold text-sky-200">
          espera e retoma sozinho
        </span>{' '}
        de onde parou, sem perder nada.
      </p>
    </div>
  )
}

// ── Aviso de downloads incompletos ────────────────────────────────────────────

function IncompleteNotice({ count }: { count: number }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-700/30 bg-amber-950/20 p-4">
      <RotateCcw
        size={14}
        className="mt-0.5 shrink-0 text-amber-400"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="font-mono text-xs font-semibold uppercase tracking-wide text-amber-300">
          {count} download{count !== 1 ? 's' : ''} incompleto
          {count !== 1 ? 's' : ''}
        </p>
        <p className="text-xs leading-relaxed text-amber-200/70">
          Alguns capítulos não terminaram (bloqueio do site, sessão ou rede). O
          que já baixou está salvo no disco. Use{' '}
          <span className="font-semibold">Refazer o que faltou</span> no card
          para baixar só os capítulos restantes - sem repetir os concluídos.
        </p>
      </div>
    </div>
  )
}

// ── Cabeçalho do dashboard (contagem + filtros) ───────────────────────────────

const FILTER_LABELS: Record<FilterMode, string> = {
  all: 'Todos',
  active: 'Ativos',
  done: 'Histórico',
}

function DashboardHeader({
  total,
  activeCount,
  filter,
  onFilterChange,
  canClear,
  onClear,
}: {
  total: number
  activeCount: number
  filter: FilterMode
  onFilterChange: (f: FilterMode) => void
  canClear: boolean
  onClear: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-600">
          downloads
        </span>
        <span className="font-mono text-xs text-neutral-700">({total})</span>
        {activeCount > 0 && (
          <span className="flex items-center gap-1 rounded border border-sky-900/60 bg-sky-950/40 px-1.5 py-0.5 font-mono text-[10px] text-sky-400">
            <Loader2 size={9} className="animate-spin" aria-hidden="true" />
            {activeCount} ativo{activeCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {canClear && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 rounded-lg border border-neutral-800 px-2.5 py-1 font-mono text-xs text-neutral-500 transition-colors hover:border-neutral-700 hover:text-neutral-300"
          >
            <Trash2 size={11} aria-hidden="true" />
            Limpar histórico
          </button>
        )}
        <div className="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/60 p-0.5">
          {(['all', 'active', 'done'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onFilterChange(mode)}
              className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                filter === mode
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {FILTER_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Seletor de pasta de downloads ─────────────────────────────────────────────

function DownloadFolderSection() {
  const { data, loading, reload } = useAsync(() => api.getSettings(), [])
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  async function handlePickFolder() {
    setPicking(true)
    setPickError(null)
    try {
      await api.pickFolder()
      reload()
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FolderOpen size={13} className="text-neutral-600" aria-hidden="true" />
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-neutral-500">
          Pasta de downloads
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 font-mono text-xs text-neutral-600">
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          <span>Carregando…</span>
        </div>
      ) : (
        <div className="flex gap-2">
          <p className="min-w-0 flex-1 truncate rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 font-mono text-xs text-neutral-300">
            {data?.downloadDir || '(não definida)'}
          </p>
          <button
            type="button"
            onClick={() => void handlePickFolder()}
            disabled={picking}
            className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-xs transition-colors hover:bg-neutral-700 disabled:opacity-50"
          >
            {picking ? 'Abrindo…' : 'Escolher…'}
          </button>
        </div>
      )}

      {pickError && (
        <p className="mt-2 font-mono text-xs text-red-400">{pickError}</p>
      )}
      <p className="mt-2 font-mono text-[10px] text-neutral-700">
        Padrão: pasta Downloads do sistema. É também sua biblioteca em{' '}
        <Link
          to="/pasta"
          className="underline underline-offset-2 transition-colors hover:text-neutral-400"
        >
          Meus Mangas
        </Link>
        .
      </p>
    </div>
  )
}

// ── Alerta de captcha do leitor ───────────────────────────────────────────────

function CaptchaJobAlert({
  jobId,
  title,
  listTick,
}: {
  jobId: string
  title: string
  listTick: number
}) {
  const { data } = useAsync(() => api.getJob(jobId), [jobId, listTick])
  if (!data) return null

  const captchaTasks = data.tasks.filter(
    (t) =>
      t.status === 'failed' &&
      typeof t.error === 'string' &&
      t.error.startsWith('captcha do leitor'),
  )
  if (captchaTasks.length === 0) return null

  return (
    <div className="space-y-3 rounded-xl border border-amber-700/30 bg-amber-950/20 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          size={14}
          className="mt-0.5 shrink-0 text-amber-400"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-amber-300">
            Captcha do leitor - {title}
          </p>
          <p className="text-xs leading-relaxed text-amber-200/70">
            O leitor de mangá tem seu próprio anti-bot. Para resolver, abra{' '}
            <span className="font-semibold text-amber-200">
              qualquer capítulo de qualquer mangá
            </span>{' '}
            no Navegador (pode ser um dos links abaixo), passe pelo captcha e{' '}
            <span className="font-semibold text-amber-200">volte aqui</span>.
            Depois é só usar{' '}
            <span className="font-semibold text-amber-200">
              Refazer o que faltou
            </span>{' '}
            no card - ele repega todos os capítulos que deram erro.
          </p>
        </div>
      </div>
      <ul className="space-y-1 pl-6">
        {captchaTasks.map((task) => (
          <li key={task.chapter.id} className="font-mono text-xs text-amber-300">
            <a
              href={task.chapter.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-amber-100"
            >
              Cap. {task.chapter.number}
            </a>
            {task.chapter.title &&
              task.chapter.title !== task.chapter.number && (
                <span className="text-amber-400/60">
                  {' '}- {task.chapter.title}
                </span>
              )}
            <span className="ml-1 text-amber-500/50">(abrir e resolver)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Ícone de status ───────────────────────────────────────────────────────────

function StatusIcon({
  status,
  size = 15,
}: {
  status: JobStatus
  size?: number
}) {
  if (status === 'running')
    return (
      <Loader2
        size={size}
        className="shrink-0 animate-spin text-sky-400"
        aria-label="Em andamento"
      />
    )
  if (status === 'completed')
    return (
      <CheckCircle2
        size={size}
        className="shrink-0 text-emerald-400"
        aria-label="Concluído"
      />
    )
  if (status === 'failed')
    return (
      <XCircle
        size={size}
        className="shrink-0 text-red-400"
        aria-label="Falhou"
      />
    )
  if (status === 'canceled')
    return (
      <XCircle
        size={size}
        className="shrink-0 text-neutral-600"
        aria-label="Cancelado"
      />
    )
  return (
    <Clock
      size={size}
      className="shrink-0 text-neutral-500"
      aria-label="Na fila"
    />
  )
}

// ── Helpers de cor e rótulo ───────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  running: 'Baixando',
  completed: 'Concluído',
  failed: 'Falhou',
  canceled: 'Cancelado',
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'text-neutral-500',
  running: 'text-sky-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  canceled: 'text-neutral-600',
}

function jobBarClass(status: JobStatus): string {
  if (status === 'running') return 'bar-shimmer'
  if (status === 'completed') return 'bg-emerald-500'
  if (status === 'failed') return 'bg-red-500/80'
  return 'bg-neutral-700'
}

// ── MangaCard (agrupa os downloads de um mesmo mangá pai) ─────────────────────

/** Grupo de jobs (downloads/volumes) de um mesmo mangá pai. */
interface MangaGroup {
  /** Chave estável do mangá: source + slug (ou título como fallback). */
  key: string
  source: string
  title: string
  jobs: JobSummary[]
  /** Somatório de capítulos de todos os downloads do mangá. */
  totalChapters: number
  completedChapters: number
  /** Downloads em andamento/fila neste mangá. */
  activeCount: number
}

/** Agrupa os jobs pelo mangá pai (source+slug) preservando a ordem de aparição. */
function groupByManga(jobs: JobSummary[]): MangaGroup[] {
  const groups: MangaGroup[] = []
  const byKey = new Map<string, MangaGroup>()
  for (const job of jobs) {
    const key = `${job.source}::${job.slug || job.title}`
    let g = byKey.get(key)
    if (!g) {
      g = {
        key,
        source: job.source,
        title: job.title,
        jobs: [],
        totalChapters: 0,
        completedChapters: 0,
        activeCount: 0,
      }
      byKey.set(key, g)
      groups.push(g)
    }
    g.jobs.push(job)
    g.totalChapters += job.totalChapters
    g.completedChapters += job.completedChapters
    if (job.status === 'running' || job.status === 'queued') g.activeCount++
  }
  return groups
}

function MangaCard({
  group,
  progressMap,
  listTick,
  onCancel,
  onRetry,
  onRemove,
}: {
  group: MangaGroup
  progressMap: LiveProgress
  listTick: number
  onCancel: (id: string) => void
  onRetry: (id: string, opts?: RetryOpts) => void
  onRemove: (id: string) => void
}) {
  // Abre por padrão quando há download em andamento no mangá.
  const [expanded, setExpanded] = useState(group.activeCount > 0)
  // Scroll infinito dos volumes: revela os downloads em lotes.
  const { visible, sentinelRef, hasMore } = useIncremental(group.jobs, 8)

  const pct =
    group.totalChapters > 0
      ? (group.completedChapters / group.totalChapters) * 100
      : 0
  // Status agregado só para colorir a barra do mangá.
  const status: JobStatus =
    group.activeCount > 0
      ? 'running'
      : group.completedChapters >= group.totalChapters
        ? 'completed'
        : 'failed'
  const volumeCount = group.jobs.length

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40">
      {/* Cabeçalho do mangá - clicável para expandir os downloads */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
        aria-controls={`manga-jobs-${group.key}`}
      >
        <BookOpen
          size={16}
          className="shrink-0 text-violet-300"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-sm font-semibold leading-snug text-neutral-100">
            {group.title}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-neutral-400">
              {volumeCount} download{volumeCount !== 1 ? 's' : ''}
            </span>
            <span
              className="font-mono text-[11px] text-neutral-700"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="font-mono text-[11px] text-neutral-500">
              {group.completedChapters}/{group.totalChapters} cap.
            </span>
            {group.activeCount > 0 && (
              <span className="flex items-center gap-1 rounded border border-sky-900/60 bg-sky-950/40 px-1.5 py-0.5 font-mono text-[10px] text-sky-400">
                <Loader2 size={9} className="animate-spin" aria-hidden="true" />
                {group.activeCount} ativo{group.activeCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Barra de progresso agregada (sm e acima) */}
        <div className="hidden w-28 shrink-0 sm:block">
          <div
            className="h-1 overflow-hidden rounded-full bg-neutral-800"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progresso de ${group.title}: ${Math.round(pct)}%`}
          >
            <div
              className={`h-full transition-all duration-500 ${jobBarClass(status)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-0.5 text-right font-mono text-[10px] text-neutral-600">
            {Math.round(pct)}%
          </p>
        </div>

        <span className="shrink-0 text-neutral-600" aria-hidden="true">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Downloads do mangá (volumes), com scroll infinito */}
      {expanded && (
        <div
          id={`manga-jobs-${group.key}`}
          className="space-y-2 border-t border-neutral-800/60 px-2 py-2 sm:px-3"
        >
          {visible.map((job) => (
            <JobCard
              key={job.jobId}
              job={job}
              jobProgress={progressMap[job.jobId] ?? {}}
              listTick={listTick}
              onCancel={() => onCancel(job.jobId)}
              onRetry={(opts) => onRetry(job.jobId, opts)}
              onRemove={() => onRemove(job.jobId)}
            />
          ))}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="py-2 text-center font-mono text-[10px] text-neutral-700"
            >
              carregando mais volumes…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── JobCard (colapsável) ──────────────────────────────────────────────────────

interface JobCardProps {
  job: JobSummary
  jobProgress: Record<string, ChapterProgress>
  listTick: number
  onCancel: () => void
  onRetry: (opts?: RetryOpts) => void
  onRemove: () => void
}

/** Grupo de capítulos de um mesmo volume dentro de um job. */
interface VolumeGroup {
  /** Nome do volume ("" no modo simples/sem volume). */
  volume: string
  tasks: ChapterTask[]
  /** Índice de cada task no array original (para a galeria de páginas). */
  indices: number[]
  /** Capítulos não concluídos neste volume (fila/falho/cancelado). */
  missing: number
}

/** Agrupa as tasks por volume preservando a ordem de aparição. */
function groupByVolume(tasks: ChapterTask[]): VolumeGroup[] {
  const groups: VolumeGroup[] = []
  const byName = new Map<string, VolumeGroup>()
  tasks.forEach((task, idx) => {
    const vol = task.volume ?? ''
    let g = byName.get(vol)
    if (!g) {
      g = { volume: vol, tasks: [], indices: [], missing: 0 }
      byName.set(vol, g)
      groups.push(g)
    }
    g.tasks.push(task)
    g.indices.push(idx)
    if (task.status !== 'completed') g.missing++
  })
  return groups
}

/** Faixa "Cap. X - Y" de uma lista de tasks. */
function taskRange(tasks: ChapterTask[]): string {
  if (tasks.length === 0) return '-'
  const nums = tasks
    .map((t) => t.chapter.number)
    .sort((a, b) => parseFloat(a) - parseFloat(b))
  const first = nums[0]
  const last = nums[nums.length - 1]
  return first === last ? `Cap. ${first}` : `Cap. ${first} - ${last}`
}

function JobCard({
  job,
  jobProgress,
  listTick,
  onCancel,
  onRetry,
  onRemove,
}: JobCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { block } = useSessionContext()
  // Adaptador estável do editor "Consertar volumes" para este download.
  const jobEditor = useMemo(() => api.jobEditor(job.jobId), [job.jobId])

  const { data: detail } = useAsync(
    () => api.getJob(job.jobId),
    [job.jobId, listTick],
  )

  const pct =
    job.totalChapters > 0
      ? (job.completedChapters / job.totalChapters) * 100
      : 0
  const active = job.status === 'running' || job.status === 'queued'
  const missing = job.totalChapters - job.completedChapters
  const canRetry = !active && missing > 0
  // Bloqueio do site ativo + job rodando = está pausado esperando a liberação.
  const waiting = !!block?.active && job.status === 'running'
  const blockUntil = block?.rawTime || ''

  // Verificação na pasta real: chapterId → {pages, onDisk}. null = ainda não conferido.
  const [diskMap, setDiskMap] = useState<Record<
    string,
    { pages: number; onDisk: boolean }
  > | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [diskRoot, setDiskRoot] = useState('')
  // Editor "Consertar volumes" (folder-first, lê/edita a pasta em disco).
  const [showEditor, setShowEditor] = useState(false)

  async function verifyDisk() {
    setVerifying(true)
    try {
      const res = await api.verifyJob(job.jobId)
      const map: Record<string, { pages: number; onDisk: boolean }> = {}
      for (const t of res.tasks)
        map[t.chapterId] = { pages: t.pages, onDisk: t.onDisk }
      setDiskMap(map)
      setDiskRoot(res.root)
    } catch {
      // silencioso: sem verificação, a UI só não mostra os selos de disco
    } finally {
      setVerifying(false)
    }
  }

  // Nº de capítulos concluídos no histórico que sumiram da pasta real.
  const missingOnDisk = detail
    ? detail.tasks.filter(
        (t) =>
          t.status === 'completed' &&
          diskMap != null &&
          diskMap[t.chapter.id] &&
          !diskMap[t.chapter.id].onDisk,
      ).length
    : 0

  const cardBorderClass =
    job.status === 'running'
      ? 'border-sky-900/50'
      : job.status === 'completed'
        ? 'border-emerald-900/40'
        : job.status === 'failed'
          ? 'border-red-900/40'
          : 'border-neutral-800'

  const cardGlowClass =
    job.status === 'running'
      ? 'shadow-[0_0_18px_rgba(14,165,233,0.07)]'
      : ''

  return (
    <div
      className={`rounded-xl border bg-neutral-900/60 transition-shadow ${cardBorderClass} ${cardGlowClass}`}
    >
      {/* Cabeçalho - sempre visível, clicável para expandir */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
        aria-controls={`job-tasks-${job.jobId}`}
      >
        <div className="mt-px shrink-0">
          <StatusIcon status={job.status} size={15} />
        </div>

        {/* Título e metadados */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-sm font-medium leading-snug text-neutral-100">
            {job.title}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`font-mono text-[11px] ${STATUS_COLOR[job.status] ?? 'text-neutral-500'}`}
            >
              {STATUS_LABEL[job.status] ?? job.status}
            </span>
            <span
              className="font-mono text-[11px] text-neutral-700"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="font-mono text-[11px] text-neutral-500">
              {job.completedChapters}/{job.totalChapters} cap.
            </span>
            {waiting && (
              <span className="flex items-center gap-1 rounded border border-rose-900/60 bg-rose-950/40 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                <Hourglass size={9} aria-hidden="true" />
                aguardando liberação{blockUntil ? ` até ${blockUntil}` : ''} -
                retoma sozinho
              </span>
            )}
            {canRetry && (
              <>
                <span
                  className="font-mono text-[11px] text-neutral-700"
                  aria-hidden="true"
                >
                  ·
                </span>
                <span className="font-mono text-[11px] text-amber-400/90">
                  faltam {missing}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Barra de progresso inline (sm e acima) */}
        <div className="hidden w-28 shrink-0 sm:block">
          <div
            className="h-1 overflow-hidden rounded-full bg-neutral-800"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progresso: ${Math.round(pct)}%`}
          >
            <div
              className={`h-full transition-all duration-500 ${jobBarClass(job.status)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-0.5 text-right font-mono text-[10px] text-neutral-600">
            {Math.round(pct)}%
          </p>
        </div>

        {/* Ações - stop propagation para não colapsar ao clicar */}
        <div
          className="flex shrink-0 items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
          role="none"
        >
          {active ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label={`Cancelar ${job.title}`}
              className="flex items-center gap-1 rounded border border-red-900/60 px-2 py-1 font-mono text-[11px] text-red-400 transition-colors hover:bg-red-950/40"
            >
              <X size={11} aria-hidden="true" />
              Cancelar
            </button>
          ) : (
            <>
              {canRetry && (
                <button
                  type="button"
                  onClick={() => onRetry()}
                  aria-label={`Refazer os capítulos que faltaram de ${job.title}`}
                  className="flex items-center gap-1 rounded border border-amber-800/60 px-2 py-1 font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-950/40"
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  Refazer o que faltou
                </button>
              )}
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remover ${job.title} do histórico`}
                className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 font-mono text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800"
              >
                <Trash2 size={11} aria-hidden="true" />
                Remover
              </button>
            </>
          )}
          <span className="text-neutral-600" aria-hidden="true">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </button>

      {/* Barra de progresso geral (mobile - abaixo do cabeçalho) */}
      <div className="px-4 pb-3 sm:hidden">
        <div
          className="h-1 overflow-hidden rounded-full bg-neutral-800"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full transition-all duration-500 ${jobBarClass(job.status)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Área expandida: capítulos, agrupados por volume */}
      {expanded && (
        <div
          id={`job-tasks-${job.jobId}`}
          className="border-t border-neutral-800/60 px-4 py-3"
        >
          {/* Conferir na pasta real (o histórico pode dizer baixado à toa) */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void verifyDisk()}
              disabled={verifying}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-2.5 py-1 font-mono text-[11px] text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-50"
              title="Confere se os arquivos estão mesmo na pasta de download"
            >
              {verifying ? (
                <Loader2 size={11} className="animate-spin" aria-hidden="true" />
              ) : (
                <FolderSearch size={11} aria-hidden="true" />
              )}
              {verifying ? 'Conferindo…' : 'Conferir na pasta'}
            </button>
            {diskMap != null &&
              (missingOnDisk > 0 ? (
                <span className="flex items-center gap-1 font-mono text-[11px] text-red-400">
                  <FileWarning size={11} aria-hidden="true" />
                  {missingOnDisk} capítulo{missingOnDisk !== 1 ? 's' : ''} fora da
                  pasta
                </span>
              ) : (
                <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400/90">
                  <HardDrive size={11} aria-hidden="true" />
                  tudo confere na pasta
                </span>
              ))}
            {diskRoot && (
              <span
                className="max-w-full truncate font-mono text-[10px] text-neutral-600"
                title={diskRoot}
              >
                {diskRoot}
              </span>
            )}
            {!active && job.completedChapters > 0 && (
              <button
                type="button"
                onClick={() => setShowEditor(true)}
                className="ml-auto flex items-center gap-1.5 rounded-lg border border-neutral-700 px-2.5 py-1 font-mono text-[11px] text-neutral-300 transition-colors hover:bg-neutral-800"
                title="Reorganizar os volumes na pasta em disco (mover capítulos, capa, corrigir número) sem re-baixar"
              >
                <Wrench size={11} aria-hidden="true" />
                Consertar volumes
              </button>
            )}
          </div>
          {showEditor && (
            <VolumeEditor
              editor={jobEditor}
              title={job.title}
              onClose={() => setShowEditor(false)}
            />
          )}
          {detail ? (
            detail.tasks.length > 0 ? (
              (() => {
                const groups = groupByVolume(detail.tasks)
                // Só mostra cabeçalhos de volume quando há volumes de verdade.
                const hasVolumes = groups.some((g) => g.volume !== '')
                if (!hasVolumes) {
                  return (
                    <div className="space-y-2">
                      {detail.tasks.map((task, idx) => (
                        <TaskRow
                          key={task.chapter.id}
                          task={task}
                          taskIndex={idx}
                          jobId={job.jobId}
                          liveProgress={jobProgress[task.chapter.number]}
                          onRetryChapter={
                            !active && task.status !== 'completed'
                              ? () => onRetry({ chapterId: task.chapter.id })
                              : undefined
                          }
                          diskInfo={diskMap?.[task.chapter.id]}
                          onRedownload={
                            !active
                              ? () =>
                                  onRetry({
                                    chapterId: task.chapter.id,
                                    force: true,
                                  })
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )
                }
                return (
                  <div className="space-y-3">
                    {groups.map((g) => (
                      <div
                        key={g.volume || '__none__'}
                        className="rounded-lg border border-neutral-800/70 bg-neutral-950/30"
                      >
                        {/* Cabeçalho do volume */}
                        <div className="flex items-center gap-2 border-b border-neutral-800/60 px-3 py-2">
                          <Layers
                            size={12}
                            className="shrink-0 text-neutral-500"
                            aria-hidden="true"
                          />
                          <span className="font-mono text-xs font-bold text-neutral-200">
                            {g.volume || 'Sem volume'}
                          </span>
                          <span className="font-mono text-[11px] text-neutral-600">
                            {taskRange(g.tasks)}
                          </span>
                          <span
                            className={`font-mono text-[11px] ${
                              g.missing === 0
                                ? 'text-emerald-400/90'
                                : 'text-neutral-400'
                            }`}
                          >
                            · {g.tasks.length - g.missing}/{g.tasks.length}{' '}
                            baixados
                          </span>
                          {g.missing > 0 && (
                            <span className="font-mono text-[11px] text-amber-400/90">
                              · faltam {g.missing}
                            </span>
                          )}
                          {!active && g.missing > 0 && (
                            <button
                              type="button"
                              onClick={() => onRetry({ volume: g.volume })}
                              aria-label={`Refazer o que faltou do volume ${g.volume || 'sem volume'}`}
                              className="ml-auto flex items-center gap-1 rounded border border-amber-800/60 px-2 py-0.5 font-mono text-[10px] text-amber-300 transition-colors hover:bg-amber-950/40"
                            >
                              <RotateCcw size={10} aria-hidden="true" />
                              Refazer volume
                            </button>
                          )}
                        </div>
                        {/* Capítulos do volume */}
                        <div className="space-y-2 px-3 py-2.5">
                          {g.tasks.map((task, i) => (
                            <TaskRow
                              key={task.chapter.id}
                              task={task}
                              taskIndex={g.indices[i]}
                              jobId={job.jobId}
                              liveProgress={jobProgress[task.chapter.number]}
                              onRetryChapter={
                                !active && task.status !== 'completed'
                                  ? () =>
                                      onRetry({ chapterId: task.chapter.id })
                                  : undefined
                              }
                              diskInfo={diskMap?.[task.chapter.id]}
                              onRedownload={
                                !active
                                  ? () =>
                                      onRetry({
                                        chapterId: task.chapter.id,
                                        force: true,
                                      })
                                  : undefined
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()
            ) : (
              <p className="py-2 font-mono text-xs text-neutral-600">
                Sem capítulos registrados.
              </p>
            )
          ) : (
            <div className="flex items-center gap-2 py-2 font-mono text-xs text-neutral-600">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              Carregando capítulos…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: ChapterTask
  taskIndex: number
  jobId: string
  liveProgress: ChapterProgress | undefined
  /** Re-baixa só este capítulo. Ausente = sem ação (concluído ou job ativo). */
  onRetryChapter?: () => void
  /** Resultado da verificação em disco deste capítulo (se já conferido). */
  diskInfo?: { pages: number; onDisk: boolean }
  /** Re-baixa este capítulo mesmo já concluído (arquivos sumiram da pasta). */
  onRedownload?: () => void
}

function TaskRow({
  task,
  taskIndex,
  jobId,
  liveProgress,
  onRetryChapter,
  diskInfo,
  onRedownload,
}: TaskRowProps) {
  const [showGallery, setShowGallery] = useState(false)
  // Histórico diz concluído, mas os arquivos não estão na pasta real.
  const missingOnDisk =
    task.status === 'completed' && diskInfo !== undefined && !diskInfo.onDisk

  const page =
    task.status === 'running' ? (liveProgress?.page ?? task.page) : task.page
  const totalPages =
    task.status === 'running'
      ? (liveProgress?.totalPages ?? task.totalPages)
      : task.totalPages
  const pct = totalPages > 0 ? (page / totalPages) * 100 : 0

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <StatusIcon status={task.status} size={13} />

        {/* Nome do capítulo */}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-400">
          Cap.{' '}
          <span className="font-medium text-neutral-200">
            {task.chapter.number}
          </span>
          {task.chapter.title &&
            task.chapter.title !== task.chapter.number && (
              <span className="text-neutral-600">
                {' '}- {task.chapter.title}
              </span>
            )}
        </span>

        {/* Contador de páginas (running) */}
        {task.status === 'running' && totalPages > 0 && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-sky-400/80">
            {page}/{totalPages}p
          </span>
        )}

        {/* Estado no disco (após "Conferir na pasta") */}
        {task.status === 'completed' && diskInfo && diskInfo.onDisk && (
          <span
            className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-emerald-500/80"
            title={`${diskInfo.pages} páginas na pasta`}
          >
            <HardDrive size={10} aria-hidden="true" />
            {diskInfo.pages}p
          </span>
        )}
        {missingOnDisk && (
          <span
            className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-red-400"
            title="O histórico diz baixado, mas os arquivos não estão na pasta (movidos ou apagados)"
          >
            <FileWarning size={10} aria-hidden="true" />
            fora da pasta
          </span>
        )}

        {/* Botão de preview (completed e presente no disco) */}
        {task.status === 'completed' && !missingOnDisk && (
          <button
            type="button"
            onClick={() => setShowGallery(true)}
            className="flex shrink-0 items-center gap-1 rounded border border-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 transition-colors hover:border-neutral-700 hover:text-neutral-300"
            aria-label={`Visualizar páginas do capítulo ${task.chapter.number}`}
          >
            <Eye size={10} aria-hidden="true" />
            ver
          </button>
        )}

        {/* Re-baixar quando os arquivos sumiram da pasta */}
        {missingOnDisk && onRedownload && (
          <button
            type="button"
            onClick={onRedownload}
            className="flex shrink-0 items-center gap-1 rounded border border-amber-800/60 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 transition-colors hover:bg-amber-950/40"
            aria-label={`Re-baixar o capítulo ${task.chapter.number} que sumiu da pasta`}
            title="Re-baixar este capítulo para a pasta"
          >
            <RotateCw size={10} aria-hidden="true" />
            re-baixar
          </button>
        )}

        {/* Erro resumido */}
        {task.status === 'failed' && task.error && (
          <span
            className="max-w-[140px] shrink-0 truncate font-mono text-[10px] text-red-400/70"
            title={task.error}
          >
            {task.error}
          </span>
        )}

        {/* Reload: re-baixa só este capítulo (falho/fila/cancelado) */}
        {onRetryChapter && (
          <button
            type="button"
            onClick={onRetryChapter}
            className="flex shrink-0 items-center gap-1 rounded border border-amber-800/60 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 transition-colors hover:bg-amber-950/40"
            aria-label={`Re-baixar o capítulo ${task.chapter.number}`}
            title="Re-baixar este capítulo"
          >
            <RotateCw size={10} aria-hidden="true" />
            re-baixar
          </button>
        )}
      </div>

      {/* Barra de progresso de página (running) */}
      {task.status === 'running' && totalPages > 0 && (
        <div
          className="ml-5 h-px overflow-hidden rounded-full bg-neutral-800"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Cap. ${task.chapter.number}: ${page} de ${totalPages} páginas`}
        >
          <div
            className="bar-shimmer h-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Galeria de páginas */}
      {showGallery && (
        <PageGallery
          jobId={jobId}
          taskIndex={taskIndex}
          chapterNumber={task.chapter.number}
          onClose={() => setShowGallery(false)}
        />
      )}
    </div>
  )
}
