'use client'
/**
 * Estúdio de imagem da receita (#130/#132/#222, ADR-0016/0017/0022) — bloco do DONO. Irmão do
 * `RecipeDetailView` (PURO): a page o renderiza SÓ quando `view.canManage` (dono). Espelha a
 * disciplina do `RecipeVisibilityControls` (consome ROUTE HANDLER via `fetch` — ADR-0010 — e
 * `router.refresh()` ao mudar) e do `AvatarUploader` (#126: valida tipo no client + REDIMENSIONA
 * antes de subir). O servidor é a verdade (ownership, lineage, ref-count, tipo/tamanho); isto é
 * afordância.
 *
 * #222 (galeria re-selecionável + preview):
 *  - "Gerar com IA" abre um MODAL de PREVIEW (Sheet center): gera → mostra a imagem; "Usar esta"
 *    SELECIONA a face (POST .../select → refresh, fecha); "Gerar outra" gera de novo e troca o
 *    preview (as anteriores ficam na galeria server-side, deselecionadas). A face NÃO muda até
 *    "Usar esta". DECISION 6: se houve ≥1 geração e o dono fecha SEM selecionar, chamamos
 *    `router.refresh()` no fechar (os previews já estão persistidos ⇒ a galeria server-rendered
 *    reflete-os; senão "cadê minhas gerações").
 *  - GALERIA: thumbnails (uploads + geradas) com selo "✨ gerada por IA"; clicar SELECIONA; apagar
 *    APAGA (DELETE .../images/[imageId]); 409 in_use ⇒ mensagem amigável (a deleção da face em uso
 *    é bloqueada — a UI também desabilita apagar na selecionada).
 *  - Upload (Adicionar/Trocar) auto-seleciona; "Remover foto" DESSELECIONA (volta ao placeholder).
 */
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { resizeImage } from '@/lib/image-resize'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import type { GalleryImage } from '@/domain/recipe-read'
// #223: cap do refino vem do domínio (módulo client-safe: puro, sem DB/IO) — evita drift cliente/servidor.
import { IMAGE_PROMPT_OVERRIDE_MAX } from '@/domain/image-prompt'

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

/** Imagem-preview devolvida por POST .../image/generate (#222/#223): `{ image, basePrompt }`. */
type PreviewImage = { id: string; url: string; aiGenerated: boolean }

