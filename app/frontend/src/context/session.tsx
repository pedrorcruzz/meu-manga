// Contexto de sessão Cloudflare — fonte única de verdade para o badge e o banner.
// Polling a cada 20 s + ao focar a janela.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { api, type BlockInfo, type SessionInfo } from '~/api/client'

export interface SessionContextValue {
  /** null enquanto a primeira checagem ainda não terminou. */
  session: SessionInfo | null
  /** null = carregando, true/false = resultado da sonda. */
  valid: boolean | null
  /** Bloqueio temporário do site ativo, ou null. */
  block: BlockInfo | null
  loading: boolean
  /** Quando a última checagem foi concluída (null = nunca). */
  lastCheckedAt: Date | null
  /** Segundos desde a última checagem concluída. */
  secondsSinceCheck: number
  /** Fica true por ~3 s quando a sessão passa de inválida → válida. */
  justBecameValid: boolean
  /** Dispara uma checagem imediata. */
  refresh: () => void
}

const SessionContext = createContext<SessionContextValue>({
  session: null,
  valid: null,
  block: null,
  loading: true,
  lastCheckedAt: null,
  secondsSinceCheck: 0,
  justBecameValid: false,
  refresh: () => {},
})

export function useSessionContext(): SessionContextValue {
  return useContext(SessionContext)
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [block, setBlock] = useState<BlockInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)
  const [secondsSinceCheck, setSecondsSinceCheck] = useState(0)
  const [justBecameValid, setJustBecameValid] = useState(false)

  const prevValidRef = useRef<boolean | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doCheck = useCallback(() => {
    setLoading(true)
    api
      .health()
      .then((h) => {
        setSession(h.session)
        setBlock(h.block ?? null)
        setLastCheckedAt(new Date())
        setSecondsSinceCheck(0)

        // Detecta transição inválida → válida para o flash verde
        if (prevValidRef.current === false && h.session.valid === true) {
          if (dismissTimerRef.current !== null) {
            clearTimeout(dismissTimerRef.current)
          }
          setJustBecameValid(true)
          dismissTimerRef.current = setTimeout(() => {
            setJustBecameValid(false)
            dismissTimerRef.current = null
          }, 3000)
        }
        prevValidRef.current = h.session.valid
      })
      .catch(() => {
        // Falha de rede: mantém o estado anterior sem alterar a sessão.
      })
      .finally(() => setLoading(false))
  }, [])

  // Checagem inicial + polling a cada 20 s
  useEffect(() => {
    doCheck()
    const id = setInterval(doCheck, 20_000)
    return () => clearInterval(id)
  }, [doCheck])

  // Checa quando a janela recupera o foco
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('focus', doCheck)
    return () => window.removeEventListener('focus', doCheck)
  }, [doCheck])

  // Relógio de "última verificação há Xs" — tick a cada segundo
  useEffect(() => {
    const id = setInterval(
      () => setSecondsSinceCheck((s) => s + 1),
      1000,
    )
    return () => clearInterval(id)
  }, [])

  // Limpeza do timer de dismiss ao desmontar
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current)
    }
  }, [])

  const valid = session ? session.valid : null

  return (
    <SessionContext.Provider
      value={{
        session,
        valid,
        block,
        loading,
        lastCheckedAt,
        secondsSinceCheck,
        justBecameValid,
        refresh: doCheck,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}
