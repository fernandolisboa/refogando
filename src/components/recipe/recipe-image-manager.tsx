'use client'
/**
 * Gestão da Imagem da receita (#130, ADR-0016) — bloco do DONO para subir/trocar/remover a foto do
 * prato. Irmão do `RecipeDetailView` (que continua PURO): a page de detalhe o renderiza SÓ quando
 * `view.canManage` (dono). Espelha a disciplina do `RecipeVisibilityControls` (consome ROUTE
 * HANDLER via `fetch` — ADR-0010 — e `router.refresh()` ao mudar) e do `AvatarUploader` (#126:
 * valida tipo no client + REDIMENSIONA antes de subir, pra ficar abaixo do limite de body da
 * Vercel). O servidor é a verdade (ownership, ref-count, tipo/tamanho); isto é afordância.
 *
 * Em sucesso, `router.refresh()` relê a page server → o hero do `RecipeDetailView` reflete a nova
 * foto (ou some, na remoção). Sem estado de imagem local: a foto vive na view server-rendered.
 */
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { resizeImage } from '@/lib/image-resize'
import { btnSecondary, btnSecondarySm } from '@/components/button'

const ACCEPT = 'image/jpeg,image/png,image/webp'
/** Cap (2 MB) — espelha MAX_BYTES da rota; barra cedo um arquivo grande pós-resize. */
const MAX_BYTES = 2 * 1024 * 1024
/** Maior dimensão do prato (px): maior que o avatar (foto hero, não miniatura). */
const MAX_DIM = 1280

type Status = 'idle' | 'busy'
type ImageError = null | 'tipo' | 'grande' | 'falha'

function extFor(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpg'
  return 'webp'
}

export function RecipeImageManager({
  recipeId,
  hasImage,
}: {
  recipeId: string
  hasImage: boolean
}) {
  const { messages } = useLocale()
  const m = messages.detalhe
  const router = useRouter()

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<ImageError>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = status === 'busy'

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('tipo')
      resetInput()
      return
    }
    setStatus('busy')
    try {
      const blob = await resizeImage(file, { maxDim: MAX_DIM })
      if (blob.size > MAX_BYTES) {
        setError('grande')
        setStatus('idle')
        return
      }
      const fd = new FormData()
      fd.append('file', blob, `prato.${extFor(blob.type)}`)
      const res = await fetch(`/api/recipes/${recipeId}/image`, { method: 'POST', body: fd })
      if (!res.ok) {
        setError('falha')
        setStatus('idle')
        return
      }
      setStatus('idle')
      router.refresh() // relê a page server → o hero reflete a nova foto
    } catch {
      setError('falha')
      setStatus('idle')
    } finally {
      resetInput()
    }
  }

  async function onRemove() {
    setError(null)
    setStatus('busy')
    try {
      const res = await fetch(`/api/recipes/${recipeId}/image`, { method: 'DELETE' })
      if (!res.ok) {
        setError('falha')
        setStatus('idle')
        return
      }
      setStatus('idle')
      router.refresh()
    } catch {
      setError('falha')
      setStatus('idle')
    }
  }

  /** Limpa o input pra permitir re-selecionar o MESMO arquivo (onChange só dispara se muda). */
  function resetInput() {
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <section
      aria-labelledby="imagem-titulo"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <div className="flex flex-col gap-1">
        <h2 id="imagem-titulo" className="font-display text-lg font-semibold text-fg">
          {m.imagemTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.imagemDescricao}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`${busy ? 'cursor-not-allowed opacity-70 pointer-events-none' : 'cursor-pointer'} ${btnSecondary}`}
        >
          {busy ? m.imagemEnviando : hasImage ? m.imagemTrocar : m.imagemAdicionar}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={onPick}
            disabled={busy}
            className="sr-only"
          />
        </label>
        {hasImage && (
          <button type="button" onClick={onRemove} disabled={busy} className={btnSecondarySm}>
            {m.imagemRemover}
          </button>
        )}
      </div>

      <div aria-live="polite" className="text-sm">
        {error === 'tipo' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemTipoInvalido}
          </p>
        )}
        {error === 'grande' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemGrande}
          </p>
        )}
        {error === 'falha' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemErro}
          </p>
        )}
      </div>
    </section>
  )
}
