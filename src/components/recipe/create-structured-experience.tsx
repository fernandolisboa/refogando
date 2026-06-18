'use client'
/**
 * Tela CRIAR estruturada (#58) — o cérebro client com TODO o estado e os fetches. Monta
 * o Briefing por campos e gera a Receita.
 *
 * ADR-0010: a UI consome os ROUTE HANDLERS via `fetch` — NÃO Server Actions. NÃO
 * reimplementa regra de domínio: a validação leve abaixo é só UX (evita round-trip óbvio);
 * o servidor revalida TUDO e a Receita renderizada é o que a rota devolve, lido CRU do body.
 * Bilíngue (ADR-0014/0001): o locale resolvido entra na query do GET e nos rótulos.
 *
 * DUAS chamadas para mostrar a Receita (descoberta da #58):
 *  - `POST /api/generations` devolve só `{ outcome, recipeId, advisory, avisos? }` — NÃO o
 *    corpo da Receita.
 *  - em success/degraded/playful (recipeId != null) fazemos um SEGUNDO `GET
 *    /api/recipes/{id}?locale=` (mesma origem → o cookie de sessão vai junto → o dono lê a
 *    própria Receita privada). O GET devolve o `RecipeView` CRU (`Response.json(view)`),
 *    SEM wrapper — `setView(await r.json())` direto. Esse `view` alimenta `RecipeDetailView`.
 *
 * Auth (#55): guard de página no cliente — Visitante anônimo vê o convite "entre para
 * criar"; o gate de ESCRITA real é server-side (`requireSession` no handler).
 *
 * Aviso de restrição (ADR-0004): renderizado SÓ via `RecipeDetailView`/`RestrictionWarning`
 * a partir de `view.avisos` (âmbar). Merge defensivo: se o POST trouxe `avisos` e o GET não,
 * repassamos os do POST. Erros de validação/desfecho NÃO usam âmbar (neutro + role="alert").
 *
 * Hierarquia de `<h1>` por estado: `RecipeDetailView` emite o seu próprio `<h1>` (o nome
 * da Receita). Para manter UM único `<h1>` por documento, `criar.titulo` é `<h1>` em
 * idle/loading/error/impossible e REBAIXA para `<h2>` quando a Receita está na tela.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { btnPrimary, btnSecondary } from '@/components/button'
import { COZINHAS, RESTRICOES, UNIDADES, PORCOES, DIFICULDADE } from '@/domain/vocabulary'
import { STRENGTHS, type Strength } from '@/domain/briefing'
import type { RecipeView, AvisoView } from '@/domain/recipe-read'
import type { Messages } from '@/i18n/messages'
import { FacetFieldset, type FacetOption } from './facet-fieldset'
import { RecipeDetailView } from './recipe-detail-view'

/** Rascunho de UM item do Briefing no formulário. `strength` NASCE 'required' (o servidor
 *  exige uma força válida em todo item). `ingredientId` nunca é exposto (catálogo ADIADO). */
type ItemDraft = {
  rawText: string
  quantidade: string
  unidade: string
  strength: Strength
}

type Status = 'idle' | 'loading' | 'result' | 'error'

type GenerationResult = {
  outcome: 'success' | 'degraded' | 'playful' | 'impossible'
  recipeId?: string | null
  advisory: string | null
  avisos?: AvisoView[]
}

function novoItem(): ItemDraft {
  return { rawText: '', quantidade: '', unidade: '', strength: 'required' }
}

/**
 * Mapa CÓDIGO de validação (do handler) → chave de `messages.criar`. Casa por código,
 * espelhando `mapErrorToKey` do auth-form; NUNCA exibe a mensagem crua do servidor.
 */
function mapErroMensagem(m: Messages['criar'], errorKey: string): string {
  switch (errorKey) {
    case 'briefing_vazio':
      return m.erroBriefingVazio
    case 'porcoes_fora_de_faixa':
      return m.erroPorcoes
    case 'dificuldade_fora_de_faixa':
      return m.erroDificuldade
    case 'observacoes_muito_longas':
      return m.erroObservacoesLongas
    case 'ingrediente_inexistente':
    case 'item_sem_identidade':
    case 'unidade_invalida':
    case 'strength_invalida':
    case 'erroIngrediente':
      return m.erroIngrediente
    case 'cozinha_invalida':
    case 'restricao_invalida':
    case 'briefing_invalido':
      return m.erroCampos
    case 'erroGeracao':
      return m.erroGeracao
    case 'erroConexao':
      return m.erroConexao
    default:
      return m.erroCampos
  }
}

