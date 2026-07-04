import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FolderOpen,
  Loader2,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import {
  api,
  NoSessionError,
  type ChapterTask,
  type JobStatus,
  type JobSummary,
} from '~/api/client'
import { useDownloadEvents } from '~/api/events'
import { PageGallery } from '~/components/PageGallery'
import { useSessionContext } from '~/context/session'
import { useAsync } from '~/hooks/useAsync'

// Progresso live de páginas: jobId → chapterNumber → {page, totalPages}
type ChapterProgress = { page: number; totalPages: number }
type LiveProgress = Record<string, Record<string, ChapterProgress>>
type FilterMode = 'all' | 'active' | 'done'

export const Route = createFileRoute('/downloads')({
  component: DownloadsPage,
})

function DownloadsPage() {
  const { refresh: refreshSession } = useSessionContext()

  const [listTick, setListTick] = useState(0)
  const [progressMap, setProgressMap] = useState<LiveProgress>({})
  const [filter, setFilter] = useState<FilterMode>('all')

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

  async function cancel(id: string) {
    try {
      await api.cancelJob(id)
    } catch (err) {
      if (err instanceof NoSessionError) refreshSession()
    }
    setListTick((t) => t + 1)
  }

  // Refaz só os capítulos que faltaram (novo job). Não perde o que já baixou.
  async function retry(id: string) {
    try {
      await api.retryJob(id)
    } catch (err) {
      if (err instanceof NoSessionError) refreshSession()
    }
    setListTick((t) => t + 1)
  }

  // Remove do histórico. Os arquivos já salvos no disco não são apagados.
  async function remove(id: string) {
    const ok = window.confirm(
      'Remover este download do histórico?\n\n' +
        'Os capítulos já baixados no disco NÃO são apagados — isto só limpa a ' +
        'entrada aqui da lista.',
    )
    if (!ok) return
    try {
      await api.removeJob(id)
    } catch {
      // ignora: a lista é atualizada a seguir de qualquer forma
    }
    setListTick((t) => t + 1)
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

  return (
    <div className="space-y-5">
      {/* Pasta de downloads */}
      <DownloadFolderSection />

      {error ? (
        isSessionError ? (
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/30 px-4 py-3 font-mono text-sm text-amber-300">
            Sessão Cloudflare inválida — resolva o desafio no Navegador (veja o
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
        <div className="space-y-3">
          {/* Cabeçalho: contagem e filtros */}
          <DashboardHeader
            total={list.length}
            activeCount={activeCount}
            filter={filter}
            onFilterChange={setFilter}
          />

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

          {/* Lista de jobs com altura fixa e scroll */}
          <div className="retro-scroll max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {filteredList.length === 0 ? (
              <div className="py-10 text-center font-mono text-sm text-neutral-600">
                Nenhum download nesta categoria.
              </div>
            ) : (
              filteredList.map((job) => (
                <JobCard
                  key={job.jobId}
                  job={job}
                  jobProgress={progressMap[job.jobId] ?? {}}
                  listTick={listTick}
                  onCancel={() => void cancel(job.jobId)}
                  onRetry={() => void retry(job.jobId)}
                  onRemove={() => void remove(job.jobId)}
                />
              ))
            )}
          </div>
        </div>
      )}
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
          para baixar só os capítulos restantes — sem repetir os concluídos.
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
}: {
  total: number
  activeCount: number
  filter: FilterMode
  onFilterChange: (f: FilterMode) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
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
        Padrão: pasta Downloads do sistema.
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
            Captcha do leitor — {title}
          </p>
          <p className="text-xs leading-relaxed text-amber-200/70">
            O leitor de mangá tem seu próprio anti-bot. Abra o capítulo no
            Navegador, resolva o desafio e tente baixar de novo.
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
                  {' '}— {task.chapter.title}
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

// ── JobCard (colapsável) ──────────────────────────────────────────────────────

interface JobCardProps {
  job: JobSummary
  jobProgress: Record<string, ChapterProgress>
  listTick: number
  onCancel: () => void
  onRetry: () => void
  onRemove: () => void
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
      {/* Cabeçalho — sempre visível, clicável para expandir */}
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
          <div className="mt-0.5 flex items-center gap-1.5">
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

        {/* Ações — stop propagation para não colapsar ao clicar */}
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
                  onClick={onRetry}
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

      {/* Barra de progresso geral (mobile — abaixo do cabeçalho) */}
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

      {/* Área expandida: capítulos */}
      {expanded && (
        <div
          id={`job-tasks-${job.jobId}`}
          className="border-t border-neutral-800/60 px-4 py-3"
        >
          {detail ? (
            detail.tasks.length > 0 ? (
              <div className="space-y-2">
                {detail.tasks.map((task, idx) => (
                  <TaskRow
                    key={task.chapter.id}
                    task={task}
                    taskIndex={idx}
                    jobId={job.jobId}
                    liveProgress={jobProgress[task.chapter.number]}
                  />
                ))}
              </div>
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
}

function TaskRow({ task, taskIndex, jobId, liveProgress }: TaskRowProps) {
  const [showGallery, setShowGallery] = useState(false)

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
                {' '}— {task.chapter.title}
              </span>
            )}
        </span>

        {/* Contador de páginas (running) */}
        {task.status === 'running' && totalPages > 0 && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-sky-400/80">
            {page}/{totalPages}p
          </span>
        )}

        {/* Botão de preview (completed) */}
        {task.status === 'completed' && (
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

        {/* Erro resumido */}
        {task.status === 'failed' && task.error && (
          <span
            className="max-w-[140px] shrink-0 truncate font-mono text-[10px] text-red-400/70"
            title={task.error}
          >
            {task.error}
          </span>
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
