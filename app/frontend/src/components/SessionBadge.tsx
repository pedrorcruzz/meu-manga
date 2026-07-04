// Badge compacto no cabeçalho que reflete o estado da sessão Cloudflare.
// Usa SessionContext (fonte única de verdade, compartilhada com o banner).

import { Loader2, ShieldCheck, ShieldX } from 'lucide-react'
import { useSessionContext } from '~/context/session'

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}min`
}

export function SessionBadge() {
  const { valid, session, loading, lastCheckedAt, secondsSinceCheck } =
    useSessionContext()

  const timeLabel = lastCheckedAt
    ? `última verificação há ${formatAge(secondsSinceCheck)}`
    : undefined

  const titleAttr = [session?.detail, timeLabel].filter(Boolean).join(' · ')

  if (valid === null && loading) {
    return (
      <span className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-neutral-500">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        Verificando
      </span>
    )
  }

  const ok = valid === true

  return (
    <span
      title={titleAttr || undefined}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs uppercase tracking-wide transition ${
        ok
          ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-400'
          : 'border-amber-900/60 bg-amber-950/30 text-amber-400'
      }`}
    >
      {ok ? (
        <ShieldCheck size={12} aria-hidden="true" />
      ) : (
        <ShieldX size={12} aria-hidden="true" />
      )}
      {ok ? 'Sessão OK' : 'Cloudflare'}
    </span>
  )
}
