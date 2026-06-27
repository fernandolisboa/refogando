'use client'
/**
 * Edição IN-PLACE + Apagar a PRÓPRIA Receita (#21 UI / #61). Prefilled a partir da `RecipeView`
 * (que a rota já resolveu no locale pedido). No modo own edita a MESMA linha via
 * `PATCH /api/recipes/[id]` (NUNCA forka); Apagar é `DELETE /api/recipes/[id]` atrás de um diálogo
 * de irreversibilidade. #196/ADR-0021: o MESMO form, com `mode="derive"`, deriva uma Receita
 * NÃO-própria (POST /api/recipes/[id]/derive — a base nunca é mutada — e navega pra nova).
 *
 * ADR-0010: consome os ROUTE HANDLERS via `fetch`; o servidor é a verdade (reimpõe ownership/
 * allowlist). Confirmação de editar PÚBLICA (história #277): quando a Receita é pública, o Salvar
 * abre o diálogo de confirmação ANTES do PATCH (a mudança fica visível a quem favoritou).
 *
 * Diálogo (apagar E confirmar-pública): `role="dialog"` + `aria-modal`, fecha no Escape, foco
 * inicial no botão primário e foco RETORNA ao gatilho ao fechar (trap simples — Tab cicla entre
 * os dois botões do diálogo). Tokens NEUTROS (âmbar é exclusivo do Aviso de restrição, ADR-0004).
 *
 * Sem `<h1>` (o detalhe já o emite): o bloco abre num `<h2>`.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fieldClassName } from '@/components/button'
import {
  CATEGORIAS,
  RESTRICOES,
  UNIDADES,
  PORCOES,
  DIFICULDADE,
  TEMPO_MIN,
} from '@/domain/vocabulary'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import type { RecipeView } from '@/domain/recipe-read'

/** Rascunho de UM ingrediente no formulário (espelha o create estruturado, sem força). */
type ItemDraft = { rawText: string; quantidade: string; unidade: string }

type Dialog = 'none' | 'confirmPublic' | 'confirmDelete'

/** Prefill dos itens a partir da view (quantidade volta como string do numeric). */
function itemsFromView(view: RecipeView): ItemDraft[] {
  const items = [...view.ingredients]
    .sort((a, b) => a.ordem - b.ordem)
    .map((it) => ({
      rawText: it.rawText ?? '',
      quantidade: it.quantidade ?? '',
      unidade: it.unidade ?? '',
    }))
  return items.length > 0 ? items : [{ rawText: '', quantidade: '', unidade: '' }]
}

/**
 * #192/ADR-0021: o form vive DENTRO do modal centrado (`RecipeEditModal`). `onSaved` fecha o
 * modal após o PATCH dar certo; `onCancel` é o botão Cancelar do rodapé do modal. Sem essas
 * props o form se auto-renderiza (compat) com o próprio `<h2>`. Apagar navega pra fora (não
 * precisa de `onSaved`).
 *
 * #197 (fix da regressão de perda-de-dados): o diálogo de confirmação INTERNO (apagar / editar
 * pública) é um `role="dialog"` próprio renderizado SOBRE o `Sheet` (Radix Dialog) do modal. O
 * Radix escuta o Escape em CAPTURE no document, então fecharia o Sheet inteiro (descartando o
 * rascunho) ANTES do nosso handler. Por isso o form SINALIZA o estado de confirm-aberto pra cima
 * via `onConfirmOpenChange`: o `RecipeEditModal` usa esse sinal pra `preventDefault()` o
 * Escape/click-fora do `SheetContent` enquanto o confirm está aberto — assim o Escape só fecha o
 * confirm (via `onDialogKeyDown`), nunca o modal. Fora do modal (compat) o callback é no-op.
 */
