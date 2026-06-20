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
import { btnSecondary, btnSecondarySm, fieldClassName } from '@/components/button'

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

/** Countdown legível do teto (#132): horas (arredonda p/ cima) ou minutos quando < 1h. */
function formatCountdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes >= 60) return `${Math.ceil(minutes / 60)}h`
  return `${minutes}min`
}

export function RecipeImageManager({
  recipeId,
  hasImage,
  reviewSuggested = false,
  aiGenEnabled = true,
}: {
  recipeId: string
  hasImage: boolean
  /**
   * #131: a versão atual herdou a imagem (carry-forward) E uma mudança VISUAL (título/ingredientes/
   * cozinha) tornou a foto possivelmente desatualizada ⇒ destaca um aviso sugerindo revisar. Só
   * relevante quando há imagem (sem foto, nada a revisar).
   */
  reviewSuggested?: boolean
  /**
   * #134: geração de imagem por IA LIGADA na config do admin (a view do dono carrega o flag). `false`
   * ⇒ esconde a ação "Gerar com IA" (o upload de foto continua). Default `true` (a view sempre traz o
   * flag p/ o dono; o default só protege contra ausência). O servidor reimpõe o gate (403).
   */
  aiGenEnabled?: boolean
}) {
  const { messages } = useLocale()
  const m = messages.detalhe
  const router = useRouter()

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<ImageError>(null)
  // #132: geração por IA — erro próprio ('falha'|'limite'|'desabilitada') + countdown no teto.
  const [genError, setGenError] = useState<null | 'falha' | 'limite' | 'desabilitada'>(null)
  const [countdown, setCountdown] = useState('')
  const [prompt, setPrompt] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = status === 'busy'

  // #132: gera a imagem por IA. `promptOverride` (refino) opcional ⇒ um-clique monta da receita.
  async function onGenerate(promptOverride?: string) {
    setGenError(null)
    setError(null)
    setStatus('busy')
    try {
      const res = await fetch(`/api/recipes/${recipeId}/image/generate`, {
        method: 'POST',
        headers: promptOverride ? { 'content-type': 'application/json' } : undefined,
        body: promptOverride ? JSON.stringify({ prompt: promptOverride }) : undefined,
      })
      if (res.status === 429) {
        const b = (await res.json().catch(() => ({}))) as { retryAfterMs?: number }
        setCountdown(formatCountdown(b.retryAfterMs ?? 0))
        setGenError('limite')
        setStatus('idle')
        return
      }
      // #134: geração desligada na config (corrida: desligaram depois do render). 403 → aviso próprio.
      if (res.status === 403) {
        setGenError('desabilitada')
        setStatus('idle')
        return
      }
      if (!res.ok) {
        setGenError('falha')
        setStatus('idle')
        return
      }
      setStatus('idle')
      router.refresh() // relê a page server → o hero reflete a imagem gerada
    } catch {
      setGenError('falha')
      setStatus('idle')
    }
  }

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

      {/* #131: aviso de revisão quando a versão mudou visualmente e herdou a foto antiga. */}
      {reviewSuggested && hasImage && (
        <p
          role="status"
          className="max-w-[60ch] rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m.imagemRevisar}
        </p>
      )}

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
        {/* #132: gerar por IA com UM CLIQUE (prompt montado da receita no servidor).
            #134: escondido quando a geração está desligada na config do admin (`aiGenEnabled=false`). */}
        {aiGenEnabled && (
          <button
            type="button"
            onClick={() => onGenerate()}
            disabled={busy}
            className={btnSecondarySm}
          >
            {busy ? m.imagemGerando : m.imagemGerar}
          </button>
        )}
        {hasImage && (
          <button type="button" onClick={onRemove} disabled={busy} className={btnSecondarySm}>
            {m.imagemRemover}
          </button>
        )}
      </div>

      {/* #132: refino opcional — prompt editável (disclosure). O default já é o um-clique acima.
          #134: escondido junto com o botão de gerar quando a geração está desligada (`aiGenEnabled`). */}
      {aiGenEnabled && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">{m.imagemRefinar}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <label htmlFor="imagem-prompt" className="sr-only">
              {m.imagemPromptRotulo}
            </label>
            <textarea
              id="imagem-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={m.imagemPromptPlaceholder}
              rows={3}
              className={`${fieldClassName} resize-y`}
            />
            <button
              type="button"
              onClick={() => onGenerate(prompt.trim() || undefined)}
              disabled={busy}
              className={`${btnSecondarySm} self-start`}
            >
              {busy ? m.imagemGerando : m.imagemGerarComPrompt}
            </button>
          </div>
        </details>
      )}

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
        {/* #132: erro/limite da geração por IA. */}
        {genError === 'falha' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemGerarErro}
          </p>
        )}
        {genError === 'limite' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemLimite.replace('{tempo}', countdown)}
          </p>
        )}
        {/* #134: geração desligada na config (corrida de toggle pós-render). */}
        {genError === 'desabilitada' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemGerarDesabilitada}
          </p>
        )}
      </div>
    </section>
  )
}
