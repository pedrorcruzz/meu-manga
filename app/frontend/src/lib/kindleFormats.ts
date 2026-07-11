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

/** Presets de Kindle em ordem cronológica (o mais recente no fim). */
export const KINDLE_PRESETS: KindlePreset[] = [
  { id: 'kindle-1-2007', name: 'Kindle (1ª geração, 2007)', width: 600, height: 800 },
  { id: 'kindle-2-2009', name: 'Kindle 2 (2ª geração, 2009)', width: 600, height: 800 },
  { id: 'kindle-dx', name: 'Kindle DX / DX Graphite', width: 824, height: 1200 },
  { id: 'kindle-keyboard-2010', name: 'Kindle Keyboard (3ª geração, 2010)', width: 600, height: 800 },
  { id: 'kindle-4-2011', name: 'Kindle 4 (2011)', width: 600, height: 800 },
  { id: 'kindle-touch-2011', name: 'Kindle Touch (4ª geração, 2011)', width: 600, height: 800 },
  { id: 'kindle-5-2012', name: 'Kindle 5 (2012)', width: 600, height: 800 },
  { id: 'kindle-pw1-2012', name: 'Kindle Paperwhite 1 (5ª geração, 2012)', width: 758, height: 1024 },
  { id: 'kindle-pw2-2013', name: 'Kindle Paperwhite 2 (6ª geração, 2013)', width: 758, height: 1024 },
  { id: 'kindle-voyage-2014', name: 'Kindle Voyage (7ª geração, 2014)', width: 1072, height: 1448 },
  { id: 'kindle-pw3-2015', name: 'Kindle Paperwhite 3 (7ª geração, 2015)', width: 1072, height: 1448 },
  { id: 'kindle-oasis-2016', name: 'Kindle Oasis (8ª geração, 2016)', width: 1072, height: 1448 },
  { id: 'kindle-oasis2-2017', name: 'Kindle Oasis 2 (9ª geração, 2017)', width: 1264, height: 1680 },
  { id: 'kindle-pw4-2018', name: 'Kindle Paperwhite 4 (10ª geração, 2018)', width: 1072, height: 1448 },
  { id: 'kindle-10-2019', name: 'Kindle (10ª geração, 2019)', width: 600, height: 800 },
  { id: 'kindle-oasis3-2019', name: 'Kindle Oasis 3 (10ª geração, 2019)', width: 1264, height: 1680 },
  { id: 'kindle-pw5-2021', name: 'Kindle Paperwhite 5 (11ª geração, 2021)', width: 1236, height: 1648 },
  { id: 'kindle-pw-signature-2021', name: 'Kindle Paperwhite Signature Edition (11ª geração, 2021)', width: 1236, height: 1648 },
  { id: 'kindle-11-2022', name: 'Kindle (11ª geração, 2022)', width: 1072, height: 1448 },
  { id: 'kindle-scribe-2022', name: 'Kindle Scribe (2022)', width: 1860, height: 2480 },
  { id: 'kindle-pw-2024', name: 'Kindle Paperwhite (12ª geração, 2024)', width: 1264, height: 1680 },
  { id: 'kindle-pw-signature-2024', name: 'Kindle Paperwhite Signature Edition (12ª geração, 2024)', width: 1264, height: 1680 },
  { id: 'kindle-colorsoft', name: 'Kindle Colorsoft', width: 1264, height: 1680 },
  { id: 'kindle-colorsoft-signature', name: 'Kindle Colorsoft Signature Edition', width: 1264, height: 1680 },
  { id: 'kindle-scribe-2024', name: 'Kindle Scribe (2024)', width: 1860, height: 2480 },
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