export function RecipeEditForm({
  view,
  mode = 'own',
  locale: deriveLocale,
  onSaved,
  onCancel,
  onConfirmOpenChange,
}: {
  view: RecipeView
  /**
   * #196/ADR-0021: `'own'` (default) = editar IN-PLACE (PATCH a mesma Receita); `'derive'` =
   * derivar uma Receita NÃO-própria (POST /derive — a base NUNCA é mutada — e navega pra nova).
   * No modo derive, o toggle de Visibilidade e o Apagar ficam ESCONDIDOS (a derivada ainda não
   * existe pra publicar e a base não é sua).
   */
  mode?: 'own' | 'derive'
  /** Locale do POST /derive (`?locale`); ignorado no modo own (usa o locale atual do provider). */
  locale?: string
  onSaved?: () => void
  onCancel?: () => void
  onConfirmOpenChange?: (open: boolean) => void
}) {
  // O locale do PATCH é o ATUAL (o usuário pode trocar o idioma no rodapé no meio da edição —
  // a prop estática do servidor ficaria obsoleta e o PATCH atingiria a tradução errada). Espelha
  // como o create estruturado usa `useLocale().locale` no fetch.
  const { locale: currentLocale, messages } = useLocale()
  const m = messages.edicaoPropria
  const mc = messages.criar // reusa rótulos de campo do create
  const cozinhaVocab = useCozinhaVocab() // #317: opções de cozinha do leitor data-driven
  const router = useRouter()
  const isDerive = mode === 'derive'

  // Visibilidade ATUAL no servidor (prefill do toggle rascunho). `view.visibility` é owner-gated:
  // sempre presente no detalhe do dono; default defensivo 'private' se faltar.
  const initialPublic = view.visibility === 'public'
  // #196: no modo derive, a base pode ser pública (de outro), mas isso NÃO aciona o confirm #277
  // (derivar não muta a base) — o confirm é exclusivo do modo own.
  const isPublic = !isDerive && initialPublic

  // #195/ADR-0021 (decisão 4): o toggle de Visibilidade é RASCUNHO LOCAL — clicar NÃO chama o
  // servidor. O Salvar comita: PATCH do conteúdo primeiro; SÓ se isto difere do estado inicial,
  // POST publish/unpublish por request separado (a fronteira de `owner-edit.ts` nunca toca
  // visibility). web_imported (#168/ADR-0019) e playful (ADR-0013) NUNCA publicam → toggle ESCONDIDO
  // (o gate de servidor segue valendo; um 422 que escape é tratado in-modal). #196: no modo derive
  // a derivada ainda NÃO existe (sem id pra publish/unpublish) → toggle SEMPRE escondido; ela nasce
  // privada e o Usuário publica depois, no detalhe dela.
  const isWebImported = view.origin === 'web_imported'
  const isPlayful = view.resultKind === 'playful'
  const showVisibilityToggle = !isDerive && !isWebImported && !isPlayful
  const [draftPublic, setDraftPublic] = useState(initialPublic)

  // ── Estado do formulário, prefilled da view ─────────────────────────────────
  const [titulo, setTitulo] = useState(view.name)
  const [descricao, setDescricao] = useState(view.body.descricao ?? '')
  const [passos, setPassos] = useState((view.body.passos ?? []).join('\n'))
  const [notas, setNotas] = useState(view.body.notas ?? '')
  const [cozinha, setCozinha] = useState(view.facets.cozinha ?? '')
  const [categoria, setCategoria] = useState(view.facets.categoria ?? '')
  const [restricoes, setRestricoes] = useState<string[]>([...(view.facets.restricoes ?? [])])
  const [porcoes, setPorcoes] = useState(view.porcoes != null ? String(view.porcoes) : '')
  const [dificuldade, setDificuldade] = useState(
    view.dificuldade != null ? String(view.dificuldade) : '',
  )
  // Tempo de preparo (#261, ADR-0023): ativo + total (min). String no state (input numérico); ''→null
  // no buildPatch. SEMPRE enviados (espelha porcoes) — o clamp ativo>total roda no servidor.
  const [tempoAtivoMin, setTempoAtivoMin] = useState(
    view.tempoAtivoMin != null ? String(view.tempoAtivoMin) : '',
  )
  const [tempoTotalMin, setTempoTotalMin] = useState(
    view.tempoTotalMin != null ? String(view.tempoTotalMin) : '',
  )
  const [itens, setItens] = useState<ItemDraft[]>(itemsFromView(view))

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // `visibility` = falha PARCIAL no Salvar (PATCH ok, publish/unpublish falhou): o conteúdo gravou,
  // só a visibilidade não mudou — a edição NÃO se perde.
  const [errorKey, setErrorKey] = useState<'save' | 'delete' | 'visibility' | null>(null)
  const [dialog, setDialog] = useState<Dialog>('none')

  // Foco do diálogo: guarda o gatilho p/ devolver o foco ao fechar; foca o primário ao abrir.
  const triggerRef = useRef<HTMLElement | null>(null)
  const dialogPrimaryRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (dialog !== 'none') dialogPrimaryRef.current?.focus()
  }, [dialog])

  // #197: sinaliza confirm-aberto pra cima para o modal consumir o Escape/click-fora do Sheet
  // enquanto o confirm interno está empilhado (senão o Radix fecharia o Sheet e perderia o
  // rascunho). `onConfirmOpenChange` é estável (definido no RecipeEditModal por render).
  useEffect(() => {
    onConfirmOpenChange?.(dialog !== 'none')
  }, [dialog, onConfirmOpenChange])

  function fecharDialogo() {
    setDialog('none')
    triggerRef.current?.focus()
    triggerRef.current = null
  }

  // Escape fecha o diálogo (a11y); Tab cicla entre os dois botões (trap simples).
  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      fecharDialogo()
      return
    }
    if (e.key === 'Tab') {
      const root = dialogRef.current
      if (!root) return
      const focusables = root.querySelectorAll<HTMLElement>('button:not([disabled])')
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function patchItem(index: number, patch: Partial<ItemDraft>) {
    setItens((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  function addItem() {
    setItens((prev) => [...prev, { rawText: '', quantidade: '', unidade: '' }])
  }
  function removeItem(index: number) {
    setItens((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }
  function toggleRestricao(value: string) {
    setRestricoes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  /** Monta o body do PATCH a partir do estado atual (forma do contrato da rota). */
  function buildPatch() {
    const passosArr = passos
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    const ingredientes = itens
      .filter((it) => it.rawText.trim() !== '' || it.quantidade.trim() !== '' || it.unidade !== '')
      .map((it) => ({
        rawText: it.rawText.trim() === '' ? null : it.rawText.trim(),
        quantidade: it.quantidade.trim() === '' ? null : it.quantidade.trim(),
        unidade: it.unidade === '' ? null : it.unidade,
      }))
    return {
      locale: currentLocale,
      titulo: titulo.trim(),
      descricao: descricao.trim() === '' ? null : descricao,
      passos: passosArr.length > 0 ? passosArr : null,
      notas: notas.trim() === '' ? null : notas,
      cozinha: cozinha === '' ? null : cozinha,
      categoria: categoria === '' ? null : categoria,
      restricoes,
      porcoes: porcoes === '' ? null : Number(porcoes),
      dificuldade: dificuldade === '' ? null : Number(dificuldade),
      tempoAtivoMin: tempoAtivoMin === '' ? null : Number(tempoAtivoMin),
      tempoTotalMin: tempoTotalMin === '' ? null : Number(tempoTotalMin),
      ingredientes,
    }
  }

  /**
   * #196/ADR-0021: monta o body do POST /derive (forma do contrato da rota de derivar). O subset
   * é o que a rota aceita em `edits` (titulo/descricao/passos/notas/restricoes/ingredientes) — a
   * rota copia o resto da base e congela o diff. Reusa o mesmo parsing de itens do PATCH.
   */
  function buildDeriveEdits() {
    const p = buildPatch()
    return {
      titulo: p.titulo,
      descricao: p.descricao,
      passos: p.passos,
      notas: p.notas,
      restricoes: p.restricoes,
      ingredientes: p.ingredientes,
    }
  }

  /**
   * #196/ADR-0021: DERIVA uma Receita NÃO-própria. POST /api/recipes/[id]/derive (a base NUNCA é
   * mutada) → 201 { recipeId } → NAVEGA pra nova Receita (sua, privada). Erro (qualquer não-201)
   * mostra mensagem neutra e mantém o modal aberto (a edição não se perde). #131: mudança visual
   * com imagem herdada ⇒ `?reviewImage=1`.
   */
  async function derivar() {
    if (saving) return
    // #196 (should-fix): guard barato de título-vazio ANTES do fetch. A validação saiu pro servidor
    // (400 → system.error neutro), mas evitamos o round-trip: título vazio (ou só espaços) ⇒ erro
    // local apontando ao Salvar e NÃO dispara o POST. O 400 do servidor segue como rede de segurança.
    if (buildDeriveEdits().titulo === '') {
      setErrorKey('save')
      return
    }
    setSaving(true)
    setErrorKey(null)
    const locale = deriveLocale ?? currentLocale
    try {
      const res = await fetch(
        `/api/recipes/${view.id}/derive?locale=${encodeURIComponent(locale)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ edits: buildDeriveEdits() }),
        },
      )
      if (res.status === 201) {
        const data = (await res.json().catch(() => ({}))) as {
          recipeId: string
          imageReviewSuggested?: boolean
        }
        const q = data.imageReviewSuggested ? '?reviewImage=1' : ''
        // #231 (ADR-0020): a derivada nasce privada e o /derive não devolve slug — navega pro fallback
        // canônico por UUID `/{locale}/recipes/<uuid>` (que 308a pro slug). Nunca link nu sem locale.
        router.push(`${recipeDetailPath(currentLocale, data.recipeId)}${q}`)
        router.refresh()
        onSaved?.()
        return
      }
      setErrorKey('save')
    } catch {
      setErrorKey('save')
    } finally {
      setSaving(false)
    }
  }

  /**
   * #195/ADR-0021 (decisão 4): Salvar orquestra CONTEÚDO PRIMEIRO. (1) PATCH do conteúdo
   * (`owner-edit.ts`, nunca toca visibility); (2) SÓ se o rascunho de Visibilidade difere do estado
   * inicial, POST publish/unpublish por request SEPARADO. Falha parcial (PATCH ok, publish falha)
   * deixa o conteúdo salvo e mostra só o erro de visibilidade (sem perder a edição nem fechar o
   * modal) — ordem conteúdo-primeiro = a falha menos surpreendente.
   */
  async function salvar() {
    if (saving) return
    setSaving(true)
    setErrorKey(null)
    try {
      // ── (1) Conteúdo ──────────────────────────────────────────────────────────
      const res = await fetch(`/api/recipes/${view.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPatch()),
      })
      if (!res.ok) {
        // Fecha o diálogo: senão o overlay z-50 esconde o alerta (role=alert) e trava o usuário.
        setDialog('none')
        setErrorKey('save')
        return
      }
      const data = (await res.json().catch(() => ({}))) as { imageReviewSuggested?: boolean }

      // ── (2) Visibilidade — SÓ se o rascunho mudou ─────────────────────────────
      // O toggle só aparece para Receitas publicáveis; mesmo assim, gateamos por
      // `showVisibilityToggle` (defesa) e por mudança real (idempotência — request só quando muda).
      if (showVisibilityToggle && draftPublic !== initialPublic) {
        const endpoint = draftPublic ? 'publish' : 'unpublish'
        let visOk = false
        try {
          const visRes = await fetch(`/api/recipes/${view.id}/${endpoint}`, { method: 'POST' })
          visOk = visRes.ok
        } catch {
          visOk = false
        }
        if (!visOk) {
          // Falha PARCIAL: o conteúdo JÁ gravou. Mantém o modal aberto, NÃO perde a edição, e
          // relê o detalhe (o conteúdo novo aparece). Mostra só o erro de visibilidade.
          setDialog('none')
          setErrorKey('visibility')
          // #231 (ADR-0020): canônico locale-no-caminho `/{locale}/recipes/<uuid>` (que 308a pro
          // slug) — NUNCA o link nu sem locale. A `RecipeView` não carrega slug ⇒ fallback por UUID.
          const base = `${recipeDetailPath(currentLocale, view.id)}?locale=${encodeURIComponent(currentLocale)}`
          router.replace(data.imageReviewSuggested ? `${base}&reviewImage=1` : base)
          router.refresh()
          return
        }
      }

      setDialog('none')
      // Relê a page server (o detalhe reflete a edição + recomputa Aviso/diff de graça). #131:
      // edição in-place é a MESMA página — navega com `?reviewImage=1` quando a mudança foi VISUAL
      // numa Receita com foto; senão à URL limpa (zera um `?reviewImage=1` stale de uma edição
      // visual anterior). PRESERVA o `?locale` atual (a page o honra na precedência de locale).
      // #231 (ADR-0020): locale-no-caminho `/{locale}/recipes/<uuid>` (que 308a pro slug), nunca link nu.
      const base = `${recipeDetailPath(currentLocale, view.id)}?locale=${encodeURIComponent(currentLocale)}`
      router.replace(data.imageReviewSuggested ? `${base}&reviewImage=1` : base)
      router.refresh()
      // #192: salvou ⇒ fecha o modal (o detalhe atrás reflete via router.refresh; o banner de
      // revisão de foto #131 aparece inline no detalhe, fora do modal).
      onSaved?.()
    } catch {
      // Mesma razão: o erro só fica visível com o diálogo fechado.
      setDialog('none')
      setErrorKey('save')
    } finally {
      setSaving(false)
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    // #196: no modo derive, Salvar DERIVA direto (POST /derive). Sem confirm #277 — derivar não
    // muta a base; a derivada nasce privada (nada público a confirmar).
    if (isDerive) {
      void derivar()
      return
    }
    // Pública (#277): confirma antes de gravar — a mudança fica visível na comunidade.
    if (isPublic) {
      const submitter = (e.nativeEvent as SubmitEvent).submitter
      triggerRef.current = submitter instanceof HTMLElement ? submitter : null
      setDialog('confirmPublic')
      return
    }
    void salvar()
  }

  async function apagar() {
    if (deleting) return
    setDeleting(true)
    setErrorKey(null)
    try {
      const res = await fetch(`/api/recipes/${view.id}`, { method: 'DELETE' })
      if (!res.ok) {
        // Fecha o diálogo: senão o overlay z-50 esconde o alerta (role=alert) e trava o usuário.
        setDialog('none')
        setErrorKey('delete')
        setDeleting(false)
        return
      }
      // Apagada: volta para "Minhas criações" (o detalhe desta receita some).
      router.push('/me/recipes')
      router.refresh()
    } catch {
      // Mesma razão: o erro só fica visível com o diálogo fechado.
      setDialog('none')
      setErrorKey('delete')
      setDeleting(false)
    }
  }

  const restricaoLabel = (r: string) =>
    RESTRICOES.includes(r as (typeof RESTRICOES)[number])
      ? messages.restricaoLabel[r as (typeof RESTRICOES)[number]]
      : r

  // #192/ADR-0021: dentro do modal centrado o título e a moldura são do `SheetContent`
  // (SheetTitle), então o form NÃO emite seu próprio `<h2>`/`<section>` (seria heading/moldura
  // duplicada). Fora do modal (compat), mantém a section rotulada.
  const inModal = onSaved != null || onCancel != null

  const formBody = (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {/* #196: aviso de CÓPIA no modo derive — neutro (NÃO âmbar). Reusa `derivada.copiaAviso`. */}
        {isDerive && (
          <p className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg">
            {messages.derivada.copiaAviso}
          </p>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {messages.criar.titulo}
          <Input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {messages.detalhe.descricao}
          <Textarea
            rows={2}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="resize-y"
          />
        </label>

        {/* #195/ADR-0021: toggle de Visibilidade — RASCUNHO local (não chama o servidor; comita no
            Salvar). Escondido para web_imported (#168) e playful (ADR-0013), que nunca publicam. */}
        {showVisibilityToggle && (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border bg-bg p-3">
            <legend className="px-1 text-sm font-medium text-fg">
              {messages.visibilidade.rascunhoLegenda}
            </legend>
            <label className="inline-flex items-start gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={draftPublic}
                onChange={(e) => setDraftPublic(e.target.checked)}
                className="mt-0.5 accent-brand-strong"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{messages.visibilidade.rascunhoTornarPublica}</span>
                <span className="text-muted">
                  {draftPublic
                    ? messages.visibilidade.rascunhoTornarPublicaAjuda
                    : messages.visibilidade.rascunhoManterPrivada}
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {/* Ingredientes — linha por item (texto + quantidade + unidade). */}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-fg">{mc.legendaIngredientes}</legend>
          <ul role="list" className="flex flex-col gap-3">
            {itens.map((item, index) => (
              <li
                key={index}
                className="flex flex-col gap-2 rounded-md border border-border bg-bg p-3 sm:flex-row sm:items-end"
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-fg">
                  {`${mc.ingrediente} ${index + 1}`}
                  <Input
                    type="text"
                    value={item.rawText}
                    onChange={(e) => patchItem(index, { rawText: e.target.value })}
                  />
                </label>
                <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-24">
                  {mc.quantidade}
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={item.quantidade}
                    onChange={(e) => patchItem(index, { quantidade: e.target.value })}
                  />
                </label>
                <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-36">
                  {mc.unidade}
                  <select
                    value={item.unidade}
                    onChange={(e) => patchItem(index, { unidade: e.target.value })}
                    className={fieldClassName}
                  >
                    <option value="">{mc.unidadeNenhuma}</option>
                    {UNIDADES.map((u) => (
                      <option key={u} value={u}>
                        {messages.unidadeLabel[u]}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => removeItem(index)}
                  disabled={itens.length <= 1}
                  aria-label={`${mc.removerIngrediente} ${index + 1}`}
                  className="disabled:cursor-not-allowed disabled:border disabled:border-border disabled:opacity-50"
                >
                  {mc.removerIngrediente}
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button type="button" variant="secondary" onClick={addItem}>
              {mc.adicionarIngrediente}
            </Button>
          </div>
        </fieldset>

        {/* Modo de preparo (um passo por linha). */}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {messages.detalhe.passos}
          <Textarea
            rows={4}
            value={passos}
            onChange={(e) => setPassos(e.target.value)}
            className="resize-y"
          />
        </label>

        {/* #196/ADR-0021: Cozinha + categoria. ESCONDIDOS no modo derive — a rota POST /derive
            herda esses campos da base (não estão no subset de `edits` que ela aceita). Renderizá-los
            editáveis seria um trap: a edição seria descartada SILENCIOSAMENTE no Salvar. */}
        {!isDerive && (
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
            <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:max-w-xs">
              {mc.cozinha}
              <select
                value={cozinha}
                onChange={(e) => setCozinha(e.target.value)}
                className={fieldClassName}
              >
                <option value="">{mc.cozinhaNenhuma}</option>
                {/* #317: opções de cozinha do leitor data-driven (contexto), já localizadas. */}
                {cozinhaVocab.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:max-w-xs">
              {messages.detalhe.categoria}
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className={fieldClassName}
              >
                <option value="">{mc.cozinhaNenhuma}</option>
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {messages.categoriaLabel[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Restrições. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-fg">{mc.legendaRestricoes}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {RESTRICOES.map((r) => (
              <label key={r} className="inline-flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={restricoes.includes(r)}
                  onChange={() => toggleRestricao(r)}
                  className="accent-brand-strong"
                />
                {restricaoLabel(r)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* #196/ADR-0021: Porções + dificuldade. ESCONDIDOS no modo derive — herdados da base pela
            rota POST /derive (fora do subset de `edits`). Ver nota no bloco Cozinha/Categoria. */}
        {!isDerive && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
              <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
                {mc.porcoes}
                <Input
                  type="number"
                  min={PORCOES.min}
                  max={PORCOES.max}
                  value={porcoes}
                  onChange={(e) => setPorcoes(e.target.value)}
                />
              </label>
              <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
                {mc.dificuldade}
                <Input
                  type="number"
                  min={DIFICULDADE.min}
                  max={DIFICULDADE.max}
                  value={dificuldade}
                  onChange={(e) => setDificuldade(e.target.value)}
                />
              </label>
            </div>
            {/* Tempo de preparo (#261, ADR-0023): ativo + total (min), em linha própria (não estoura
                a row). Aviso honesto se ativo > total — ao salvar, o ativo é descartado (clamp do
                servidor, política de salvamento; não invalida a Receita). */}
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
              <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
                {mc.tempoAtivoMin}
                <Input
                  type="number"
                  min={TEMPO_MIN.min}
                  max={TEMPO_MIN.max}
                  value={tempoAtivoMin}
                  onChange={(e) => setTempoAtivoMin(e.target.value)}
                />
              </label>
              <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
                {mc.tempoTotalMin}
                <Input
                  type="number"
                  min={TEMPO_MIN.min}
                  max={TEMPO_MIN.max}
                  value={tempoTotalMin}
                  onChange={(e) => setTempoTotalMin(e.target.value)}
                />
              </label>
            </div>
            {tempoAtivoMin !== '' &&
              tempoTotalMin !== '' &&
              Number(tempoAtivoMin) > Number(tempoTotalMin) && (
                <p className="text-sm text-muted">{mc.tempoAtivoExcedeTotal}</p>
              )}
          </div>
        )}

        {/* Notas. */}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {messages.detalhe.notas}
          <Textarea
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="resize-y"
          />
        </label>

        {errorKey === 'save' && (
          <p
            role="alert"
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
          >
            {messages.system.error}
          </p>
        )}

        {/* #195: falha PARCIAL no Salvar — conteúdo gravou, mas publicar/despublicar falhou. A
            edição NÃO se perde; o modal fica aberto pro usuário tentar de novo. */}
        {errorKey === 'visibility' && (
          <p
            role="alert"
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
          >
            {messages.visibilidade.erroVisibilidadeParcial}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={saving}
            aria-busy={saving}
            className="disabled:cursor-not-allowed disabled:border disabled:border-border disabled:opacity-70"
          >
            {saving
              ? messages.system.loading
              : isDerive
                ? messages.minhasCriacoes.criarMinhaVersao
                : m.editarPublicaConfirmar}
          </Button>
          {/* #192: Cancelar fecha o modal sem gravar (só na variante modal). */}
          {onCancel && (
            <Button type="button" variant="secondary" onClick={onCancel}>
              {m.editarPublicaCancelar}
            </Button>
          )}
          {/* #196: Apagar fica SÓ no modo own — a base derivada não é sua, não há o que apagar. */}
          {!isDerive && (
            <Button
              type="button"
              variant="secondary"
              onClick={(e) => {
                triggerRef.current = e.currentTarget
                setDialog('confirmDelete')
              }}
            >
              {messages.minhasCriacoes.apagar}
            </Button>
          )}
        </div>
      </form>

      {errorKey === 'delete' && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m.apagarErro}
        </p>
      )}

      {/* Diálogo de confirmação (pública OU apagar) — role=dialog, aria-modal, Escape, trap. */}
      {dialog !== 'none' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-titulo"
            aria-describedby="dialog-desc"
            onKeyDown={onDialogKeyDown}
            className="flex w-full max-w-md flex-col gap-4 rounded-md border border-border bg-bg px-5 py-4 shadow-md"
          >
            <h2 id="dialog-titulo" className="font-display text-lg font-semibold text-fg">
              {dialog === 'confirmDelete' ? m.apagarTitulo : m.editarPublicaTitulo}
            </h2>
            <p id="dialog-desc" className="text-sm text-muted">
              {dialog === 'confirmDelete' ? m.apagarAviso : m.editarPublicaAviso}
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={fecharDialogo}
              >
                {dialog === 'confirmDelete' ? m.apagarCancelar : m.editarPublicaCancelar}
              </Button>
              <Button
                ref={dialogPrimaryRef}
                type="button"
                onClick={dialog === 'confirmDelete' ? apagar : salvar}
                disabled={dialog === 'confirmDelete' ? deleting : saving}
                aria-busy={dialog === 'confirmDelete' ? deleting : saving}
                className="disabled:cursor-not-allowed disabled:border disabled:border-border disabled:opacity-70"
              >
                {dialog === 'confirmDelete'
                  ? deleting
                    ? m.apagando
                    : m.apagarConfirmar
                  : saving
                    ? messages.system.loading
                    : m.editarPublicaConfirmar}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // Dentro do modal: sem moldura própria (o SheetContent é a moldura) — o SheetTitle nomeia.
  // Fora do modal (compat): a section rotulada com o próprio `<h2>`.
  if (inModal) return formBody
  return (
    <section
      aria-labelledby="editar-titulo"
      className="flex flex-col gap-6 rounded-md border border-border bg-surface px-4 py-4"
    >
      <h2 id="editar-titulo" className="font-display text-lg font-semibold text-fg">
        {messages.minhasCriacoes.editar}
      </h2>
      {formBody}
    </section>
  )
}
