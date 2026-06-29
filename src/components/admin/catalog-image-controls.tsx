'use client'
/**
 * Estúdio de imagem do CATÁLOGO na fila de curadoria (#238, ADR-0026 emenda dec.10) — variante CURADOR
 * do `RecipeImageManager`. Diferenças vs. o estúdio do DONO: fala com as rotas de CURADOR
 * (`/api/curate/recipes/[id]/image*`), levanta a galeria pra CLIENT STATE e re-renderiza do RETORNO de
 * cada mutação (a fila é client-fetched ⇒ `router.refresh()` não re-busca — achado do plan-review), e a
 * GERAÇÃO auto-seleciona a face (catálogo não tem "preview"). Op destrutiva única = apagar (bloqueada
 * se a imagem ainda é a face — 409). Tokens neutros (espelha as outras filas do Curador).
 */
import { useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { resizeImage } from '@/lib/image-resize'
import { Button } from '@/components/ui/button'
import type { GalleryImage } from '@/domain/recipe-read'

const ACCEPT = 'image/jpeg,image/png,image/webp'
const MAX_BYTES = 2 * 1024 * 1024
const MAX_DIM = 1280

export function CatalogImageControls({
  recipeId,
  initialGallery,
}: {
  recipeId: string
  initialGallery: GalleryImage[]
}) {
  const { messages } = useLocale()
  const m = messages.curadoria
  const [gallery, setGallery] = useState<GalleryImage[]>(initialGallery)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const face = gallery.find((g) => g.selected) ?? null

  /** Roda uma mutação que devolve `{ gallery }`; atualiza o estado local. `body`/headers opcionais. */
  async function mutate(url: string, init: RequestInit): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, init)
      if (!res.ok) {
        setError(m.filaImagemErro)
        return
      }
      const body = (await res.json()) as { gallery: GalleryImage[] }
      setGallery(body.gallery)
    } catch {
      setError(m.filaImagemErro)
    } finally {
      setBusy(false)
    }
  }

  const gen = () =>
    mutate(`/api/curate/recipes/${recipeId}/image/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

  const select = (imageId: string) =>
    mutate(`/api/curate/recipes/${recipeId}/images/${imageId}/select`, { method: 'POST' })

  const removeImg = (imageId: string) =>
    mutate(`/api/curate/recipes/${recipeId}/images/${imageId}`, { method: 'DELETE' })

  const deselect = () => mutate(`/api/curate/recipes/${recipeId}/image`, { method: 'DELETE' })

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-selecionar o mesmo arquivo
    if (!file) return
    if (!ACCEPT.split(',').includes(file.type)) {
      setError(m.filaImagemTipoInvalido)
      return
    }
    let blob: Blob = file
    try {
      blob = await resizeImage(file, { maxDim: MAX_DIM })
    } catch {
      // resize best-effort — sobe o original se o canvas falhar (a rota re-valida tipo/tamanho).
    }
    if (blob.size > MAX_BYTES) {
      setError(m.filaImagemGrande)
      return
    }
    const form = new FormData()
    form.append('file', blob, file.name)
    await mutate(`/api/curate/recipes/${recipeId}/image`, { method: 'POST', body: form })
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-bg px-3 py-3">
      <div className="flex items-start gap-3">
        {/* Face atual (ou placeholder). */}
        {face ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={face.url}
            alt=""
            className="h-20 w-20 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted">
            {m.filaImagemSemFoto}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void gen()} disabled={busy} aria-busy={busy}>
            {busy ? messages.system.loading : face ? m.filaImagemGerarOutra : m.filaImagemGerar}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {m.filaImagemSubir}
          </Button>
          {face && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void deselect()} disabled={busy}>
              {m.filaImagemRemover}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => void onPickFile(e)}
            className="hidden"
          />
        </div>
      </div>

      {/* Galeria (re-selecionável). Aparece com ≥ 2 itens (1 já é a face acima) OU com 1 item SEM face
          selecionada (code-review M3: senão a única imagem deselecionada fica inalcançável p/ re-usar). */}
      {(gallery.length > 1 || (gallery.length === 1 && !face)) && (
        <ul className="flex flex-wrap gap-2">
          {gallery.map((img) => (
            <li key={img.id} className="relative">
              <button
                type="button"
                onClick={() => void select(img.id)}
                disabled={busy || img.moderated}
                aria-label={img.selected ? m.filaImagemFaceAtual : m.filaImagemUsarEsta}
                aria-pressed={img.selected}
                className={`block h-14 w-14 overflow-hidden rounded-md border ${
                  img.selected ? 'border-brand-strong' : 'border-border'
                } disabled:opacity-50`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-full w-full object-cover" />
              </button>
              {!img.selected && (
                <button
                  type="button"
                  onClick={() => void removeImg(img.id)}
                  disabled={busy}
                  aria-label={m.filaImagemApagar}
                  className="absolute -right-1 -top-1 rounded-full border border-border bg-bg px-1 text-xs text-fg"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg">
          {error}
        </p>
      )}
    </div>
  )
}
