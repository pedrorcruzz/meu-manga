import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Backend Go roda em :8080; o dev server faz proxy de /api e /events pra ele.
const BACKEND = process.env.MM_BACKEND ?? 'http://localhost:8080'

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/events': { target: BACKEND, changeOrigin: true, ws: true },
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    // exFAT (SSD externo) cria arquivos AppleDouble "._*" ao lado dos assets;
    // o copyPublicAssets do Nitro quebra tentando chmod neles. Ignora todos.
    nitro({ ignore: ['**/._*'] }),
  ],
})