export function CreateStructuredExperience() {
  const { locale, messages } = useLocale()
  const m = messages.criar
  const session = useSession()

  const [cozinha, setCozinha] = useState('')
  const [restricoes, setRestricoes] = useState<string[]>([])
  const [porcoes, setPorcoes] = useState('')
  const [dificuldade, setDificuldade] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [itens, setItens] = useState<ItemDraft[]>([novoItem()])

  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [view, setView] = useState<RecipeView | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  // A Receita FOI criada (POST ok, recipeId não-null) mas o GET do corpo falhou. NÃO é o
  // mesmo que 'impossible' (lá não há Receita): aqui dizemos "criada, mas não carregou" e
  // oferecemos recarregar — nunca induzir o usuário a reenviar (= geração duplicada).
  const [loadFailed, setLoadFailed] = useState(false)

  // Foco no swap de view (a11y): o form inteiro é desmontado no resultado e vice-versa, então
  // o foco do teclado cairia no <body>. Movemos o foco para o heading do estado novo.
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  // ── Helpers de estado dos itens ────────────────────────────────────────────
  function patchItem(index: number, patch: Partial<ItemDraft>) {
    setItens((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  function addItem() {
    setItens((prev) => [...prev, novoItem()])
  }
  function removeItem(index: number) {
    setItens((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  function toggleRestricao(value: string) {
    setRestricoes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  // Itens com texto preenchido (campo-mínimo-de-item: `ingredientId` é sempre null aqui,
  // então uma linha sem `rawText` cairia em `item_sem_identidade` no servidor → filtrada).
  const itensComTexto = itens.filter((it) => it.rawText.trim() !== '')
  // Linha "começada" só com medida/unidade mas SEM texto: o usuário começou e esqueceu o
  // ingrediente. Orienta em vez de descartar em silêncio (decisão 5).
  const temLinhaParcial = itens.some(
    (it) => it.rawText.trim() === '' && (it.quantidade.trim() !== '' || it.unidade !== ''),
  )

  function buildBody() {
    return {
      mode: 'structured' as const,
      briefing: {
        cozinha: cozinha || null,
        restricoes,
        porcoes: porcoes === '' ? null : Number(porcoes),
        dificuldade: dificuldade === '' ? null : Number(dificuldade),
        observacoes: observacoes.trim() === '' ? null : observacoes,
        itens: itensComTexto.map((it) => ({
          ingredientId: null,
          rawText: it.rawText.trim(),
          quantidade: it.quantidade.trim() === '' ? null : it.quantidade.trim(),
          unidade: it.unidade || null,
          strength: it.strength,
        })),
      },
    }
  }

  // Briefing "vazio" = sem item válido E sem cozinha E sem restrição E sem observação.
  // porções/dificuldade sozinhas NÃO contam (fiel a `isBriefingVazio`: são modificadores).
  const briefingVazio =
    itensComTexto.length === 0 &&
    cozinha === '' &&
    restricoes.length === 0 &&
    observacoes.trim() === ''

  function resetCampos() {
    setCozinha('')
    setRestricoes([])
    setPorcoes('')
    setDificuldade('')
    setObservacoes('')
    setItens([novoItem()])
  }

  function voltarParaIdle({ limpar }: { limpar: boolean }) {
    if (limpar) resetCampos()
    setResult(null)
    setView(null)
    setErrorKey(null)
    setLoadFailed(false)
    setStatus('idle')
  }

  /**
   * Busca o corpo da Receita criada (RecipeView CRU). Em sucesso, monta `view`. Em falha
   * (não-ok ou rede), NÃO cai no estado 'impossible' — marca `loadFailed` para mostrar
   * "criada, mas não carregou" + recarregar. `result` (com `avisos` do POST) já está setado.
   */
  async function carregarReceita(generation: GenerationResult) {
    if (generation.recipeId == null) {
      setLoadFailed(true)
      setStatus('result')
      return
    }
    try {
      const r = await fetch(
        `/api/recipes/${generation.recipeId}?locale=${encodeURIComponent(locale)}`,
      )
      if (r.ok) {
        const v = (await r.json()) as RecipeView
        // Merge defensivo (ADR-0004): se o POST trouxe avisos e o GET não, preserva-os.
        setView(v.avisos ? v : { ...v, avisos: generation.avisos })
        setLoadFailed(false)
      } else {
        setView(null)
        setLoadFailed(true)
      }
    } catch {
      setView(null)
      setLoadFailed(true)
    }
    setStatus('result')
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'loading') return // evita re-entrada / geração duplicada (duplo-clique)
    setErrorKey(null)

    // Validação leve (UX) — o servidor revalida tudo.
    if (itensComTexto.length === 0 && temLinhaParcial) {
      setErrorKey('erroIngrediente')
      setStatus('error')
      return
    }
    if (briefingVazio) {
      setErrorKey('briefing_vazio')
      setStatus('error')
      return
    }

    setStatus('loading')
    try {
      const res = await fetch('/api/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildBody()),
      })

      if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorKey(data.error ?? 'erroCampos')
        setStatus('error')
        return
      }
      if (!res.ok) {
        // 502 (outcome:'invalid') e qualquer outro não-ok caem em erro de geração neutro.
        setErrorKey('erroGeracao')
        setStatus('error')
        return
      }

      const data = (await res.json()) as GenerationResult
      setResult(data)
      setLoadFailed(false)

      if (data.outcome === 'impossible') {
        // Hard-stop honesto: sem Receita, sem GET.
        setView(null)
        setStatus('result')
        return
      }

      // success | degraded | playful → busca o corpo da Receita (RecipeView CRU).
      await carregarReceita(data)
    } catch {
      setErrorKey('erroConexao')
      setStatus('error')
    }
  }

  // Foco no swap form↔resultado (a11y): quando o status muda para 'result' (ou volta a
  // 'idle'/'error'), o heading do estado novo recebe o foco para o teclado não cair no <body>.
  useEffect(() => {
    headingRef.current?.focus()
  }, [status])

  // ── Guard de sessão (decisão 4) ─────────────────────────────────────────────
  if (session.isPending) {
    return (
      <div aria-busy="true" className="text-muted">
        {messages.system.loading}
      </div>
    )
  }
  if (session.error || !session.data) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">{m.titulo}</h1>
        <p className="text-muted">{m.precisaEntrar}</p>
        <Link href="/sign-in" className={btnPrimary}>
          {messages.nav.signIn}
        </Link>
      </div>
    )
  }

  const restricaoOptions: FacetOption[] = RESTRICOES.map((value) => ({
    value,
    label: messages.restricaoLabel[value],
  }))

  const isResult = status === 'result'
  const temReceita = isResult && view != null
  // `criar.titulo` cede o `<h1>` para o nome da Receita só quando ela está na tela.
  const Titulo = temReceita ? 'h2' : 'h1'

  const inputCls =
    'rounded-md border border-border bg-surface px-3 py-2 text-fg shadow-sm placeholder:text-muted'

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Titulo
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-3xl font-semibold tracking-tight text-fg outline-none sm:text-4xl"
        >
          {m.titulo}
        </Titulo>
        {!isResult && <p className="max-w-[60ch] text-muted">{m.descricao}</p>}
      </div>

      {/* Formulário — visível em idle/loading/error; some no resultado. */}
      {!isResult && (
        <form onSubmit={onSubmit} aria-busy={status === 'loading'}>
          {/* `disabled` durante o loading trava TODOS os controles de uma vez (inputs, selects,
              botões de item, submit), honrando o aria-busy do form — evita editar enquanto a
              geração roda (a edição seria descartada quando o resultado substitui o form). */}
          <fieldset
            disabled={status === 'loading'}
            className="flex min-w-0 flex-col gap-8 border-0 p-0 disabled:opacity-60"
          >
          {/* Ingredientes */}
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-sm font-medium text-fg">{m.legendaIngredientes}</legend>
            <ul role="list" className="flex flex-col gap-5">
              {itens.map((item, index) => (
                <li
                  key={index}
                  className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-fg">
                      {`${m.ingrediente} ${index + 1}`}
                      <input
                        type="text"
                        value={item.rawText}
                        onChange={(e) => patchItem(index, { rawText: e.target.value })}
                        placeholder={m.ingredientePlaceholder}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-28">
                      {m.quantidade}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.quantidade}
                        onChange={(e) => patchItem(index, { quantidade: e.target.value })}
                        placeholder={m.quantidadePlaceholder}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
                      {m.unidade}
                      <select
                        value={item.unidade}
                        onChange={(e) => patchItem(index, { unidade: e.target.value })}
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <legend className="sr-only">{m.forca}</legend>
                      <span aria-hidden="true" className="text-sm font-medium text-fg">
                        {m.forca}
                      </span>
                      {STRENGTHS.map((s) => (
                        <label
                          key={s}
                          className="inline-flex items-center gap-2 text-sm text-fg"
                        >
                          <input
                            type="radio"
                            name={`strength-${index}`}
                            value={s}
                            checked={item.strength === s}
                            onChange={() => patchItem(index, { strength: s })}
                            className="accent-brand-strong"
                          />
                          {s === 'required' ? m.forcaObrigatorio : m.forcaPreferido}
                        </label>
                      ))}
                    </fieldset>
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      disabled={itens.length <= 1}
                      aria-label={`${m.removerIngrediente} ${index + 1}`}
                      className={`${btnSecondary} disabled:opacity-50`}
                    >
                      {m.removerIngrediente}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div>
              <button type="button" onClick={addItem} className={btnSecondary}>
                {m.adicionarIngrediente}
              </button>
            </div>
          </fieldset>

          {/* Cozinha */}
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:max-w-xs">
            {m.cozinha}
            <select
              value={cozinha}
              onChange={(e) => setCozinha(e.target.value)}
              className={inputCls}
            >
              <option value="">{m.cozinhaNenhuma}</option>
              {COZINHAS.map((c) => (
                <option key={c} value={c}>
                  {messages.cozinhaLabel[c]}
                </option>
              ))}
            </select>
          </label>

          {/* Restrições */}
          <FacetFieldset
            legend={m.legendaRestricoes}
            options={restricaoOptions}
            selected={restricoes}
            onToggle={toggleRestricao}
          />

          {/* Porções + dificuldade */}
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
            <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
              {m.porcoes}
              <input
                type="number"
                min={PORCOES.min}
                max={PORCOES.max}
                value={porcoes}
                onChange={(e) => setPorcoes(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
              {m.dificuldade}
              <input
                type="number"
                min={DIFICULDADE.min}
                max={DIFICULDADE.max}
                value={dificuldade}
                onChange={(e) => setDificuldade(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          {/* Observações */}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
            {m.observacoes}
            <textarea
              rows={3}
              maxLength={2000}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder={m.observacoesPlaceholder}
              className={`${inputCls} resize-y`}
            />
          </label>

          {/* Erro de validação/técnico — neutro (NÃO âmbar), espelha auth-form. */}
          {status === 'error' && errorKey != null && (
            <p
              role="alert"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg"
            >
              {mapErroMensagem(m, errorKey)}
            </p>
          )}

          <div>
            <button
              type="submit"
              aria-busy={status === 'loading'}
              className={`${btnPrimary} disabled:opacity-70`}
            >
              {status === 'loading' ? m.gerando : m.gerar}
            </button>
          </div>
          </fieldset>
        </form>
      )}

      {/* Região de resultado — renderizada SEMPRE (mesmo vazia) para que o `aria-live` PRÉ-
          exista no DOM: regiões live inseridas junto do conteúdo não são anunciadas por muitos
          leitores de tela (padrão de search-experience). O conteúdo entra/sai DENTRO dela. */}
      <div aria-live="polite" className="flex flex-col gap-6">
        {isResult && result != null && (
          result.outcome === 'impossible' ? (
            // 'impossible' de verdade: nenhuma Receita foi criada.
            <>
              <p className="text-fg">{m.resultadoImpossivel}</p>
              {result.advisory && <p className="max-w-[60ch] text-muted">{result.advisory}</p>}
              <div>
                <button
                  type="button"
                  onClick={() => voltarParaIdle({ limpar: false })}
                  className={btnSecondary}
                >
                  {m.tentarNovamente}
                </button>
              </div>
            </>
          ) : loadFailed || view == null ? (
            // A Receita FOI criada (success/degraded/playful) mas o GET do corpo falhou.
            // NÃO dizer 'impossível' (factualmente errado → o usuário reenviaria e DUPLICARIA
            // a geração). Oferecer recarregar a Receita já criada.
            <>
              <p className="text-fg">{m.erroCarregarReceita}</p>
              {result.advisory && <p className="max-w-[60ch] text-muted">{result.advisory}</p>}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setStatus('loading')
                    void carregarReceita(result)
                  }}
                  className={btnSecondary}
                >
                  {m.tentarCarregarNovamente}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Banner de desfecho — neutro (âmbar é EXCLUSIVO do Aviso de restrição). */}
              {result.outcome === 'playful' ? (
                <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-4 py-3">
                  <p className="font-medium text-fg">{m.playfulTitulo}</p>
                  <p className="text-sm text-muted">{m.playfulNota}</p>
                </div>
              ) : (
                <p className="font-medium text-fg">
                  {result.outcome === 'degraded' ? m.resultadoDegradado : m.resultadoSucesso}
                </p>
              )}

              {/* Comentário consultivo (advisory) — FORA do objeto Receita (CONTEXT.md). */}
              {result.advisory && (
                <p className="max-w-[60ch] text-muted">
                  <span className="font-medium text-fg">{m.consultoria}:</span> {result.advisory}
                </p>
              )}

              {/* A Receita — REUSO total. O `<h1>{view.name}` aqui é o ÚNICO `<h1>`. */}
              <RecipeDetailView view={view} m={messages} />

              <div className="flex flex-wrap items-center gap-3">
                {/* A Receita JÁ está persistida (private). "Ver receita" só NAVEGA pro
                    detalhe (#59), onde moram os controles de Visibilidade — não escreve nada
                    (glossário: salvar ≠ navegar). */}
                {result.recipeId && (
                  <Link href={`/recipes/${result.recipeId}`} className={btnPrimary}>
                    {m.verReceita}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => voltarParaIdle({ limpar: true })}
                  className={btnSecondary}
                >
                  {m.criarOutra}
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  )
}
