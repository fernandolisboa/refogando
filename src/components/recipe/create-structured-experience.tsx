'use client'
/**
 * Tela CRIAR (#58 estruturada + #88 prompt aberto) — o cérebro client com TODO o estado e
 * os fetches. DOIS modos de entrada que CONVERGEM para o MESMO resultado:
 *  - Estruturado (#58): monta o Briefing por campos.
 *  - Prompt aberto (#88): uma `textarea` de texto livre. O backend aceita `mode:'free_text'`
 *    em `POST /api/generations` (valida comprimento, monta o prompt, persiste
 *    `origin='ai_free_text'`) e devolve o MESMO shape `{ outcome, recipeId, advisory, avisos? }`.
 * Por isso o pipeline de resultado/erro/avisos é COMPARTILHADO (nenhum componente novo). O
 * nome `...Structured` ficou impreciso, mas renomear espalharia o diff sem ganho — mantido.
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
import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RESTRICOES, UNIDADES, PORCOES, DIFICULDADE } from '@/domain/vocabulary'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { STRENGTHS, type Strength } from '@/domain/briefing'
import { useRecipeGeneration, mapErroMensagem } from '@/hooks/use-recipe-generation'
import { FacetFieldset, type FacetOption } from './facet-fieldset'
import { GenerationResultRegion } from './generation-result-region'
import { SortToggle } from './sort-toggle'

/** Modo de entrada da tela: por campos (#58) ou texto livre (#88). */
type Mode = 'structured' | 'free_text'

/**
 * Limites do texto livre — UX LEVE (espelham as constantes do servidor; o handler revalida
 * TUDO). Ambos medidos sobre `freeText.trim().length`. `FREE_TEXT_MAX` == `OBSERVACOES_MAX`.
 */
const FREE_TEXT_MIN = 10
const FREE_TEXT_MAX = 2000

// "Outra" (#319): valor-sentinela da opção cozinha-livre no <select>. Tem `-` ⇒ slugify dobraria
// p/ vazio, então NUNCA colide com um slug de cozinha real (que jamais começa/termina com hífen).
const OUTRA_SENTINEL = '__outra__'

/** Rascunho de UM item do Briefing no formulário. `strength` NASCE 'required' (o servidor
 *  exige uma força válida em todo item). `ingredientId` nunca é exposto (catálogo ADIADO). */
type ItemDraft = {
  rawText: string
  quantidade: string
  unidade: string
  strength: Strength
}

function novoItem(): ItemDraft {
  return { rawText: '', quantidade: '', unidade: '', strength: 'required' }
}

/**
 * Entrada inteligente (#112): comprimentos da entrada de texto natural — UX LEVE (espelham o
 * servidor; a rota revalida). Medidos sobre `entradaInteligente.trim().length`.
 */
const ENTRADA_MIN = 10
const ENTRADA_MAX = 600

/**
 * `true` SÓ quando `itens` é exatamente uma linha-default em branco: length===1 E todos os
 * campos vazios (rawText/quantidade/unidade === '' — estrito; `strength` 'required' default
 * é ignorada, não conta como conteúdo). Usado para SUBSTITUIR essa linha-vazia inicial pelos
 * itens extraídos (em vez de empilhar uma linha morta no topo). Qualquer trabalho real numa
 * linha — texto, quantidade ou unidade — torna `false` (APPEND preserva o que o Usuário tem).
 */
function isOnlyEmptyDefaultRow(itens: ItemDraft[]): boolean {
  if (itens.length !== 1) return false
  const [it] = itens
  return it.rawText === '' && it.quantidade === '' && it.unidade === ''
}

