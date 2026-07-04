// Cliente da API do backend Go. Aponta direto pro backend (:8080) — funciona
// em dev e em produção (o backend libera CORS), sem depender de proxy.
export const API_BASE =
  (typeof process !== 'undefined' && process.env?.MM_BACKEND) ||
  'http://localhost:8080'

// Lançado quando o backend retorna 424 — sessão Cloudflare inválida.
export class NoSessionError extends Error {
  constructor() {
    super('Sessão Cloudflare inválida — resolva o desafio no Navegador')
    this.name = 'NoSessionError'
  }
}

export interface Source {
  id: string
  name: string
}

export interface SessionInfo {
  valid: boolean
  source: string
  detail: string
}

/**
 * Bloqueio temporário do site (rate-limit por "atividade incomum na rede").
 * Diferente do Cloudflare: não há desafio a resolver, só esperar até `rawTime`.
 */
export interface BlockInfo {
  active: boolean
  /** Instante de liberação em ISO-8601. */
  until: string
  /** Horário como o site exibe, ex.: "22:14 GMT-3". */
  rawTime: string
  /** Mensagem pronta em pt-BR. */
  message: string
}

export interface Health {
  status: string
  session: SessionInfo
  block: BlockInfo | null
}

export interface SearchResult {
  source: string
  mangaId: string
  slug: string
  title: string
  thumbUrl: string
  rating: string
  status: string
  demographic: string
  year: number
  url: string
  /** Visualizações formatadas, ex.: "695.559". Ausente em fontes que não expõem o dado. */
  views?: string
  /** Favoritos formatados, ex.: "2.427". Ausente em fontes que não expõem o dado. */
  favorites?: string
}

export interface Chapter {
  id: string
  number: string
  title: string
  url: string
  date: string
  /**
   * Rótulo de volume retornado pelo Sakura (ex.: "Volume 15").
   * String vazia para capítulos ainda sem volume (lançamentos recentes).
   * Ausente em fontes que não suportam volumes.
   */
  volume?: string
}

export interface MangaInfo {
  source: string
  slug: string
  title: string
  thumbUrl: string
}

export interface ChaptersResponse {
  manga: MangaInfo
  chapters: Chapter[]
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface JobSummary {
  jobId: string
  source: string
  title: string
  status: JobStatus
  totalChapters: number
  completedChapters: number
  /** Data de criação em ISO-8601 (histórico). */
  createdAt?: string
}

export interface ChapterTask {
  chapter: Chapter
  status: JobStatus
  page: number
  totalPages: number
  error?: string
}

export interface JobDetail extends JobSummary {
  slug: string
  tasks: ChapterTask[]
}

/** Capítulo no payload de download — subconjunto de Chapter sem date. */
export interface ChapterInput {
  id: string
  number: string
  url: string
  title: string
}

/** Volume no payload de download (modo volumes). */
export interface VolumeInput {
  /** Nome do volume, ex.: "V001". Zero-padded a 3 dígitos. */
  name: string
  /**
   * Capa como data URL base64 (qualquer formato de imagem).
   * O backend converte para JPG e salva como 001.jpg do primeiro capítulo do
   * volume, deslocando as páginas subsequentes.
   */
  coverImage: string | null
  chapters: ChapterInput[]
}

export type DownloadOrder = 'asc' | 'desc'

export interface DownloadRequest {
  source: string
  slug: string
  title: string
  /** Ordem de download enviada ao backend. */
  order: DownloadOrder
  /**
   * União plana de todos os capítulos selecionados (compatibilidade
   * retroativa). Sempre presente, mesmo no modo volumes.
   */
  chapters: ChapterInput[]
  /** Presente apenas no modo "Montar volumes". */
  volumes?: VolumeInput[]
}

export type DownloadEventType =
  | 'progress'
  | 'chapter_done'
  | 'job_done'
  | 'error'

export interface DownloadEvent {
  type: DownloadEventType
  jobId: string
  chapterNumber?: string
  page?: number
  totalPages?: number
  status?: JobStatus
  message?: string
}

export interface Settings {
  downloadDir: string
}

export interface PagesResponse {
  pages: string[]
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (res.status === 424) throw new NoSessionError()
  if (!res.ok) {
    // o backend responde { "error": "mensagem" }; extrai a mensagem limpa
    const text = await res.text().catch(() => '')
    let msg = text
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) msg = parsed.error
    } catch {
      // corpo não-JSON: usa o texto cru
    }
    throw new Error(msg || `${res.status} ${res.statusText}`)
  }
  // 204 No Content não tem corpo
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  health: () => req<Health>('/health'),
  sources: () => req<Source[]>('/sources'),
  search: (source: string, q: string) =>
    req<SearchResult[]>(
      `/search?source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`,
    ),
  chapters: (source: string, slug: string) =>
    req<ChaptersResponse>(`/manga/${source}/${slug}/chapters`),
  listJobs: () => req<JobSummary[]>('/downloads'),
  getJob: (id: string) => req<JobDetail>(`/downloads/${id}`),
  createJob: (body: DownloadRequest) =>
    req<{ jobId: string }>('/downloads', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelJob: (id: string) =>
    req<void>(`/downloads/${id}`, { method: 'DELETE' }),
  /** Re-enfileira apenas os capítulos que faltaram de um job. */
  retryJob: (id: string) =>
    req<{ jobId: string }>(`/downloads/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    }),
  /** Remove um job do histórico (cancela antes, se estiver rodando). */
  removeJob: (id: string) =>
    req<void>(`/downloads/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
    }),
  getSettings: () => req<Settings>('/settings'),
  updateSettings: (body: Partial<Settings>) =>
    req<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  pickFolder: () =>
    req<Settings>('/settings/pick-folder', { method: 'POST' }),
  /** Lista as páginas salvas de um capítulo (tarefa). */
  listPages: (jobId: string, taskIndex: number) =>
    req<PagesResponse>(
      `/downloads/${encodeURIComponent(jobId)}/chapters/${String(taskIndex)}/pages`,
    ),
  /**
   * Retorna a URL direta da imagem de uma página (para usar em <img src>).
   * Não faz fetch — apenas monta a URL.
   */
  pageImageUrl: (jobId: string, taskIndex: number, name: string): string =>
    `${API_BASE}/api/downloads/${encodeURIComponent(jobId)}/chapters/${String(taskIndex)}/pages/${encodeURIComponent(name)}`,
  /**
   * Exclui uma página e renumera as restantes.
   * Retorna a lista atualizada de páginas.
   */
  deletePage: (jobId: string, taskIndex: number, name: string) =>
    req<PagesResponse>(
      `/downloads/${encodeURIComponent(jobId)}/chapters/${String(taskIndex)}/pages/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    ),
  /**
   * Pré-visualiza as primeiras páginas de um capítulo como data URLs JPEG.
   * Retorna até `count` imagens já redimensionadas pelo backend.
   */
  previewChapter: (source: string, chapter: Chapter, count = 3) =>
    req<{ images: string[] }>('/preview', {
      method: 'POST',
      body: JSON.stringify({ source, chapter, count }),
    }),
  /** Encerra o backend e o servidor de desenvolvimento. Falhas de rede são
   *  esperadas — o servidor mata a si mesmo no meio da resposta. */
  quit: async (): Promise<void> => {
    try {
      await fetch(`${API_BASE}/api/quit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    } catch {
      // Falha de rede é o comportamento esperado: o servidor encerrou.
    }
  },
}
