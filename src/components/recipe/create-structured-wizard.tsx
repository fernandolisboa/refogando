'use client'
/**
 * Wizard do FORMULÁRIO ESTRUTURADO (#193, ADR-0021) — o caminho `structured` dentro do drawer
 * "Nova receita" (#191). Casca de UI NOVA (3 passos com stepper) sobre o MOTOR de geração já
 * existente: `useRecipeGeneration` faz o POST `mode:'structured'` em /api/generations e o 2º GET do
 * corpo, e `GenerationResultRegion` desenha o desfecho (success/degraded/playful/impossible/
 * load-failed). Este componente só monta o BRIEFING e navega os passos — NÃO reimplementa geração
 * nem o pipeline de resultado/cap/erro (espelho do caminho estruturado da /create).
 *
 * Passos:
 *  1. Ingredientes — alterna "um a um" (pager entre itens qtd/unidade/nome, adicionar/remover) e
 *     "de uma vez" (textarea: uma linha/vírgula por item; o `rawText` cru entra como item do
 *     Briefing — o servidor/IA estrutura quantidade/unidade, como já faz com itens crus).
 *  2. Cozinha (chips, opcional) + Restrições alimentares (chips, "declarado, não verificado").
 *  3. Detalhes — porções (stepper), dificuldade (chips 1..5), observações (textarea).
 *
 * SEAM de heading/foco (F1 cancelado): o `<h1>` é o nome da Receita (via `RecipeDetailView` em
 * `GenerationResultRegion`); enquanto o form está na tela, o heading do TOPO do resultado é um
 * `<h2>` (com `headingRef`/tabIndex=-1) que o motor foca ao gerar. O `SheetTitle` do drawer é
 * outro `<h2>` — invariante 1-h1 preservada.
 *
 * Back STEP-AWARE: o componente registra um handler de "voltar" no shell (drawer) via
 * `onBackHandlerChange` — no passo >0 volta um passo; no passo 0 retorna ao método-picker
 * (`onExit`). O rodapé "Voltar" usa o MESMO handler. Voltar preserva todo o estado do Briefing.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { COZINHAS, RESTRICOES, UNIDADES, PORCOES, DIFICULDADE } from '@/domain/vocabulary'
import { cn } from '@/lib/utils'
import {
  useRecipeGeneration,
  mapErroMensagem,
  type Status,
} from '@/hooks/use-recipe-generation'
import { GenerationResultRegion } from './generation-result-region'

/** Rascunho de UM item do Briefing. `strength` nasce 'required'; `ingredientId` é sempre null. */
type ItemDraft = { rawText: string; quantidade: string; unidade: string }

function novoItem(): ItemDraft {
  return { rawText: '', quantidade: '', unidade: '' }
}

/** Porções default do protótipo (stepper começa em 4). */
const PORCOES_DEFAULT = 4

