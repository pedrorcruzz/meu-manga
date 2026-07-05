// Passa a seleção de volumes da página da obra para a tela de downloads sem
// iniciar o download. Guardado em memória (as capas são data URLs base64 que
// estourariam o sessionStorage). Vive só durante a navegação dentro do app;
// um reload descarta (o usuário refaz a seleção, sem prejuízo).

import type { DownloadOrder, VolumeInput } from '~/api/client'

export interface PendingDownload {
  source: string
  slug: string
  title: string
  order: DownloadOrder
  volumes: VolumeInput[]
}

let pending: PendingDownload | null = null

/** Registra a seleção pendente (chamado antes de navegar para /downloads). */
export function setPendingDownload(p: PendingDownload): void {
  pending = p
}

/** Lê e limpa a seleção pendente (a tela de downloads consome uma única vez). */
export function takePendingDownload(): PendingDownload | null {
  const p = pending
  pending = null
  return p
}
