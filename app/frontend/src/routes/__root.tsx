/// <reference types="vite/client" />
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import * as React from 'react'
import { Download } from 'lucide-react'
import { BlockBanner } from '~/components/BlockBanner'
import { CloudflareBanner } from '~/components/CloudflareBanner'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { QuitButton } from '~/components/QuitButton'
import { SessionBadge } from '~/components/SessionBadge'
import { SessionProvider } from '~/context/session'
import appCss from '~/styles/app.css?url'
import { seo } from '~/utils/seo'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ...seo({
        title: 'Meu Mangá',
        description: 'Baixador local de mangás do Sakura Mangás.',
      }),
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
        <SessionProvider>
          <BlockBanner />
          <CloudflareBanner />
          <header className="border-b border-neutral-800/60 bg-neutral-950/80 backdrop-blur-sm">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
              {/* Wordmark com ícone - clica para voltar à home */}
              <Link
                to="/"
                className="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-[0.2em] text-neutral-300 transition hover:text-white"
                style={{ textShadow: '0 0 8px rgba(228,228,231,0.2)' }}
              >
                <img
                  src="/favicon.svg"
                  alt=""
                  width={20}
                  height={20}
                  aria-hidden="true"
                />
                MEU MANGÁ
              </Link>
              {/* Controles - pills alinhados */}
              <div className="flex items-center gap-2">
                <Link
                  to="/downloads"
                  activeProps={{
                    className:
                      'border-neutral-700 bg-neutral-800 text-neutral-200',
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-neutral-400 transition hover:border-neutral-700 hover:text-neutral-200"
                >
                  <Download size={12} aria-hidden="true" />
                  Downloads
                </Link>
                <SessionBadge />
                <QuitButton />
              </div>
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
            {children}
          </main>

          {/* Rodapé sutil com crédito do criador */}
          <footer className="flex items-center justify-center gap-1.5 border-t border-neutral-900 py-3 text-xs text-neutral-600">
            <span>feito por Pedro Rosa</span>
            <span aria-hidden="true">·</span>
            <a
              href="https://github.com/pedrorcruzz/meu-manga"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 transition-colors hover:text-neutral-400"
            >
              {/* GitHub mark SVG - lucide-react nesta versão não inclui Github */}
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23A11.52 11.52 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.29-1.552 3.297-1.23 3.297-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.298 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          </footer>
        </SessionProvider>
        <Scripts />
      </body>
    </html>
  )
}
