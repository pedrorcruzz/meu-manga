// Popup de adicionar/trocar capa: escolher a imagem, pré-visualizar e (opcional)
// escolher um formato (Original / Kindle / Personalizado) para redimensionar com
// qualidade alta. Sem escolher formato, a capa fica exatamente como veio.

import { useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { CoverFormatPicker } from '~/components/CoverFormatPicker'
import { ORIGINAL_FORMAT, formatDims, type CoverFormat } from '~/lib/kindleFormats'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'))
    reader.readAsDataURL(file)
  })
}

/** Mede as dimensões naturais de uma imagem a partir do data URL. */
function measure(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Imagem inválida'))
    img.src = dataUrl
  })
}

export function CoverUploadModal({
  title,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  /** Cabeçalho, ex.: "Adicionar capa" / "Trocar 1ª página". */
  title: string
  confirmLabel: string
  busy?: boolean
  onConfirm: (b: { image: string; width: number; height: number }) => void
  onClose: () => void
}) {
  const [image, setImage] = useState<string | null>(null)
  const [srcDims, setSrcDims] = useState<{ w: number; h: number } | null>(null)
  const [format, setFormat] = useState<CoverFormat>(ORIGINAL_FORMAT)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    setReading(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setImage(dataUrl)
      try {
        setSrcDims(await measure(dataUrl))
      } catch {
        setSrcDims(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar imagem')
    } finally {
      setReading(false)
    }
  }

  const dims = formatDims(format)
  const aspect = srcDims && srcDims.h > 0 ? srcDims.w / srcDims.h : undefined
  const customIncomplete = format.kind === 'custom' && !dims
  const canConfirm = !!image && !customIncomplete && !busy

  function confirm() {
    if (!image || customIncomplete) return
    onConfirm({ image, width: dims?.width ?? 0, height: dims?.height ?? 0 })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-neutral-800 p-4">
          <h2 className="flex items-center gap-2 font-semibold text-neutral-100">
            <ImagePlus size={16} className="text-neutral-400" aria-hidden="true" />
            {title}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {/* Escolher imagem + preview */}
          <div className="flex gap-4">
            <label
              className="group relative flex h-40 w-28 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-neutral-700 bg-neutral-800/60 transition hover:border-neutral-500 hover:bg-neutral-800"
              title={image ? 'Trocar imagem' : 'Escolher imagem'}
            >
              {reading ? (
                <Loader2 size={22} className="animate-spin text-neutral-500" />
              ) : image ? (
                <>
                  <img src={image} alt="Prévia da capa" className="h-full w-full object-contain" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100">
                    <ImagePlus size={22} className="text-white" aria-hidden="true" />
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-neutral-600">
                  <ImagePlus size={24} aria-hidden="true" />
                  <span className="text-[11px]">escolher</span>
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  void pick(e.target.files?.[0])
                  e.target.value = ''
                }}
                aria-label="Escolher imagem da capa"
              />
            </label>

            <div className="min-w-0 flex-1 space-y-1 text-xs">
              {srcDims && (
                <p className="text-neutral-500">
                  Original:{' '}
                  <span className="font-mono text-neutral-300">
                    {srcDims.w}×{srcDims.h}
                  </span>
                </p>
              )}
              <p className="text-neutral-500">
                Vai ficar:{' '}
                <span className="font-mono text-violet-300">
                  {dims ? `${dims.width}×${dims.height}` : 'tamanho original'}
                </span>
              </p>
              {format.kind !== 'original' && (
                <p className="leading-snug text-neutral-600">
                  A imagem é redimensionada para essas dimensões exatas, com
                  qualidade alta.
                </p>
              )}
              {error && <p className="text-red-400">{error}</p>}
            </div>
          </div>

          {/* Seletor de formato */}
          <CoverFormatPicker value={format} onChange={setFormat} aspect={aspect} />
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-800 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
