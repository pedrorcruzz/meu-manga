import { useCallback, useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  /** Objeto de erro bruto, útil para checar instanceof (ex.: NoSessionError). */
  rawError: unknown
  loading: boolean
  reload: () => void
}

// useAsync roda fn no cliente e expõe estado de carregamento/erro + reload manual.
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rawError, setRawError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const run = useCallback(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setRawError(null)
    fn()
      .then((d) => {
        if (!alive) return
        setData(d)
        setRawError(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(errMessage(e))
        setRawError(e)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  useEffect(run, [run])

  return { data, error, rawError, loading, reload: () => setTick((t) => t + 1) }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
