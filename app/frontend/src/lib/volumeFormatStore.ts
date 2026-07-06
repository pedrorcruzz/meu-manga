// Fonte única do formato do nome dos volumes, compartilhada entre a aba de
// montagem (VolumeBuilder) e a de revisão/baixar (downloads). Persistido no
// SQLite do backend (via /settings) — NÃO em localStorage — para que a última
// escolha prevaleça em qualquer aba e sobreviva a fechar o app. Mexer numa aba
// reflete na outra porque ambas leem/gravam este mesmo store.

import { useEffect, useSyncExternalStore } from 'react'
import { api, type VolumeNameFormatDTO } from '~/api/client'
import {
  DEFAULT_VOLUME_FORMAT,
  type VolumeDigits,
  type VolumeNameFormat,
  type VolumePrefix,
} from './volumeName'

let current: VolumeNameFormat = DEFAULT_VOLUME_FORMAT
// Memoiza o carregamento (uma leitura só do backend, reaproveitada por todos).
let loadPromise: Promise<VolumeNameFormat> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function snapshot(): VolumeNameFormat {
  return current
}

/** Normaliza o DTO do backend para o tipo forte, caindo no padrão se inválido. */
function normalize(f: VolumeNameFormatDTO | null | undefined): VolumeNameFormat {
  const prefix: VolumePrefix =
    f?.prefix === 'v' || f?.prefix === 'volume' ? f.prefix : 'none'
  const digits: VolumeDigits = f?.digits === 1 || f?.digits === 2 ? f.digits : 3
  return { prefix, digits }
}

/**
 * Carrega o formato persistido (SQLite) uma única vez e devolve o valor. Chamadas
 * concorrentes reaproveitam a mesma promessa; erros caem no valor atual.
 */
export function loadVolumeFormat(): Promise<VolumeNameFormat> {
  if (loadPromise) return loadPromise
  loadPromise = api
    .getSettings()
    .then((s) => {
      current = normalize(s.volumeNameFormat)
      emit()
      return current
    })
    .catch(() => current)
  return loadPromise
}

/** Formato atual conhecido (síncrono), sem disparar carregamento. */
export function getVolumeFormat(): VolumeNameFormat {
  return current
}

/**
 * Atualiza o formato de forma otimista (reflete na hora nas duas abas) e persiste
 * no backend (SQLite). Falha de rede é silenciosa — o valor em memória continua.
 */
export function setVolumeFormat(fmt: VolumeNameFormat): void {
  current = fmt
  loadPromise = Promise.resolve(fmt)
  emit()
  api.updateSettings({ volumeNameFormat: fmt }).catch(() => {})
}

/** Hook reativo: dispara o carregamento na 1ª montagem e re-renderiza em mudanças. */
export function useVolumeFormat(): VolumeNameFormat {
  const fmt = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    void loadVolumeFormat()
  }, [])
  return fmt
}