export function RecipeImageManager({
  recipeId,
  hasImage,
  gallery = [],
  reviewSuggested = false,
  aiGenEnabled = true,
  imageGenBlocked = false,
}: {
  recipeId: string
  hasImage: boolean
  /**
   * #222: galeria de imagens da linhagem (uploads + geradas), owner-gated na view. Os thumbnails
   * permitem selecionar/apagar. Default `[]` (defensivo: a view sempre traz a galeria pro dono).
   */
  gallery?: ReadonlyArray<GalleryImage>
  /**
   * #131: a versão atual herdou a imagem (carry-forward) E uma mudança VISUAL (título/ingredientes/
   * cozinha) tornou a foto possivelmente desatualizada ⇒ destaca um aviso sugerindo revisar. Só
   * relevante quando há imagem (sem foto, nada a revisar).
   */
  reviewSuggested?: boolean
  /**
   * #134: geração de imagem por IA LIGADA na config do admin (a view do dono carrega o flag). `false`
   * ⇒ esconde a ação "Gerar com IA" (o upload de foto continua). Default `true`. O servidor reimpõe o gate (403).
   */
  aiGenEnabled?: boolean
  /**
   * #226 (ADR-0022 dec.3 / 1º gancho do ADR-0007): o Curador BLOQUEOU a geração-de-imagem-por-IA DESTE
   * usuário (abuso confirmado). `true` ⇒ esconde "Gerar com IA" + mostra uma nota clara (role=status).
   * DISTINTO de `aiGenEnabled=false` (config-global do admin): este é a restrição por-CONTA. O upload de
   * foto SEGUE funcionando (a restrição é só sobre a geração-por-IA). Default `false`. O servidor é a
   * verdade (403 geracao_bloqueada — coberto em `onGenerate` como defesa-em-profundidade).
   */
  imageGenBlocked?: boolean
}) {
  const { messages } = useLocale()
  const m = messages.detalhe
  const router = useRouter()

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<ImageError>(null)
  // #132: geração por IA — erro próprio ('falha'|'limite'|'desabilitada'|'bloqueada') + countdown no teto.
  // #226: 'bloqueada' = o Curador bloqueou a geração-por-IA deste usuário (defesa-em-profundidade no modal).
  const [genError, setGenError] = useState<null | 'falha' | 'limite' | 'desabilitada' | 'bloqueada'>(null)
  const [countdown, setCountdown] = useState('')
  // #222: estado do modal de preview.
  const [modalOpen, setModalOpen] = useState(false)
  const [preview, setPreview] = useState<PreviewImage | null>(null)
  // #223: refino ancorado — campo de refino livre, base read-only (revelado por botão), e o
  // prompt-base devolvido pelo servidor (o cliente NUNCA envia o base; só o refino).
  const [refino, setRefino] = useState('')
  const [showRefino, setShowRefino] = useState(false)
  const [basePrompt, setBasePrompt] = useState<string | null>(null)
  // DECISION 6: houve ≥1 geração nesta sessão de modal? ⇒ refresh ao fechar sem selecionar.
  const [generatedThisSession, setGeneratedThisSession] = useState(false)
  // #222/#225: erro de seleção/deleção na galeria ('falha'|'emUso'|'moderada').
  const [galleryError, setGalleryError] = useState<null | 'falha' | 'emUso' | 'moderada'>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = status === 'busy'
  // #225 (US21): a face pública atual (a imagem selecionada) foi moderada ⇒ o público vê um placeholder
  // (gate #133). Sugere ao dono escolher outra como capa.
  const selectedModerated = gallery.some((g) => g.selected && g.moderated)

  // #132/#222/#223: gera a imagem por IA como PREVIEW (acrescenta à galeria deselecionada; devolve
  // `{ image, basePrompt }`). O cliente envia SÓ o refino (texto livre, cap 200) — o servidor sempre
  // re-deriva e re-compõe o base (#214); base read-only nunca é postado.
  async function onGenerate() {
    setGenError(null)
    setError(null)
    setStatus('busy')
    try {
      const trimmed = refino.trim()
      const res = await fetch(`/api/recipes/${recipeId}/image/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(trimmed ? { prompt: trimmed } : {}),
      })
      if (res.status === 429) {
        const b = (await res.json().catch(() => ({}))) as { retryAfterMs?: number }
        setCountdown(formatCountdown(b.retryAfterMs ?? 0))
        setGenError('limite')
        setStatus('idle')
        return
      }
      // 403 → aviso próprio por motivo. #226: o Curador bloqueou a geração-por-IA deste usuário
      // (`geracao_bloqueada`) — distinto de #134 `geracao_desabilitada` (config-global do admin).
      // Defesa-em-profundidade: a UI já esconde o botão ao bloqueado, mas o servidor é a verdade.
      if (res.status === 403) {
        const b = (await res.json().catch(() => ({}))) as { error?: string }
        setGenError(b.error === 'geracao_bloqueada' ? 'bloqueada' : 'desabilitada')
        setStatus('idle')
        return
      }
      if (!res.ok) {
        setGenError('falha')
        setStatus('idle')
        return
      }
      const body = (await res.json().catch(() => ({}))) as { image?: PreviewImage; basePrompt?: string }
      if (body.image) setPreview(body.image)
      // #223: guarda o prompt-base devolvido (pro reveal read-only). Vem do servidor a cada geração.
      if (typeof body.basePrompt === 'string') setBasePrompt(body.basePrompt)
      setGeneratedThisSession(true) // DECISION 6: a galeria server-side mudou
      setStatus('idle')
    } catch {
      setGenError('falha')
      setStatus('idle')
    }
  }

  /** "Gerar com IA": abre o modal e dispara a 1ª geração (refino vazio ⇒ um-clique). */
  function onOpenModal() {
    setPreview(null)
    setGenError(null)
    setGeneratedThisSession(false)
    // #223: estado de refino zerado a cada abertura (não persiste entre sessões de modal).
    setRefino('')
    setShowRefino(false)
    setBasePrompt(null)
    setModalOpen(true)
    void onGenerate()
  }

  /** Fecha o modal; DECISION 6: refresh se houve geração e nada foi selecionado (face inalterada). */
  function onModalOpenChange(open: boolean) {
    setModalOpen(open)
    if (!open) {
      if (generatedThisSession) router.refresh()
      setGeneratedThisSession(false)
      setPreview(null)
      // #223: reset do refino ao fechar (a próxima abertura começa limpa).
      setRefino('')
      setShowRefino(false)
      setBasePrompt(null)
    }
  }

  /** "Usar esta": SELECIONA o preview como face → refresh, fecha (sem o refresh do close). */
  async function onUseThis() {
    if (!preview) return
    setStatus('busy')
    try {
      const res = await fetch(`/api/recipes/${recipeId}/images/${preview.id}/select`, { method: 'POST' })
      if (!res.ok) {
        setGenError('falha')
        setStatus('idle')
        return
      }
      setStatus('idle')
      setModalOpen(false)
      setGeneratedThisSession(false) // já demos refresh; evita um 2º no close
      setPreview(null)
      router.refresh()
    } catch {
      setGenError('falha')
      setStatus('idle')
    }
  }

  /** Galeria: SELECIONA uma imagem existente (clicar no thumbnail). */
  async function onSelect(imageId: string) {
    setGalleryError(null)
    setStatus('busy')
    try {
      const res = await fetch(`/api/recipes/${recipeId}/images/${imageId}/select`, { method: 'POST' })
      // #225: 409 imagem_moderada — uma imagem moderada (#133) não vira face pública (o servidor é a
      // verdade; a UI já desabilita selecionar a moderada, mas cobre a corrida de moderar-no-meio).
      if (res.status === 409) {
        setGalleryError('moderada')
        setStatus('idle')
        return
      }
      if (!res.ok) {
        setGalleryError('falha')
        setStatus('idle')
        return
      }
      setStatus('idle')
      router.refresh()
    } catch {
      setGalleryError('falha')
      setStatus('idle')
    }
  }

  /** Galeria: APAGA uma imagem (409 in_use ⇒ mensagem amigável, nada destruído). */
  async function onDelete(imageId: string) {
    setGalleryError(null)
    setStatus('busy')
    try {
      const res = await fetch(`/api/recipes/${recipeId}/images/${imageId}`, { method: 'DELETE' })
      if (res.status === 409) {
        setGalleryError('emUso')
        setStatus('idle')
        return
      }
      if (!res.ok) {
        setGalleryError('falha')
        setStatus('idle')
        return
      }
      setStatus('idle')
      router.refresh()
    } catch {
      setGalleryError('falha')
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

      {/* #225 (US21): a face SELECIONADA foi moderada — o público vê um placeholder; nudge p/ escolher outra. */}
      {selectedModerated && (
        <p
          role="status"
          className="max-w-[60ch] rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m.imagemSelecionadaModerada}
        </p>
      )}

      {/* #226 (ADR-0022 dec.3): o Curador BLOQUEOU a geração-de-imagem-por-IA deste usuário (abuso
          confirmado) ⇒ nota clara (role=status) + esconde "Gerar com IA" abaixo. O upload SEGUE. */}
      {imageGenBlocked && (
        <p
          role="status"
          className="max-w-[60ch] rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m.imagemGerarBloqueadaNota}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* #222: "Gerar com IA" abre o MODAL de preview (#207: ação primária, antes do upload).
            #134: escondido quando a geração está desligada na config do admin (`aiGenEnabled=false`).
            #226: também escondido quando o Curador bloqueou a geração-por-IA deste usuário (a nota
            acima explica). O upload SEGUE — a restrição é só sobre a geração-por-IA. */}
        {aiGenEnabled && !imageGenBlocked && (
          <Button type="button" variant="secondary" size="sm" onClick={onOpenModal} disabled={busy}>
            {m.imagemGerar}
          </Button>
        )}
        <Button
          asChild
          variant="secondary"
          className={busy ? 'cursor-not-allowed opacity-70 pointer-events-none' : 'cursor-pointer'}
        >
          <label>
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
        </Button>
        {hasImage && (
          <Button type="button" variant="secondary" size="sm" onClick={onRemove} disabled={busy}>
            {m.imagemRemover}
          </Button>
        )}
      </div>

      {/* #222: GALERIA re-selecionável (uploads + geradas). Clicar SELECIONA; apagar APAGA. */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted">{m.imagemGaleria}</h3>
        {gallery.length === 0 ? (
          <p className="text-sm text-muted">{m.imagemGaleriaVazia}</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {gallery.map((img) => (
              <li key={img.id} className="flex flex-col items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(img.id)}
                  // #225: imagem moderada (#133) não vira face pública ⇒ select desabilitado por afordância
                  // (o servidor reimpõe — 409 imagem_moderada).
                  disabled={busy || img.selected || img.moderated}
                  aria-pressed={img.selected}
                  className={`relative overflow-hidden rounded-md border ${img.selected ? 'border-brand-ink ring-2 ring-brand-ink' : 'border-border'} ${busy ? 'opacity-70' : ''} ${img.moderated ? 'opacity-60' : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- thumbnail de blob público; sem otimização */}
                  <img src={img.url} alt={m.imagemTitulo} className="size-20 object-cover" />
                  {img.aiGenerated && (
                    <span className="absolute bottom-0 left-0 right-0 bg-fg/60 px-1 py-0.5 text-[10px] text-bg">
                      {m.imagemSeloIa}
                    </span>
                  )}
                  {/* #225: marcador "removida" — distinto do selo de IA (topo, tom de alerta). */}
                  {img.moderated && (
                    <span className="absolute left-0 right-0 top-0 bg-fg/70 px-1 py-0.5 text-[10px] text-bg">
                      {m.imagemRemovida}
                    </span>
                  )}
                </button>
                <div className="flex items-center justify-between gap-1 text-xs">
                  {img.moderated ? (
                    <span className="font-medium text-muted">{m.imagemRemovida}</span>
                  ) : img.selected ? (
                    <span className="font-medium text-fg">{m.imagemSelecionada}</span>
                  ) : (
                    <span className="text-muted">{m.imagemSelecionar}</span>
                  )}
                  {/* A face em uso não pode ser apagada (in_use); desabilita por afordância. */}
                  <button
                    type="button"
                    onClick={() => onDelete(img.id)}
                    disabled={busy || img.selected}
                    className="text-muted underline hover:text-fg disabled:no-underline disabled:opacity-50"
                  >
                    {m.imagemApagar}
                  </button>
                </div>
              </li>
            ))}
          </ul>
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
        {/* #222: erro de seleção/deleção na galeria. */}
        {galleryError === 'falha' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemErro}
          </p>
        )}
        {galleryError === 'emUso' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemApagarEmUso}
          </p>
        )}
        {/* #225: 409 imagem_moderada — tentar selecionar uma imagem moderada como capa. */}
        {galleryError === 'moderada' && (
          <p role="alert" className="font-medium text-fg">
            {m.imagemModeradaNaoSelecionavel}
          </p>
        )}
        {/* #222: os erros da geração (falha/limite/desabilitada) são surfados DENTRO do modal — a
            geração só acontece lá. Não duplicamos aqui (evita mensagem em dobro). */}
      </div>

      {/* #222: MODAL de PREVIEW da geração (Sheet center, precedente recipe-edit-modal). */}
      <Sheet open={modalOpen} onOpenChange={onModalOpenChange}>
        <SheetContent side="center" closeLabel={m.imagemFechar}>
          <SheetHeader>
            <SheetTitle>{m.imagemPreviewTitulo}</SheetTitle>
            <SheetDescription>{m.imagemPreviewDescricao}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col items-center gap-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview de blob público
              <img src={preview.url} alt={m.imagemPreviewTitulo} className="max-h-80 w-auto rounded-md border border-border" />
            ) : (
              <p className="py-8 text-sm text-muted">{busy ? m.imagemGerando : m.imagemGerarErro}</p>
            )}

            <div aria-live="polite" className="text-sm">
              {genError === 'limite' && (
                <p role="alert" className="font-medium text-fg">
                  {m.imagemLimite.replace('{tempo}', countdown)}
                </p>
              )}
              {genError === 'desabilitada' && (
                <p role="alert" className="font-medium text-fg">
                  {m.imagemGerarDesabilitada}
                </p>
              )}
              {/* #226: o Curador bloqueou a geração-por-IA deste usuário (defesa-em-profundidade — o
                  botão já é escondido, mas o servidor é a verdade; cobre a corrida de bloquear no meio). */}
              {genError === 'bloqueada' && (
                <p role="alert" className="font-medium text-fg">
                  {m.imagemGerarBloqueada}
                </p>
              )}
              {genError === 'falha' && (
                <p role="alert" className="font-medium text-fg">
                  {m.imagemGerarErro}
                </p>
              )}
            </div>

            {/* #223: refino ancorado — botão menos-destacado (link) revela o prompt-base read-only
                + um campo de refino livre. O base NUNCA é editável/postado: o cliente envia só o
                refino; o servidor re-deriva e re-compõe o base (template estruturado, #214). */}
            <div className="flex w-full max-w-prose flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowRefino((v) => !v)}
                aria-expanded={showRefino}
                className="self-start text-sm text-muted underline hover:text-fg"
              >
                {m.imagemRefinar}
              </button>
              {showRefino && (
                <div className="flex flex-col gap-2 text-sm">
                  {basePrompt && (
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-muted">{m.imagemPromptBase}</span>
                      {/* Base READ-ONLY: <p> simples (não <output>) — evita role=status/aria-live
                          fazer o leitor de tela anunciar o prompt inteiro ao revelar (a11y, #223).
                          Não é campo editável e nunca é postado: o cliente só envia o refino. */}
                      <p className="block whitespace-pre-wrap rounded-md border border-border bg-bg px-3 py-2 text-muted">
                        {basePrompt}
                      </p>
                    </div>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-fg">{m.imagemPromptRotulo}</span>
                    <textarea
                      value={refino}
                      onChange={(e) => setRefino(e.target.value)}
                      maxLength={IMAGE_PROMPT_OVERRIDE_MAX}
                      rows={2}
                      placeholder={m.imagemPromptPlaceholder}
                      disabled={busy}
                      className="rounded-md border border-border bg-bg px-3 py-2 text-fg"
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button type="button" size="sm" onClick={onUseThis} disabled={busy || !preview}>
                {m.imagemUsarEsta}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={onGenerate} disabled={busy}>
                {busy ? m.imagemGerando : m.imagemGerarOutra}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  )
}
