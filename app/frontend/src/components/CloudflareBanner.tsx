// Banner app-wide que aparece quando a sessão Cloudflare está inválida.
// Renderizado acima do <main> em __root.tsx via SessionProvider.

import { ArrowRight, Check } from 'lucide-react'
import { useSessionContext } from '~/context/session'

export function CloudflareBanner() {
  const { valid, justBecameValid, loading, refresh } = useSessionContext()

  // Flash verde temporário quando a sessão volta a ser válida
  if (justBecameValid) {
    return (
      <div className="border-b border-emerald-800 bg-emerald-950 px-4 py-2.5">
        <div className="mx-auto flex max-w-5xl items-center gap-2 text-sm text-emerald-300">
          <Check size={14} aria-hidden="true" />
          <span>Sessão ok - tudo certo para baixar!</span>
        </div>
      </div>
    )
  }

  // Banner só aparece quando sabemos que é inválido (valid === false)
  if (valid !== false) return null

  return (
    <div className="border-b border-amber-800/60 bg-amber-950/40 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-amber-200">
          <span className="font-semibold">Verificação Cloudflare pendente</span>{' '}
          - resolva o desafio no Navegador (firewall do site, não o captcha do
          leitor). O download volta sozinho.
        </p>
        <div className="flex shrink-0 gap-2">
          <a
            href="https://sakuramangas.org/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-amber-400 active:bg-amber-600"
          >
            Resolva o Cloudflare do Navegador
            <ArrowRight size={14} aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-900 disabled:opacity-50"
          >
            {loading ? 'Verificando…' : 'Verificar de novo'}
          </button>
        </div>
      </div>
    </div>
  )
}
