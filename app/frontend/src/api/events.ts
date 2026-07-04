import { useEffect, useRef } from 'react'
import { API_BASE, type DownloadEvent } from './client'

// useDownloadEvents assina o stream SSE do backend e chama onEvent a cada mensagem.
export function useDownloadEvents(onEvent: (e: DownloadEvent) => void) {
  const cb = useRef(onEvent)
  cb.current = onEvent
  useEffect(() => {
    if (typeof window === 'undefined') return
    const es = new EventSource(`${API_BASE}/api/events`)
    es.onmessage = (m) => {
      try {
        cb.current(JSON.parse(m.data) as DownloadEvent)
      } catch {
        // ignora frames que não são JSON (ex.: keep-alive)
      }
    }
    return () => es.close()
  }, [])
}