/** Chip pill — espelha o FacetFieldset/protótipo (páprica quando ativo). */
function Chip({
  active,
  onClick,
  children,
  ...rest
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-150 ease-out',
        active
          ? 'border-brand-strong bg-brand-strong font-semibold text-on-brand'
          : 'border-border bg-surface text-muted hover:border-brand/60',
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function CreateStructuredWizard({
  onExit,
  onBackHandlerChange,
  onStepLabelChange,
  onLoadingChange,
}: {
  /** Voltar ao método-picker (passo 0 → picker). */
  onExit: () => void
  /** Registra o handler de "voltar" step-aware para o `‹` do header do drawer. */
  onBackHandlerChange?: (handler: (() => void) | null) => void
  /** Reporta o stepper renderizado no header do drawer (null quando há resultado/loading). */
  onStepLabelChange?: (node: React.ReactNode) => void
  /** Espelha `status === 'loading'` para o drawer travar o dismiss (ADR-0021 dec.5). */
  onLoadingChange?: (loading: boolean) => void
}) {
  const { locale, messages } = useLocale()
  const m = messages.criar
  const w = messages.criarWizard

  // Destrutura o bag do motor no topo: o render lê variáveis planas (estado), e a `headingRef`
  // (única ref do bag) fica isolada — assim o lint `react-hooks/refs` não confunde os acessos a
  // `result`/`view` com acesso a ref durante o render.
  const {
    status,
    result,
    view,
    errorKey,
    loadFailed,
    headingRef,
    enviar,
    carregarReceita,
    voltarParaIdle,
    setStatus,
    setErrorKey,
  } = useRecipeGeneration({ locale, onLoadingChange })

  // ── Estado do wizard ────────────────────────────────────────────────────────
  const [step, setStep] = useState(0)
  const [ingMode, setIngMode] = useState<'guided' | 'bulk'>('guided')
  const [itens, setItens] = useState<ItemDraft[]>([novoItem()])
  const [cur, setCur] = useState(0)
  const [bulkText, setBulkText] = useState('')
  const [cozinha, setCozinha] = useState<string>('')
  const [restricoes, setRestricoes] = useState<string[]>([])
  const [porcoes, setPorcoes] = useState(PORCOES_DEFAULT)
  const [dificuldade, setDificuldade] = useState(1)
  const [observacoes, setObservacoes] = useState('')

  const isResult = status === 'result'
  const isLoading = status === 'loading'

  // ── Itens (modo um-a-um) ─────────────────────────────────────────────────────
  const curIdx = Math.min(cur, itens.length - 1)
  const curIng = itens[curIdx] ?? novoItem()
  function patchCur(patch: Partial<ItemDraft>) {
    setItens((prev) => prev.map((it, i) => (i === curIdx ? { ...it, ...patch } : it)))
  }
  function addItem() {
    setItens((prev) => [...prev, novoItem()])
    setCur(itens.length) // foca o item recém-adicionado
  }
  function removeCur() {
    setItens((prev) => {
      if (prev.length <= 1) return [novoItem()]
      return prev.filter((_, i) => i !== curIdx)
    })
    setCur((c) => Math.max(0, Math.min(c, itens.length - 2)))
  }

  function toggleRestricao(value: string) {
    setRestricoes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  // ── Briefing (mesmo shape do caminho estruturado da /create) ─────────────────
  // Os itens crus: no modo um-a-um, as linhas preenchidas (com texto); no modo de-uma-vez, cada
  // linha/vírgula da textarea vira um item cru (`rawText`). O servidor/IA estrutura o cru —
  // como já faz com qualquer item sem identidade. `ingredientId` é sempre null (catálogo adiado).
  function briefingItens() {
    if (ingMode === 'bulk') {
      return bulkText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .map((rawText) => ({
          ingredientId: null,
          rawText,
          quantidade: null,
          unidade: null,
          strength: 'required' as const,
        }))
    }
    return itens
      .filter((it) => it.rawText.trim() !== '')
      .map((it) => ({
        ingredientId: null,
        rawText: it.rawText.trim(),
        quantidade: it.quantidade.trim() === '' ? null : it.quantidade.trim(),
        unidade: it.unidade || null,
        strength: 'required' as const,
      }))
  }

  function buildBody() {
    return {
      mode: 'structured' as const,
      briefing: {
        cozinha: cozinha || null,
        restricoes,
        porcoes,
        dificuldade,
        observacoes: observacoes.trim() === '' ? null : observacoes,
        itens: briefingItens(),
      },
    }
  }

  async function gerar() {
    if (status === 'loading') return // anti-duplicação (duplo-clique)
    setErrorKey(null)
    await enviar(buildBody())
  }

  // ── Navegação ────────────────────────────────────────────────────────────────
  function avancar() {
    setStep((s) => Math.min(2, s + 1))
  }
  function voltar() {
    if (step > 0) {
      setStep((s) => s - 1)
    } else {
      onExit()
    }
  }

  function criarOutra() {
    setIngMode('guided')
    setItens([novoItem()])
    setCur(0)
    setBulkText('')
    setCozinha('')
    setRestricoes([])
    setPorcoes(PORCOES_DEFAULT)
    setDificuldade(1)
    setObservacoes('')
    setStep(0)
    voltarParaIdle()
  }

  // ── Stepper (renderizado no header do drawer) ────────────────────────────────
  const STEP_NAMES = [w.passoIngredientes, w.passoCozinha, w.passoDetalhes]
  // Reporta para o shell: o `‹` do header vira step-aware enquanto NÃO há resultado; o stepper
  // some no resultado/loading. Ajusta DURANTE o render via assinatura (evita set-state-in-effect).
  const showChrome = !isResult && !isLoading
  useEffect(() => {
    onBackHandlerChange?.(showChrome ? voltar : null)
    return () => onBackHandlerChange?.(null)
    // `voltar`/`step` mudam a assinatura; re-registra o handler com o step atual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChrome, step])

  useEffect(() => {
    onStepLabelChange?.(
      showChrome ? (
        <ol className="mt-4 flex items-center gap-1.5" aria-label={w.passoLabel.replace('{n}', String(step + 1))}>
          {STEP_NAMES.map((name, i) => (
            <li key={name} className="flex flex-1 items-center gap-1.5 last:flex-none">
              <span
                aria-current={i === step ? 'step' : undefined}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full font-display text-xs font-semibold',
                  i === step
                    ? 'bg-brand-strong text-on-brand'
                    : i < step
                      ? 'bg-brand/20 text-brand-ink'
                      : 'border border-border bg-surface text-muted',
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-xs',
                  i === step ? 'font-semibold text-fg' : 'text-muted',
                )}
              >
                {name}
              </span>
              {i < 2 && <span aria-hidden className="h-px min-w-2 flex-1 bg-border" />}
            </li>
          ))}
        </ol>
      ) : null,
    )
    return () => onStepLabelChange?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChrome, step, locale])

  const inputCls =
    'rounded-md border border-border bg-surface px-3 py-2 text-fg shadow-sm placeholder:text-muted'

  const filledCount = itens.filter((it) => it.rawText.trim() !== '').length

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Formulário (passos) — some no resultado. `fieldset disabled` trava tudo no loading. */}
      {!isResult && (
        <fieldset
          disabled={isLoading}
          className="flex min-w-0 flex-col gap-6 border-0 p-0 disabled:opacity-60"
        >
          {/* Destino de foco do swap (a11y): o motor (`useRecipeGeneration`) move o foco para o
              `headingRef` a cada troca de status. No resultado ele mora no `<h2>` do nome; nos
              estados de FORM (idle/loading/error) o ref vive aqui, num <h2> sr-only focável
              (tabIndex=-1) — assim o foco não cai no <body> ao entrar em "gerando"/erro. Form e
              resultado nunca montam juntos → o ref é compartilhado sem conflito. Continua sendo
              <h2> (o nome da Receita é o ÚNICO <h1>: invariante 1-h1 preservada). */}
          <h2 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
            {m.titulo}
          </h2>
          {/* ── Passo 1 — Ingredientes ───────────────────────────────────────── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
                  {w.ingredientesTitulo}
                </h2>
                <p className="text-sm text-muted">{w.ingredientesIntro}</p>
              </div>

              {/* Toggle um-a-um / de-uma-vez (segmented). */}
              <div
                role="group"
                aria-label={w.modoIngredientesLabel}
                className="flex gap-1 rounded-lg border border-border bg-surface p-1"
              >
                <button
                  type="button"
                  aria-pressed={ingMode === 'guided'}
                  onClick={() => setIngMode('guided')}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors',
                    ingMode === 'guided'
                      ? 'bg-brand-strong font-semibold text-on-brand'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  {w.modoUmAUm}
                </button>
                <button
                  type="button"
                  aria-pressed={ingMode === 'bulk'}
                  onClick={() => setIngMode('bulk')}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors',
                    ingMode === 'bulk'
                      ? 'bg-brand-strong font-semibold text-on-brand'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  {w.modoDeUmaVez}
                </button>
              </div>

              {ingMode === 'guided' ? (
                <div className="flex flex-col gap-3">
                  {/* Pager por números: clicar salta para o item. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {itens.map((it, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={w.irParaItem.replace('{n}', String(i + 1))}
                        aria-current={i === curIdx ? 'true' : undefined}
                        onClick={() => setCur(i)}
                        className={cn(
                          'flex h-8 min-w-8 items-center justify-center rounded-md border px-1.5 font-display text-sm font-semibold',
                          i === curIdx
                            ? 'border-brand-strong bg-brand-strong text-on-brand'
                            : it.rawText.trim()
                              ? 'border-border bg-brand/10 text-brand-ink'
                              : 'border-border bg-bg text-muted',
                        )}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>

                  {/* Cartão do item atual com navegação. */}
                  <div className="flex flex-col gap-3 rounded-xl border border-brand-strong bg-surface p-3.5">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={w.itemAnterior}
                        disabled={curIdx === 0}
                        onClick={() => setCur((c) => Math.max(0, c - 1))}
                      >
                        ‹
                      </Button>
                      <span className="flex-1 text-center text-sm font-semibold text-brand-ink">
                        {w.itemPosicao
                          .replace('{atual}', String(curIdx + 1))
                          .replace('{total}', String(itens.length))}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={w.itemProximo}
                        disabled={curIdx >= itens.length - 1}
                        onClick={() => setCur((c) => Math.min(itens.length - 1, c + 1))}
                      >
                        ›
                      </Button>
                      {itens.length > 1 && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          aria-label={m.removerIngrediente}
                          onClick={removeCur}
                        >
                          ×
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-[5rem_1fr] gap-2">
                      <label className="flex flex-col gap-1 text-xs font-medium text-fg">
                        {m.quantidade}
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={curIng.quantidade}
                          onChange={(e) => patchCur({ quantidade: e.target.value })}
                          placeholder={m.quantidadePlaceholder}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-fg">
                        {m.unidade}
                        <select
                          value={curIng.unidade}
                          onChange={(e) => patchCur({ unidade: e.target.value })}
                          className={inputCls}
                        >
                          <option value="">{m.unidadeNenhuma}</option>
                          {UNIDADES.map((u) => (
                            <option key={u} value={u}>
                              {messages.unidadeLabel[u]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-xs font-medium text-fg">
                      {m.ingrediente}
                      <Input
                        type="text"
                        value={curIng.rawText}
                        onChange={(e) => patchCur({ rawText: e.target.value })}
                        placeholder={m.ingredientePlaceholder}
                      />
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Button type="button" variant="ghost" size="sm" onClick={addItem}>
                      + {w.adicionarOutro}
                    </Button>
                    <span className="text-xs text-muted">
                      {filledCount} / {itens.length}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <label htmlFor="wizard-bulk" className="text-sm font-medium text-fg">
                    {w.bulkLabel}
                  </label>
                  <Textarea
                    id="wizard-bulk"
                    rows={7}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={w.bulkPlaceholder}
                    className="resize-y"
                  />
                  <p className="text-xs text-muted">{w.bulkDistincao}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Passo 2 — Cozinha + Restrições ───────────────────────────────── */}
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
                  {w.cozinhaTitulo}
                </h2>
                <p className="text-sm text-muted">{w.cozinhaIntro}</p>
                <div className="flex flex-wrap gap-2">
                  {COZINHAS.map((c) => (
                    <Chip
                      key={c}
                      active={cozinha === c}
                      onClick={() => setCozinha((prev) => (prev === c ? '' : c))}
                    >
                      {messages.cozinhaLabel[c]}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
                  {w.restricoesTitulo}
                </h2>
                <p className="text-sm text-muted">{w.restricoesIntro}</p>
                <div className="flex flex-wrap gap-2">
                  {RESTRICOES.map((r) => (
                    <Chip
                      key={r}
                      active={restricoes.includes(r)}
                      onClick={() => toggleRestricao(r)}
                    >
                      {messages.restricaoLabel[r]}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Passo 3 — Detalhes ───────────────────────────────────────────── */}
          {step === 2 && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2.5">
                <h2 className="font-display text-base font-semibold tracking-tight text-fg">
                  {w.porcoesTitulo}
                </h2>
                <div className="flex items-center gap-3.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={w.porcoesMenos}
                    disabled={porcoes <= PORCOES.min}
                    onClick={() => setPorcoes((p) => Math.max(PORCOES.min, p - 1))}
                  >
                    −
                  </Button>
                  <span
                    aria-live="polite"
                    className="min-w-8 text-center font-display text-2xl font-semibold text-fg"
                  >
                    {porcoes}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={w.porcoesMais}
                    disabled={porcoes >= PORCOES.max}
                    onClick={() => setPorcoes((p) => Math.min(PORCOES.max, p + 1))}
                  >
                    +
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <h2 className="font-display text-base font-semibold tracking-tight text-fg">
                  {w.dificuldadeTitulo}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: DIFICULDADE.max }, (_, i) => i + 1).map((n) => (
                    <Chip
                      key={n}
                      active={dificuldade === n}
                      onClick={() => setDificuldade(n)}
                    >
                      {w.dificuldadeNiveis[n - 1]}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <h2 className="font-display text-base font-semibold tracking-tight text-fg">
                  {w.observacoesTitulo}
                </h2>
                <Textarea
                  rows={4}
                  maxLength={2000}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder={w.observacoesPlaceholder}
                  className="resize-y"
                />
              </div>
            </div>
          )}

          {/* Erro de validação/técnico — neutro (NÃO âmbar), espelha o caminho estruturado. */}
          {status === 'error' && errorKey != null && (
            <p
              role="alert"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg"
            >
              {mapErroMensagem(m, errorKey)}
            </p>
          )}
        </fieldset>
      )}

      {/* Rodapé do wizard — Voltar + (Continuar | Gerar receita). Some no resultado. */}
      {!isResult && (
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={voltar} disabled={isLoading}>
            {messages.criarDrawer.voltar}
          </Button>
          <span className="flex-1" />
          {step < 2 ? (
            <Button type="button" onClick={avancar} disabled={isLoading}>
              {w.continuar}
            </Button>
          ) : (
            <Button type="button" onClick={gerar} aria-busy={isLoading} disabled={isLoading}>
              {isLoading ? m.gerando : w.gerar}
            </Button>
          )}
        </div>
      )}

      {/* Região de resultado — `aria-live` PRÉ-existe (anti-vácuo de leitor de tela). O heading do
          TOPO (h2 com headingRef) recebe o foco ao gerar; o nome da Receita é o ÚNICO <h1>. */}
      <div aria-live="polite" className="flex flex-col gap-6">
        {isResult && (
          <>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-xl font-semibold tracking-tight text-fg outline-none"
            >
              {m.titulo}
            </h2>
            {result != null && (
              <GenerationResultRegion
                result={result}
                view={view}
                loadFailed={loadFailed}
                messages={messages}
                onRecarregar={() => {
                  setStatus('loading' as Status)
                  if (result) void carregarReceita(result)
                }}
                onTentarNovamente={() => {
                  voltarParaIdle()
                }}
                onCriarOutra={criarOutra}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
