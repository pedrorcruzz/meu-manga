// Cliente da API do backend Go. Aponta direto pro backend (:8080) - funciona
// em dev e em produção (o backend libera CORS), sem depender de proxy.
export const API_BASE =
  (typeof process !== 'undefined' && process.env?.MM_BACKEND) ||
  'http://localhost:8080'

// Lançado quando o backend retorna 424 - sessão Cloudflare inválida.
export class NoSessionError extends Error {
  constructor() {
    super('Sessão Cloudflare inválida - resolva o desafio no Navegador')
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
  /** Slug do mangá pai (vem no fio; usado para agrupar volumes do mesmo mangá). */
  slug?: string
  status: JobStatus
  totalChapters: number
  completedChapters: number
  /** Data de criação em ISO-8601 (histórico). */
  createdAt?: string
}

export interface ChapterTask {
  chapter: Chapter
  /** Nome do volume ao qual o capítulo pertence (vazio no modo simples). */
  volume?: string
  status: JobStatus
  page: number
  totalPages: number
  error?: string
}

export interface JobDetail extends JobSummary {
  slug: string
  tasks: ChapterTask[]
}

/** Capítulo no payload de download - subconjunto de Chapter sem date. */
export interface ChapterInput {
  id: string
  number: string
  url: string
  title: string
}

/** Volume no payload de download (modo volumes). */
export interface VolumeInput {
  /** Nome do volume, ex.: "001". Zero-padded a 3 dígitos. */
  name: string
  /**
   * Capa como data URL base64 (qualquer formato de imagem).
   * O backend converte para JPG e salva como 001.jpg do primeiro capítulo do
   * volume, deslocando as páginas subsequentes.
   */
  coverImage: string | null
  chapters: ChapterInput[]
}

/** Volume de uma montagem salva (persistência). Espelha o Volume local sem o id. */
export interface MountVolumeData {
  name: string
  label?: string
  /** Capa como data URL base64 (ausente = sem capa). */
  coverImage?: string | null
  chapters: Chapter[]
}

/** Corpo enviado ao salvar uma montagem. */
export interface MountInput {
  title: string
  thumbUrl: string
  volumes: MountVolumeData[]
}

/** Montagem salva completa (com as capas), como volta do backend. */
export interface MountDetail {
  source: string
  slug: string
  title: string
  thumbUrl: string
  /** Última atualização em ISO-8601. */
  updatedAt: string
  volumes: MountVolumeData[]
}

/** Resumo de uma montagem salva para a lista (sem as capas base64). */
export interface MountSummary {
  source: string
  slug: string
  title: string
  thumbUrl: string
  updatedAt: string
  volumeCount: number
  chapterCount: number
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

/** Capítulo lido da pasta em disco (editor "Consertar volumes"). */
export interface TreeChapter {
  /** Nome da pasta, ex.: "Cap 5". */
  folder: string
  /** Número, ex.: "5". */
  number: string
  /** Nº de imagens no disco. */
  pages: number
  /** 1ª imagem (miniatura), "" se vazio. */
  firstPage: string
}

/** Volume lido da pasta em disco. */
export interface TreeVolume {
  /** Nome da subpasta cru, ex.: "Minha Obra Volume 01". */
  folder: string
  /** Rótulo do volume (prefixo do mangá removido), ex.: "Volume 01". */
  name: string
  chapters: TreeChapter[]
}

/** Árvore em disco de uma obra: volumes + capítulos soltos (modo simples). */
export interface MangaTree {
  manga: string
  /** Caminho absoluto da pasta do mangá. */
  root: string
  volumes: TreeVolume[]
  loose: TreeChapter[]
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
  /**
   * Re-enfileira os capítulos que faltaram de um job. Sem `opts`, refaz todos
   * os não-concluídos. `opts.volume` refaz só um volume; `opts.chapterId` refaz
   * só um capítulo; `opts.force` inclui capítulos já concluídos (para re-baixar
   * arquivos que sumiram da pasta).
   */
  retryJob: (
    id: string,
    opts?: { volume?: string; chapterId?: string; force?: boolean },
  ) => {
    const q = new URLSearchParams()
    if (opts?.volume !== undefined) q.set('volume', opts.volume)
    if (opts?.chapterId) q.set('chapter', opts.chapterId)
    if (opts?.force) q.set('force', '1')
    const qs = q.toString()
    return req<{ jobId: string }>(
      `/downloads/${encodeURIComponent(id)}/retry${qs ? `?${qs}` : ''}`,
      { method: 'POST' },
    )
  },
  /**
   * Confere na pasta real quantas páginas cada capítulo tem no disco. O
   * histórico pode dizer "baixado" mas os arquivos podem ter sido movidos.
   */
  verifyJob: (id: string) =>
    req<{
      root: string
      tasks: { chapterId: string; pages: number; onDisk: boolean }[]
    }>(`/downloads/${encodeURIComponent(id)}/verify`),
  /** Remove um job do histórico (cancela antes, se estiver rodando). */
  removeJob: (id: string) =>
    req<void>(`/downloads/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
    }),
  /** Limpa do histórico todos os jobs finalizados de uma vez. */
  clearHistory: () =>
    req<{ removed: number }>('/downloads', { method: 'DELETE' }),
  // ── Montagens salvas (persistência dos volumes montados na obra) ─────────────
  /** Lista o resumo de todas as montagens salvas (mais recentes primeiro). */
  listMounts: () => req<MountSummary[]>('/mounts'),
  /** Devolve a montagem completa de uma obra (com capas). null se não existir. */
  getMount: async (source: string, slug: string): Promise<MountDetail | null> => {
    try {
      return await req<MountDetail>(
        `/mounts/${encodeURIComponent(source)}/${encodeURIComponent(slug)}`,
      )
    } catch (err) {
      // 404 = obra sem montagem salva (caso comum, não é erro).
      if (err instanceof Error && /not found|404/i.test(err.message)) return null
      throw err
    }
  },
  /** Grava (ou substitui) a montagem de uma obra. */
  saveMount: (source: string, slug: string, body: MountInput) =>
    req<{ status: string }>(
      `/mounts/${encodeURIComponent(source)}/${encodeURIComponent(slug)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  /** Remove a montagem salva de uma obra. */
  removeMount: (source: string, slug: string) =>
    req<void>(
      `/mounts/${encodeURIComponent(source)}/${encodeURIComponent(slug)}`,
      { method: 'DELETE' },
    ),
  /** Apaga todas as montagens salvas de uma vez. */
  clearMounts: () =>
    req<{ removed: number }>('/mounts', { method: 'DELETE' }),
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
   * Não faz fetch - apenas monta a URL.
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
  // ── Editor "Consertar volumes" (folder-first, lê/edita a pasta em disco) ──────
  /** Lê a árvore em disco da obra do job (volumes, capítulos, páginas). */
  getMangaTree: (jobId: string) =>
    req<MangaTree>(`/downloads/${encodeURIComponent(jobId)}/tree`),
  /**
   * URL direta de uma página endereçada por nomes de pasta (para <img src>).
   * `vol` vazio = capítulo solto (modo simples). Não faz fetch - só monta a URL.
   */
  mangaPageUrl: (
    jobId: string,
    vol: string,
    chap: string,
    name: string,
    rev?: number,
  ): string =>
    `${API_BASE}/api/downloads/${encodeURIComponent(jobId)}/tree/page?vol=${encodeURIComponent(vol)}&chap=${encodeURIComponent(chap)}&name=${encodeURIComponent(name)}${rev ? `&v=${String(rev)}` : ''}`,
  /** Move a pasta de um capítulo entre volumes. Devolve a árvore atualizada. */
  moveChapter: (
    jobId: string,
    body: { fromVolume: string; toVolume: string; chapter: string },
  ) =>
    req<MangaTree>(`/downloads/${encodeURIComponent(jobId)}/tree/move`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Corrige o número de um capítulo (renomeia "Cap N"). */
  renameChapter: (
    jobId: string,
    body: { volume: string; oldNumber: string; newNumber: string },
  ) =>
    req<MangaTree>(`/downloads/${encodeURIComponent(jobId)}/tree/rename`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /**
   * Define a capa de um volume. `mode: 'insert'` adiciona (empurra as páginas
   * em +1); `mode: 'replace'` troca a 001.jpg existente. `image` é um data URL.
   */
  setCover: (
    jobId: string,
    body: { volume: string; image: string; mode: 'insert' | 'replace' },
  ) =>
    req<MangaTree>(`/downloads/${encodeURIComponent(jobId)}/tree/cover`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  /** Remove a capa de um volume. */
  removeCover: (jobId: string, volume: string) =>
    req<MangaTree>(
      `/downloads/${encodeURIComponent(jobId)}/tree/cover?vol=${encodeURIComponent(volume)}`,
      { method: 'DELETE' },
    ),
  /**
   * Apaga uma página específica de um capítulo (endereçada por nome de pasta) e
   * renumera o restante. `volume` vazio = capítulo solto. Devolve a árvore nova.
   */
  deleteTreePage: (
    jobId: string,
    body: { volume: string; chapter: string; name: string },
  ) =>
    req<MangaTree>(
      `/downloads/${encodeURIComponent(jobId)}/tree/page/delete`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /**
   * Reordena as páginas de um capítulo. `order` é a lista atual de arquivos na
   * nova ordem desejada (renumerada para 001.jpg…00N.jpg). Devolve a árvore nova.
   */
  reorderPages: (
    jobId: string,
    body: { volume: string; chapter: string; order: string[] },
  ) =>
    req<MangaTree>(
      `/downloads/${encodeURIComponent(jobId)}/tree/page/reorder`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** Encerra o backend e o servidor de desenvolvimento. Falhas de rede são
   *  esperadas - o servidor mata a si mesmo no meio da resposta. */
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
