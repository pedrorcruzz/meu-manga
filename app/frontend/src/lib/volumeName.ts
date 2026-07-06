// Formato do nome dos volumes gerados no montador.
// O nome = prefixo + número (ex.: "001", "V001", "Volume 01", "1"). No disco a
// pasta fica "<Manga> <nome>" (ex.: "Manga 001"), pois o backend junta título +
// nome do volume. A numeração é sempre incremental; só muda a forma de escrever.

export type VolumePrefix = 'none' | 'v' | 'volume'
export type VolumeDigits = 1 | 2 | 3

export interface VolumeNameFormat {
  prefix: VolumePrefix
  digits: VolumeDigits
}

/** Padrão do projeto: só os 3 dígitos, sem prefixo (ex.: "001"). */
export const DEFAULT_VOLUME_FORMAT: VolumeNameFormat = {
  prefix: 'none',
  digits: 3,
}

/** Opções do dropdown de prefixo. */
export const PREFIX_OPTIONS: { value: VolumePrefix; label: string }[] = [
  { value: 'none', label: 'Nada' },
  { value: 'v', label: 'V' },
  { value: 'volume', label: 'Volume' },
]

/** Opções do dropdown da forma dos números. */
export const DIGITS_OPTIONS: { value: VolumeDigits; label: string }[] = [
  { value: 3, label: '001' },
  { value: 2, label: '01' },
  { value: 1, label: '1' },
]

function prefixString(prefix: VolumePrefix): string {
  if (prefix === 'v') return 'V'
  if (prefix === 'volume') return 'Volume '
  return ''
}

function numberString(num: number, digits: VolumeDigits): string {
  return digits === 1 ? String(num) : String(num).padStart(digits, '0')
}

/** Gera o nome de um volume a partir do seu número (1-based) e do formato. */
export function formatVolumeName(num: number, fmt: VolumeNameFormat): string {
  return prefixString(fmt.prefix) + numberString(num, fmt.digits)
}

/**
 * Reaplica o formato a um nome já existente preservando o número intrínseco
 * (ex.: o volume 15 da fonte continua 15, só muda prefixo/zeros à esquerda).
 * Nomes sem dígitos (rótulos livres) ficam intactos.
 */
export function reformatVolumeName(
  name: string,
  fmt: VolumeNameFormat,
): string {
  const m = name.match(/\d+/)
  if (!m) return name
  return formatVolumeName(parseInt(m[0], 10), fmt)
}

/** Exemplo mostrado no seletor: "Manga 001", "Manga V001", etc. */
export function volumeNameExample(fmt: VolumeNameFormat): string {
  return `Manga ${formatVolumeName(1, fmt)}`
}

/**
 * Número intrínseco de um volume a partir do seu nome ("001", "Volume 01",
 * "V15" → 1, 1, 15). Independe de prefixo/zeros à esquerda — serve para casar o
 * mesmo volume entre a seleção pendente e a pasta em disco. null = sem dígitos.
 */
export function volumeNumber(name: string): number | null {
  const m = name.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

/**
 * Deduz o formato a partir de um nome já gerado (para o seletor refletir uma
 * montagem carregada do disco). Heurística boa o suficiente para as saídas do
 * próprio app; retorna null quando o nome não tem número.
 */
export function inferVolumeFormat(name: string): VolumeNameFormat | null {
  const m = name.match(/\d+/)
  if (!m) return null
  let prefix: VolumePrefix = 'none'
  if (/^volume\s/i.test(name)) prefix = 'volume'
  else if (/^v\d/i.test(name)) prefix = 'v'
  const digitsStr = m[0]
  // Zero à esquerda indica zero-padding do tamanho da string; sem zero = sem pad.
  const digits: VolumeDigits =
    digitsStr.length >= 2 && digitsStr[0] === '0'
      ? (Math.min(3, digitsStr.length) as VolumeDigits)
      : 1
  return { prefix, digits }
}
