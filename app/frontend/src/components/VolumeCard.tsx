// Card de volume individual — nome editável, capa, capítulos como chips, pull-next.

import { useRef, useState, type ChangeEvent } from 'react'
import { ArrowRight, ImagePlus, Trash2, X } from 'lucide-react'
import type { Chapter } from '~/api/client'

/** Estado local de um volume no VolumeBuilder. */
export interface Volume {
  /** Chave local estável (não enviada ao backend). */
  id: string
  /** Nome editável, ex.: "V001". Enviado ao backend como nome do volume. */
  name: string
  /**
   * Rótulo original da fonte, ex.: "Volume 15".
   * Apenas informativo — não é enviado ao backend.
   */
  label?: string
  /** Capítulos na ordem de atribuição. */
  chapters: Chapter[]
  /**
   * Capa como data URL base64 (qualquer formato).
   * O backend converte para JPG e salva como 001.jpg do primeiro capítulo.
   */
  coverImage: string | null
}

function chapterRange(chapters: Chapter[]): string {
  if (chapters.length === 0) return '—'
  const sorted = [...chapters].sort(
    (a, b) => parseFloat(a.number) - parseFloat(b.number),
  )
  const first = sorted[0].number
  const last = sorted[sorted.length - 1].number
  return first === last ? `Cap. ${first}` : `Cap. ${first}–${last}`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'))
    reader.readAsDataURL(file)
  })
}

interface VolumeCardProps {
  volume: Volume
  /** Quantos capítulos estão disponíveis para adicionar (não atribuídos). */
  unassignedCount: number
  onRename: (name: string) => void
  onRemoveChapter: (chapterId: string) => void
  onCoverChange: (dataUrl: string | null) => void
  onRemove: () => void
  /** Puxa os próximos n capítulos não atribuídos para este volume. */
  onPullNext: (n: number) => void
}

export function VolumeCard({
  volume,
  unassignedCount,
  onRename,
  onRemoveChapter,
  onCoverChange,
  onRemove,
  onPullNext,
}: VolumeCardProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pullN, setPullN] = useState('10')
  const [coverError, setCoverError] = useState<string | null>(null)

  async function handleCoverFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverError(null)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      onCoverChange(dataUrl)
    } catch (err) {
      setCoverError(
        err instanceof Error ? err.message : 'Erro ao carregar imagem',
      )
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const range = chapterRange(volume.chapters)
  const count = volume.chapters.length
  const pullNParsed = Math.max(
    1,
    Math.min(parseInt(pullN, 10) || 1, unassignedCount),
  )

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-700/60 bg-neutral-900">
      {/* Cabeçalho do card */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <input
          value={volume.name}
          onChange={(e) => onRename(e.target.value)}
          className="w-24 rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1 font-mono text-sm font-bold text-neutral-100 focus:border-neutral-500 focus:outline-none"
          aria-label="Nome do volume"
        />
        {volume.label && (
          <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs text-neutral-500">
            {volume.label}
          </span>
        )}
        <span className="text-sm text-neutral-500">
          {count > 0 ? (
            <>
              <span className="font-medium text-neutral-300">{count}</span>{' '}
              {count === 1 ? 'cap.' : 'caps.'}{' '}
              <span className="text-neutral-700">·</span> {range}
            </>
          ) : (
            <span className="italic text-neutral-700">vazio</span>
          )}
        </span>
        <button
          onClick={onRemove}
          type="button"
          className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-red-950/40 hover:text-red-400"
          aria-label={`Remover volume ${volume.name}`}
        >
          <Trash2 size={13} aria-hidden="true" />
          Remover
        </button>
      </div>

      {/* Corpo do card */}
      <div className="flex gap-4 p-4">
        {/* Área da capa */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative flex h-[7.5rem] w-20 items-center justify-center overflow-hidden rounded-lg border border-dashed border-neutral-700 bg-neutral-800/60 transition hover:border-neutral-500 hover:bg-neutral-800"
            title={volume.coverImage ? 'Trocar capa' : 'Adicionar capa'}
            aria-label={
              volume.coverImage
                ? `Trocar capa de ${volume.name}`
                : `Adicionar capa para ${volume.name}`
            }
          >
            {volume.coverImage ? (
              <>
                <img
                  src={volume.coverImage}
                  alt={`Capa de ${volume.name}`}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100">
                  <ImagePlus size={20} className="text-white" aria-hidden="true" />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-neutral-700">
                <ImagePlus size={22} aria-hidden="true" />
                <span className="px-1 text-center text-[10px] leading-tight">
                  capa
                </span>
              </div>
            )}
          </button>
          {volume.coverImage && (
            <button
              type="button"
              onClick={() => onCoverChange(null)}
              className="text-[11px] text-neutral-600 transition-colors hover:text-neutral-400"
            >
              Remover capa
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleCoverFile}
            aria-label={`Escolher capa para ${volume.name}`}
          />
          {coverError && (
            <p className="w-20 text-center text-[10px] leading-tight text-red-400">
              {coverError}
            </p>
          )}
          <p className="w-20 text-center text-[10px] leading-tight text-neutral-700">
            vira pág. 001 do 1º cap.
          </p>
        </div>

        {/* Chips dos capítulos */}
        <div className="min-w-0 flex-1 space-y-3">
          {count > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {volume.chapters.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-700/60 bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
                >
                  <span className="font-medium">Cap. {c.number}</span>
                  {c.title && c.title !== c.number && (
                    <span className="max-w-[7rem] truncate text-neutral-500">
                      {' '}
                      — {c.title}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveChapter(c.id)}
                    className="ml-0.5 rounded text-neutral-600 transition-colors hover:text-red-400"
                    aria-label={`Remover capítulo ${c.number} do volume`}
                  >
                    <X size={10} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-neutral-700">
              Nenhum capítulo. Use o painel à esquerda ou "Adicionar próximos"
              abaixo.
            </p>
          )}

          {/* Adicionar próximos N capítulos */}
          {unassignedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800/60 pt-2.5">
              <span className="text-xs text-neutral-600">
                Adicionar próximos
              </span>
              <input
                type="number"
                value={pullN}
                min="1"
                max={unassignedCount}
                onChange={(e) => setPullN(e.target.value)}
                className="w-14 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1 text-center text-xs focus:border-neutral-500 focus:outline-none"
                aria-label="Quantidade de capítulos a adicionar"
              />
              <button
                type="button"
                onClick={() => onPullNext(pullNParsed)}
                className="flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs transition-colors hover:bg-neutral-700"
              >
                cap.
                <ArrowRight size={11} aria-hidden="true" />
              </button>
              <span className="text-[11px] text-neutral-700">
                ({unassignedCount} disponíveis)
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
