// Banner app-wide do bloqueio temporário do site (rate-limit por "atividade
// incomum na rede"). É DIFERENTE do Cloudflare: não há desafio a resolver, só
// esperar até o horário de liberação. Renderizado em __root.tsx.

import { Clock, TriangleAlert } from 'lucide-react'
import { useSessionContext } from '~/context/session'

// formatUntil transforma o ISO de liberação num relógio local legível.
function formatUntil(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function BlockBanner() {
  const { block } = useSessionContext()
  if (!block?.active) return null

  const until = formatUntil(block.until)
  const when = block.rawTime || until

  return (
    <div className="border-b border-rose-800/60 bg-rose-950/50 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-start gap-3">
        <TriangleAlert
          size={16}
          className="mt-0.5 shrink-0 text-rose-400"
          aria-hidden="true"
        />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold text-rose-200">
            Bloqueio temporário do site - não é o Cloudflare
          </p>
          <p className="text-sm text-rose-200/80">
            O Sakura detectou muitos acessos vindos da sua rede e{' '}
            <span className="font-semibold">bloqueou por tempo</span>. Isto não é
            um desafio para resolver: não adianta tentar de novo agora - só faria
            o bloqueio durar mais.
          </p>
          <p className="flex items-center gap-1.5 pt-0.5 text-sm text-rose-100">
            <Clock size={13} aria-hidden="true" />
            Acesso liberado às{' '}
            <span className="font-mono font-semibold">{when || '-'}</span>
            {until && block.rawTime && until !== block.rawTime && (
              <span className="text-rose-300/70">({until} no seu horário)</span>
            )}
          </p>
          <p className="pt-0.5 text-xs text-rose-300/60">
            Dica: baixe menos capítulos de uma vez e mais espaçado para evitar
            que isto se repita. Seus downloads já concluídos estão salvos - nada
            foi perdido.
          </p>
        </div>
      </div>
    </div>
  )
}
