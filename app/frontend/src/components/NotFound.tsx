import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

export function NotFound({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
      <div className="space-y-2">
        <p className="font-mono text-6xl font-bold text-neutral-700">404</p>
        <p className="text-lg font-medium text-neutral-300">
          Página não encontrada
        </p>
        {children && (
          <p className="text-sm text-neutral-500">{children}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
        >
          Voltar
        </button>
        <Link
          to="/"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
        >
          Início
        </Link>
      </div>
    </div>
  )
}
