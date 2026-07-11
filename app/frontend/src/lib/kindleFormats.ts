// Formatos de capa: "Original" (mantém o tamanho baixado), presets de Kindle
// (por modelo, com a resolução da tela) e "Personalizado" (largura×altura à
// mão). O resize é sempre para as dimensões EXATAS do formato — igual a um
// imageresizer —, só que com qualidade alta (feito no backend com CatmullRom).

export interface KindlePreset {
  /** Slug estável para key/seleção. */
  id: string
  /** Nome do modelo, ex.: "Kindle Paperwhite 5 (11ª geração, 2021)". */
  name: string
  width: number
  height: number
}

/**
 * Presets de Kindle, um por RESOLUÇÃO (modelos de mesma largura×altura viram uma
 * opção só, com os nomes listados no rótulo). Ordenados por resolução crescente.
 */
export const KINDLE_PRESETS: KindlePreset[] = [
  {
    id: 'kindle-600x800',
    name: 'Kindle básico, Keyboard e Touch (1ª–4ª ger. e 2019)',
    width: 600,
    height: 800,
  },
  {
    id: 'kindle-758x1024',
    name: 'Kindle Paperwhite 1 e 2 (2012–2013)',
    width: 758,
    height: 1024,
  },
  {
    id: 'kindle-824x1200',
    name: 'Kindle DX / DX Graphite',
    width: 824,
    height: 1200,
  },
  {
    id: 'kindle-1072x1448',
    name: 'Kindle Voyage, Paperwhite 3 e 4, Oasis 1 e Kindle 2022',
    width: 1072,
    height: 1448,
  },
  {
    id: 'kindle-1236x1648',
    name: 'Kindle Paperwhite 5 e Signature Edition (2021)',
    width: 1236,
    height: 1648,
  },
  {
    id: 'kindle-1264x1680',
    name: 'Kindle Colorsoft, Paperwhite (2024) e Oasis 2 e 3',
    width: 1264,
    height: 1680,
  },
  {
    id: 'kindle-1860x2480',
    name: 'Kindle Scribe (2022 e 2024)',
    width: 1860,
    height: 2480,
  },
]

/** Formato escolhido para a capa. */
export type CoverFormat =
  | { kind: 'original' }
  | { kind: 'kindle'; id: string; label: string; width: number; height: number }
  | { kind: 'custom'; width: number; height: number }

/** Formato padrão: mantém a capa exatamente como veio. */
export const ORIGINAL_FORMAT: CoverFormat = { kind: 'original' }

/**
 * Dimensões efetivas do formato, ou null quando é "Original" (sem resize).
 * Custom só vale com largura e altura > 0.
 */
export function formatDims(f: CoverFormat): { width: number; height: number } | null {
  if (f.kind === 'original') return null
  if (f.width > 0 && f.height > 0) return { width: f.width, height: f.height }
  return null
}

/** Rótulo curto de um preset: "Kindle Voyage … (1072×1448)". */
export function presetLabel(p: KindlePreset): string {
  return `${p.name} (${p.width}×${p.height})`
}

/** Metadados do formato para persistir/exibir (kind + rótulo + dimensões). */
export interface FormatMeta {
  kind: 'original' | 'kindle' | 'custom'
  label: string
  width: number
  height: number
}

/** Deriva os metadados persistíveis de um formato escolhido. */
export function formatMeta(f: CoverFormat): FormatMeta {
  if (f.kind === 'original') return { kind: 'original', label: 'Original', width: 0, height: 0 }
  if (f.kind === 'kindle')
    return { kind: 'kindle', label: f.label, width: f.width, height: f.height }
  return {
    kind: 'custom',
    label: `Personalizado ${f.width}×${f.height}`,
    width: f.width,
    height: f.height,
  }
}

/** Normaliza texto para busca (minúsculo, sem acentos). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Filtra presets por nome/dimensões; query vazia devolve todos. */
export function searchPresets(query: string): KindlePreset[] {
  const q = norm(query.trim())
  if (!q) return KINDLE_PRESETS
  return KINDLE_PRESETS.filter((p) => {
    if (norm(p.name).includes(q)) return true
    return `${p.width}x${p.height}`.includes(q) || `${p.width}×${p.height}`.includes(q)
  })
}