export function CreateStructuredExperience({
  // #166: termo vindo do CTA "Gerar com IA" da Busca (via /create?q=<termo>). Quando presente,
  // SEMEIA o texto livre e abre direto no PROMPT ABERTO — o usuário ainda revisa e aciona "Gerar
  // receita" (a Busca nunca gera sozinha). É só uma SEMENTE inicial: o campo segue editável e
  // "Criar outra receita" o zera como qualquer outro estado.
  initialFreeText,
  // #191 (ADR-0021): quando montado DENTRO do drawer "Nova receita" no caminho Prompt aberto, o
  // método já foi escolhido no método-picker — o modo de entrada é FIXO em `free_text` e o toggle
  // interno (Estruturado ↔ Prompt aberto) some (`hideModeToggle`). Defaults preservam o
  // comportamento da /create (modo derivado da semente, toggle visível) — sem regressão.
  forceMode,
  hideModeToggle = false,
  // #191 (ADR-0021, dec. 5): quando montado no drawer "aberto e bloqueante", o shell precisa saber
  // se uma geração está EM VOO para travar o dismiss (ESC/scrim/X) — fechar no meio orfanaria o
  // POST (o servidor conclui, cria a Receita e consome cap, mas o usuário não vê). Callback ADITIVO:
  // a /create não o passa (sem regressão). Espelha `status === 'loading'`.
  onLoadingChange,
}: {
  initialFreeText?: string
  forceMode?: Mode
  hideModeToggle?: boolean
  onLoadingChange?: (loading: boolean) => void
} = {}) {
  const { locale, messages } = useLocale()
  const m = messages.criar
  const cozinhaVocab = useCozinhaVocab() // #317: opções de cozinha do leitor data-driven
  const session = useSession()

  // Modo de entrada (#88). Alternar NÃO limpa o ramo oposto (sem perda de trabalho): o
  // estruturado e o `freeText` coexistem; só "Criar outra receita" zera ambos (mantém o modo).
  // MAS o estado de ERRO é efêmero por modo: a mensagem é específica do ramo que a disparou
  // (ex.: `free_text_vazio`), então alternar de modo a DESCARTA (ver `trocarModo`) — senão
  // ela vazaria pro outro ramo, onde não faz sentido. Só error/errorKey vazam (o resultado
  // some no `!isResult`); os campos/freeText são preservados de propósito.
  // #166: com `?q` presente, a semente abre no Prompt aberto com o termo já no campo.
  // #191: `forceMode` (do drawer) tem precedência sobre a semente para o modo inicial.
  const seed = initialFreeText?.trim() ?? ''
  const [mode, setMode] = useState<Mode>(forceMode ?? (seed !== '' ? 'free_text' : 'structured'))
  const [freeText, setFreeText] = useState(seed)

  const [cozinha, setCozinha] = useState('')
  // "Outra" (#319, ADR-0025 Decisão 5): cozinha-livre. `outraAtiva` liga o campo de texto (distinto
  // do slug `cozinha`); o servidor materializa o termo `suggested` e o estampa na Receita.
  const [outraAtiva, setOutraAtiva] = useState(false)
  const [outra, setOutra] = useState('')
  const [restricoes, setRestricoes] = useState<string[]>([])
  const [porcoes, setPorcoes] = useState('')
  const [dificuldade, setDificuldade] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [itens, setItens] = useState<ItemDraft[]>([novoItem()])

  // Entrada inteligente (#112): texto natural de ingredientes + estado de extração (separado
  // do `status` da geração — extrair NÃO trava a geração, só o botão Estruturar). `itemErrors`
  // marca linhas cuja `unidade` voltou null da Extração, por índice ABSOLUTO em `itens`.
  const [entradaInteligente, setEntradaInteligente] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState(false)
  const [itemErrors, setItemErrors] = useState<Record<number, string>>({})

  // Motor de geração COMPARTILHADO (#193): POST /api/generations + 2º GET do corpo, e os estados
  // status/result/view/errorKey/loadFailed + foco-no-swap (headingRef) + onLoadingChange. Este
  // componente só monta o `body` (Briefing/freeText) e chama `enviar`/`carregarReceita`.
  const {
    status,
    result,
    view,
    errorKey,
    loadFailed,
    headingRef,
    enviar,
    carregarReceita,
    voltarParaIdle: voltarParaIdleEngine,
    setStatus,
    setErrorKey,
  } = useRecipeGeneration({ locale, onLoadingChange })

  // ── Helpers de estado dos itens ────────────────────────────────────────────
  function patchItem(index: number, patch: Partial<ItemDraft>) {
    setItens((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  function addItem() {
    setItens((prev) => [...prev, novoItem()])
  }
  function removeItem(index: number) {
    setItens((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
    // Remover uma linha reindexaria `itemErrors` (chaveado por índice absoluto) — limpar TUDO
    // evita um erro grudar na linha errada (off-by-one). #112.
    setItemErrors({})
  }

  /**
   * Entrada inteligente (#112): POST o texto natural em /api/parse-ingredients; em 200, APPEND
   * as linhas extraídas a `itens` — EXCETO quando `itens` é só a linha-default vazia, que é
   * SUBSTITUÍDA (sem empilhar uma linha morta). Linhas cuja `unidade` voltou null ganham um erro
   * por-linha (`itemUnidadeDesconhecida`), chaveado pelo índice ABSOLUTO final. Limpa a textarea
   * no sucesso. Em não-2xx/rede, mostra `erroEstruturacao` e DEIXA as linhas existentes intactas.
   * NÃO trava os botões de linha nem "Gerar receita" — só o botão Estruturar (via `extracting`).
   */
  async function estruturar() {
    const texto = entradaInteligente.trim()
    if (texto.length < ENTRADA_MIN || extracting) return
    setExtracting(true)
    setExtractError(false)
    try {
      const res = await fetch('/api/parse-ingredients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawInput: texto }),
      })
      if (!res.ok) {
        setExtractError(true)
        return
      }
      const data = (await res.json()) as {
        items: { rawText: string; quantidade: string | null; unidade: string | null; strength: Strength }[]
      }
      const novas: ItemDraft[] = data.items.map((it) => ({
        rawText: it.rawText,
        quantidade: it.quantidade ?? '',
        unidade: it.unidade ?? '',
        strength: it.strength,
      }))
      setItens((prev) => {
        const base = isOnlyEmptyDefaultRow(prev) ? [] : prev
        const combinado = [...base, ...novas]
        // Marca cada linha NOVA cuja unidade veio null: índice absoluto = offset da base + i.
        setItemErrors((prevErr) => {
          const next = { ...prevErr }
          data.items.forEach((it, i) => {
            if (it.unidade == null) next[base.length + i] = m.itemUnidadeDesconhecida
          })
          return next
        })
        return combinado
      })
      setEntradaInteligente('')
    } catch {
      setExtractError(true)
    } finally {
      setExtracting(false)
    }
  }

  function toggleRestricao(value: string) {
    setRestricoes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  // Troca de modo: preserva o trabalho dos dois ramos (campos + freeText), mas DESCARTA o
  // estado de erro do ramo anterior — a mensagem é específica daquele modo e não deve vazar
  // pro outro. Sem isso, um `free_text_vazio` continuaria visível embaixo do formulário
  // estruturado (e vice-versa).
  function trocarModo(next: Mode) {
    setMode(next)
    if (status === 'error') {
      setErrorKey(null)
      setStatus('idle')
    }
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
    // "Outra" (#319): no modo Outra, `briefing.cozinha` vai null e o texto sobe top-level em
    // `cozinhaOutra` — o servidor materializa o termo `suggested`. Fora do modo, segue o slug.
    const cozinhaOutra = outraAtiva ? outra.trim() : ''
    return {
      mode: 'structured' as const,
      briefing: {
        cozinha: outraAtiva ? null : cozinha || null,
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
      ...(cozinhaOutra !== '' ? { cozinhaOutra } : {}),
    }
  }

  // Briefing "vazio" = sem item válido E sem cozinha E sem restrição E sem observação.
  // porções/dificuldade sozinhas NÃO contam (fiel a `isBriefingVazio`: são modificadores).
  // "Outra" (#319) com texto conta como cozinha preenchida (não é briefing vazio).
  const briefingVazio =
    itensComTexto.length === 0 &&
    cozinha === '' &&
    !(outraAtiva && outra.trim() !== '') &&
    restricoes.length === 0 &&
    observacoes.trim() === ''

  function resetCampos() {
    setCozinha('')
    setOutraAtiva(false)
    setOutra('')
    setRestricoes([])
    setPorcoes('')
    setDificuldade('')
    setObservacoes('')
    setItens([novoItem()])
    setFreeText('')
    // Entrada inteligente (#112): zera junto numa nova receita.
    setEntradaInteligente('')
    setExtractError(false)
    setItemErrors({})
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'loading') return // evita re-entrada / geração duplicada (duplo-clique)
    setErrorKey(null)

    if (mode === 'free_text') {
      // Validação leve (UX) sobre o texto TRIMADO — espelha o servidor. > MAX é alcançável
      // (o textarea dá folga de maxLength) e barrado aqui com mensagem clara.
      const texto = freeText.trim()
      if (texto.length < FREE_TEXT_MIN) {
        setErrorKey('free_text_vazio')
        setStatus('error')
        return
      }
      if (texto.length > FREE_TEXT_MAX) {
        setErrorKey('free_text_muito_longo')
        setStatus('error')
        return
      }
      await enviar({ mode: 'free_text', freeText: texto })
      return
    }

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

    await enviar(buildBody())
  }

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
        <Button asChild>
          <Link href="/sign-in">{messages.nav.signIn}</Link>
        </Button>
      </div>
    )
  }

  const restricaoOptions: FacetOption[] = RESTRICOES.map((value) => ({
    value,
    label: messages.restricaoLabel[value],
  }))

  const isResult = status === 'result'
  // Texto livre ACIMA do teto (a folga do maxLength permite 2001–2200): sinaliza o erro de
  // forma proativa no contador + aria-invalid, antes do submit.
  const freeTextOver = freeText.trim().length > FREE_TEXT_MAX
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
        {!isResult && (
          <p className="max-w-[60ch] text-muted">
            {mode === 'free_text' ? m.descricaoPromptAberto : m.descricao}
          </p>
        )}
      </div>

      {/* Alternância de modo (#88) — REUSO do `SortToggle` (segmented control puro: par
          ativo/inativo com padding idêntico ⇒ sem salto; `role="group"` + rótulo visível +
          `aria-pressed`). Fica FORA do `<form>`/`<fieldset disabled>` do loading: trocar de
          modo durante a geração é benigno (não dispara fetch; o submit do ramo certo já está
          travado pelo fieldset). Some no resultado. #191: oculto no drawer (`hideModeToggle`) —
          lá o método já foi escolhido no método-picker. */}
      {!isResult && !hideModeToggle && (
        <SortToggle<Mode>
          value={mode}
          onChange={trocarModo}
          options={[
            { key: 'structured', label: m.modoEstruturado },
            { key: 'free_text', label: m.modoPromptAberto },
          ]}
          groupLabel={m.modoLegenda}
          labelId="create-mode-label"
        />
      )}

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
          {mode === 'structured' ? (
            <>
          {/* Ingredientes */}
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-sm font-medium text-fg">{m.legendaIngredientes}</legend>

            {/* Entrada inteligente (#112): texto natural → linhas estruturadas (pré-preenchidas).
                A IA ORGANIZA o que o Usuário escreveu; NÃO inventa nem gera a receita. Vive DENTRO
                do <fieldset disabled={loading}> (some/destrava com a geração) mas o botão
                Estruturar só trava por `extracting` — extrair não bloqueia "Gerar receita". */}
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:p-4">
              <label htmlFor="entrada-inteligente" className="text-sm font-medium text-fg">
                {m.entradaInteligente}
              </label>
              <Textarea
                id="entrada-inteligente"
                rows={3}
                maxLength={ENTRADA_MAX}
                value={entradaInteligente}
                onChange={(e) => setEntradaInteligente(e.target.value)}
                placeholder={m.entradaPlaceholder}
                className="resize-y"
              />
              <p className="text-xs text-muted">{m.entradaDistincao}</p>
              {extractError && (
                <p
                  role="alert"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg"
                >
                  {m.erroEstruturacao}
                </p>
              )}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={estruturar}
                  aria-busy={extracting || undefined}
                  disabled={entradaInteligente.trim().length < ENTRADA_MIN || extracting}
                >
                  {extracting ? m.estruturando : m.estruturar}
                </Button>
              </div>
            </div>

            <ul role="list" className="flex flex-col gap-5">
              {itens.map((item, index) => (
                <li
                  key={index}
                  className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-fg">
                      {`${m.ingrediente} ${index + 1}`}
                      <Input
                        type="text"
                        value={item.rawText}
                        onChange={(e) => patchItem(index, { rawText: e.target.value })}
                        placeholder={m.ingredientePlaceholder}
                      />
                    </label>
                    <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-28">
                      {m.quantidade}
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={item.quantidade}
                        onChange={(e) => patchItem(index, { quantidade: e.target.value })}
                        placeholder={m.quantidadePlaceholder}
                      />
                    </label>
                    <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
                      {m.unidade}
                      <select
                        value={item.unidade}
                        onChange={(e) => {
                          patchItem(index, { unidade: e.target.value })
                          // Trocar a unidade desta linha LIMPA o seu erro de "unidade
                          // desconhecida" (#112): o Usuário resolveu o que a Extração não sabia.
                          setItemErrors((prev) => {
                            if (!(index in prev)) return prev
                            const next = { ...prev }
                            delete next[index]
                            return next
                          })
                        }}
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
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => removeItem(index)}
                      disabled={itens.length <= 1}
                      aria-label={`${m.removerIngrediente} ${index + 1}`}
                    >
                      {m.removerIngrediente}
                    </Button>
                  </div>
                  {/* Erro por-linha (#112): a Extração não reconheceu a unidade desta linha.
                      Neutro (NÃO âmbar — âmbar é exclusivo do Aviso de restrição). Some quando
                      o Usuário escolhe uma unidade no <select> acima. */}
                  {itemErrors[index] && (
                    <p className="text-sm font-medium text-fg">{itemErrors[index]}</p>
                  )}
                </li>
              ))}
            </ul>
            <div>
              {/* Ghost sm com "+" (protótipo): afordância leve de adicionar linha. */}
              <Button type="button" variant="ghost" size="sm" onClick={addItem}>
                + {m.adicionarIngrediente}
              </Button>
            </div>
          </fieldset>

          {/* Cozinha */}
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:max-w-xs">
            {m.cozinha}
            <select
              value={outraAtiva ? OUTRA_SENTINEL : cozinha}
              onChange={(e) => {
                // "Outra" (#319): a opção-sentinela liga o modo cozinha-livre; qualquer slug o desliga.
                if (e.target.value === OUTRA_SENTINEL) {
                  setOutraAtiva(true)
                  setCozinha('')
                } else {
                  setOutraAtiva(false)
                  setCozinha(e.target.value)
                }
              }}
              className={inputCls}
            >
              <option value="">{m.cozinhaNenhuma}</option>
              {/* #317: opções vêm do leitor data-driven (contexto), já localizadas. */}
              {cozinhaVocab.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              {/* "Outra" (#319): cozinha fora do vocabulário → vira sugestão pro Curador. */}
              <option value={OUTRA_SENTINEL}>{messages.criarWizard.cozinhaOutra}</option>
            </select>
          </label>
          {outraAtiva && (
            <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:max-w-xs">
              {messages.criarWizard.cozinhaOutraLabel}
              <Input
                type="text"
                value={outra}
                onChange={(e) => setOutra(e.target.value)}
                placeholder={messages.criarWizard.cozinhaOutraPlaceholder}
              />
            </label>
          )}

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
              <Input
                type="number"
                min={PORCOES.min}
                max={PORCOES.max}
                value={porcoes}
                onChange={(e) => setPorcoes(e.target.value)}
              />
            </label>
            <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
              {m.dificuldade}
              <Input
                type="number"
                min={DIFICULDADE.min}
                max={DIFICULDADE.max}
                value={dificuldade}
                onChange={(e) => setDificuldade(e.target.value)}
              />
            </label>
          </div>

          {/* Observações */}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
            {m.observacoes}
            <Textarea
              rows={3}
              maxLength={2000}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder={m.observacoesPlaceholder}
              className="resize-y"
            />
          </label>
            </>
          ) : (
            /* Ramo PROMPT ABERTO (#88) — uma `textarea` de texto livre. `maxLength` com FOLGA
               (`+200`): permite o usuário REAL exceder `FREE_TEXT_MAX` e ver `erroTextoMuitoLongo`
               (com o limite cru, esse ramo seria UI morta para humanos). Contador NEUTRO
               (`text-muted`, nunca âmbar — âmbar é EXCLUSIVO do Aviso de restrição). Label
               associada por `htmlFor`/`id` (NÃO embrulhando a textarea) — assim o nome acessível
               da textarea é SÓ o rótulo, sem o texto do contador vazar para dentro dele. */
            <div className="flex flex-col gap-1.5">
              <label htmlFor="free-text" className="text-sm font-medium text-fg">
                {m.textareaLabel}
              </label>
              <Textarea
                id="free-text"
                rows={6}
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder={m.textareaPlaceholder}
                maxLength={FREE_TEXT_MAX + 200}
                aria-describedby="free-text-contador"
                aria-invalid={freeTextOver || undefined}
                className="resize-y"
              />
              {/* Contador NEUTRO no caso normal; ao ULTRAPASSAR o teto (2001–2200, a folga do
                  maxLength) ele antecipa o estado de erro com peso/cor de FG — NUNCA âmbar
                  (reservado ao Aviso de restrição) nem vermelho. Assim o ceiling deixa de ser
                  feedback só-pós-submit. */}
              <span
                id="free-text-contador"
                className={freeTextOver ? 'text-xs font-medium text-fg' : 'text-xs text-muted'}
              >
                {freeText.trim().length}/{FREE_TEXT_MAX}
              </span>
            </div>
          )}

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
            <Button
              type="submit"
              size="lg"
              aria-busy={status === 'loading'}
              disabled={
                status === 'loading' ||
                (mode === 'free_text' && freeText.trim().length < FREE_TEXT_MIN)
              }
            >
              {status === 'loading' ? m.gerando : m.gerar}
            </Button>
          </div>
          </fieldset>
        </form>
      )}

      {/* Região de resultado — renderizada SEMPRE (mesmo vazia) para que o `aria-live` PRÉ-
          exista no DOM: regiões live inseridas junto do conteúdo não são anunciadas por muitos
          leitores de tela (padrão de search-experience). O conteúdo entra/sai DENTRO dela.
          `GenerationResultRegion` (#193) desenha o desfecho a partir do bag do motor. */}
      <div aria-live="polite" className="flex flex-col gap-6">
        {isResult && result != null && (
          <GenerationResultRegion
            result={result}
            view={view}
            loadFailed={loadFailed}
            messages={messages}
            locale={locale}
            onRecarregar={() => {
              setStatus('loading')
              void carregarReceita(result)
            }}
            // 'impossible' → volta ao form SEM limpar (era `voltarParaIdle({ limpar: false })`).
            onTentarNovamente={voltarParaIdleEngine}
            // "Criar outra" → volta ao form LIMPANDO o Briefing (era `{ limpar: true }`): o motor
            // não conhece `resetCampos`, então zeramos os campos locais aqui antes do reset do motor.
            onCriarOutra={() => {
              resetCampos()
              voltarParaIdleEngine()
            }}
          />
        )}
      </div>
    </div>
  )
}
