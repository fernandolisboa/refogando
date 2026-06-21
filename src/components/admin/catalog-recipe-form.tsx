'use client'

/**
 * Form de criação estruturada de Receita de CATÁLOGO (#85) — subseção da Curadoria.
 *
 * ADR-0010: consome `POST /api/curate/recipes` via `fetch` — NÃO Server Action. NÃO
 * reimplementa regra de domínio: a validação leve abaixo é só UX (evita o round-trip óbvio
 * de título vazio); o servidor revalida TUDO (enums, faixas, locale, tipos) e é a fonte de
 * verdade. `origin=catalog`, visibilidade e provenance são impostos pelo servidor — não há
 * campo no form para eles.
 *
 * SEM guard de sessão no client (diferente de #58): a page `/admin` já gateia o acesso e o
 * backend reimpõe `requireRole('curador')`. Duplicar o gate aqui seria reimplementar regra.
 * Se a sessão caducou, a rota responde 401/403 e o form mostra erro neutro genérico.
 *
 * Tamanho de botão: este form usa `btnPrimary`/`btnSecondary` (cheios), enquanto a subseção
 * irmã de ingredientes recorrentes (CatalogCuration) usa `btnPrimarySm`/`btnSecondarySm`. É
 * hierarquia deliberada — a área de form pede ações maiores; a lista de promoção é compacta.
 * A coexistência dos dois tamanhos sob a mesma <section> é decisão, não drift.
 *
 * Cores: só neutros/brand (tokens AA já verificados na #54). NUNCA âmbar (exclusivo do Aviso
 * de restrição, ADR-0015 — não há Aviso aqui) nem accent (selo de Catálogo — não há badge a
 * renderizar). Erros = neutro com role="alert", espelhando #58/auth-form.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { fieldClassName } from '@/components/button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FacetFieldset, type FacetOption } from '@/components/recipe/facet-fieldset'
import {
  COZINHAS,
  CATEGORIAS,
  RESTRICOES,
  UNIDADES,
  PORCOES,
  DIFICULDADE,
} from '@/domain/vocabulary'
import { SUPPORTED_LOCALES } from '@/i18n/locale'
import type { Messages } from '@/i18n/messages'

/**
 * Os valores de `SUPPORTED_LOCALES` são 'pt-BR'/'en-US', mas as chaves de label em
 * `messages.locale` são `ptBR`/`enUS`. Mapa explícito value→labelKey (indexar
 * `messages.locale['pt-BR']` direto não compila — a chave não existe).
 */
const LOCALE_LABEL_KEY = { 'pt-BR': 'ptBR', 'en-US': 'enUS' } as const

/** `id` estável por linha para a `key` do React: listas dinâmicas (add/remove) sofrem
 *  reconciliação errada com `key={index}` (reuso de nós por posição → perda de foco). O id
 *  NÃO vai no body — é só identidade de UI. */
function novoId(): string {
  return crypto.randomUUID()
}

/** Rascunho de UM ingrediente. Mais simples que o `ItemDraft` de #58: a rota de catálogo
 *  NÃO aceita `strength` (conceito de Briefing) — só rawText/quantidade/unidade. */
type ItemDraft = { id: string; rawText: string; quantidade: string; unidade: string }
function novoItem(): ItemDraft {
  return { id: novoId(), rawText: '', quantidade: '', unidade: '' }
}

/** Rascunho de UM passo — objeto (não string) só para carregar um `id` estável de UI. */
type PassoDraft = { id: string; texto: string }
function novoPasso(): PassoDraft {
  return { id: novoId(), texto: '' }
}

type Status = 'idle' | 'loading' | 'success' | 'error'
type ErrorKey = 'dados_invalidos' | 'titulo_obrigatorio' | 'erroConexao' | 'erroGenerico'

function mapErro(m: Messages['curadoria'], key: ErrorKey): string {
  switch (key) {
    case 'titulo_obrigatorio':
      return m.criarReceitaErroTitulo
    case 'dados_invalidos':
      return m.criarReceitaErroDados
    case 'erroConexao':
      return m.criarReceitaErroConexao
    case 'erroGenerico':
    default:
      return m.criarReceitaErroGenerico
  }
}

export function CatalogRecipeForm() {
  const { locale, messages } = useLocale()
  const m = messages.curadoria

  const [titulo, setTitulo] = useState('')
  const [originalLocale, setOriginalLocale] = useState<string>(locale)
  const [descricao, setDescricao] = useState('')
  const [cozinha, setCozinha] = useState('')
  const [categoria, setCategoria] = useState('')
  const [restricoes, setRestricoes] = useState<string[]>([])
  const [porcoes, setPorcoes] = useState('')
  const [dificuldade, setDificuldade] = useState('')
  const [itens, setItens] = useState<ItemDraft[]>([novoItem()])
  const [passos, setPassos] = useState<PassoDraft[]>([novoPasso()])
  const [notas, setNotas] = useState('')

  const [status, setStatus] = useState<Status>('idle')
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null)

  // Bloco de status/erro vive logo acima do botão de submit (fim do form longo). No sucesso,
  // o form reseta in-place e o foco vai para esta confirmação (mesmo padrão do #58 com
  // headingRef) — sem isso o usuário visual veria o form esvaziar sem feedback próximo. Focar
  // num effect (não num rAF solto) mantém o foco DENTRO do ciclo do React: flushado no `act`
  // dos testes, sem callback vazando entre casos.
  const feedbackRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (status === 'success') feedbackRef.current?.focus()
  }, [status])

  // O form NÃO desmonta no sucesso (reseta in-place), então a confirmação "Receita criada"
  // pairaria sobre a PRÓXIMA receita até o próximo submit. Limpamos a confirmação na primeira
  // interação do usuário com qualquer campo após o sucesso — determinístico, sem setTimeout.
  function clearSuccess() {
    if (status === 'success') setStatus('idle')
  }

  // ── Helpers de ingredientes ────────────────────────────────────────────────
  function patchItem(index: number, key: keyof ItemDraft, value: string) {
    clearSuccess()
    setItens((prev) => prev.map((it, i) => (i === index ? { ...it, [key]: value } : it)))
  }
  function addItem() {
    clearSuccess()
    setItens((prev) => [...prev, novoItem()])
  }
  function removeItem(index: number) {
    clearSuccess()
    setItens((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  // ── Helpers de passos ──────────────────────────────────────────────────────
  function patchPasso(index: number, value: string) {
    clearSuccess()
    setPassos((prev) => prev.map((p, i) => (i === index ? { ...p, texto: value } : p)))
  }
  function addPasso() {
    clearSuccess()
    setPassos((prev) => [...prev, novoPasso()])
  }
  function removePasso(index: number) {
    clearSuccess()
    setPassos((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  function toggleRestricao(value: string) {
    clearSuccess()
    setRestricoes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  function resetForm() {
    setTitulo('')
    setOriginalLocale(locale)
    setDescricao('')
    setCozinha('')
    setCategoria('')
    setRestricoes([])
    setPorcoes('')
    setDificuldade('')
    setItens([novoItem()])
    setPassos([novoPasso()])
    setNotas('')
  }

  // porcoes/dificuldade: '' → null; valor numérico → number; QUALQUER coisa não-numérica
  // (NaN) → null explícito, para não serializar `NaN` como `null` em silêncio. O servidor é
  // a fonte de verdade; isto só evita descarte silencioso confuso.
  function parseIntOuNull(raw: string): number | null {
    if (raw.trim() === '') return null
    const n = Number(raw)
    return Number.isNaN(n) ? null : n
  }

  // Monta EXATAMENTE o shape de POST /api/curate/recipes. `quantidade` permanece string|null
  // (numeric trafega como string — NUNCA Number). `porcoes`/`dificuldade` são number|null.
  function buildBody() {
    const itensComTexto = itens.filter((it) => it.rawText.trim() !== '')
    const passosLimpos = passos.map((p) => p.texto.trim()).filter((p) => p !== '')
    return {
      originalLocale,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      passos: passosLimpos.length > 0 ? passosLimpos : null,
      notas: notas.trim() || null,
      cozinha: cozinha || null,
      categoria: categoria || null,
      restricoes, // sempre array (default [])
      porcoes: parseIntOuNull(porcoes),
      dificuldade: parseIntOuNull(dificuldade),
      ingredientes: itensComTexto.map((it) => ({
        rawText: it.rawText.trim(),
        quantidade: it.quantidade.trim() === '' ? null : it.quantidade.trim(),
        unidade: it.unidade || null,
      })),
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'loading') return // evita re-entrada / criação duplicada (duplo-clique)
    setErrorKey(null)

    // Validação leve (UX) — o servidor revalida tudo.
    if (titulo.trim() === '') {
      setErrorKey('titulo_obrigatorio')
      setStatus('error')
      return
    }

    setStatus('loading')
    try {
      const res = await fetch('/api/curate/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildBody()),
      })
      if (res.status === 400) {
        setErrorKey('dados_invalidos')
        setStatus('error')
        return
      }
      if (!res.ok) {
        // 401/403/5xx → erro genérico neutro (segue #58; o gate de /admin torna 401/403 raros).
        setErrorKey('erroGenerico')
        setStatus('error')
        return
      }
      setStatus('success')
      resetForm() // limpa o form imediatamente no sucesso (a confirmação some na 1ª interação)
      // O foco vai para a confirmação via useEffect([status]) — ela montou no mesmo render.
    } catch {
      setErrorKey('erroConexao')
      setStatus('error')
    }
  }

  const restricaoOptions: FacetOption[] = RESTRICOES.map((value) => ({
    value,
    label: messages.restricaoLabel[value],
  }))

  const labelCls = 'flex w-full flex-col gap-1.5 text-sm font-medium text-fg'

  return (
    <section
      aria-labelledby="criar-receita-titulo"
      className="flex flex-col gap-4 border-t border-border pt-6"
    >
      <h3 id="criar-receita-titulo" className="text-base font-semibold text-fg">
        {m.criarReceitaTitulo}
      </h3>
      <p className="max-w-prose text-sm text-muted">{m.criarReceitaDescricao}</p>

      <form onSubmit={onSubmit} aria-busy={status === 'loading'}>
        {/* `disabled` durante o loading trava TODOS os controles de uma vez, honrando o
            aria-busy do form. */}
        <fieldset
          disabled={status === 'loading'}
          className="flex min-w-0 flex-col gap-6 border-0 p-0 disabled:opacity-60"
        >
          {/* Título (obrigatório) + Idioma original (obrigatório) — empilha no mobile. */}
          <div className="flex flex-col gap-4 sm:flex-row">
            <label className={`${labelCls} min-w-0 flex-1`}>
              <span>
                {m.criarReceitaTituloCampo}{' '}
                <span className="font-normal text-muted">{m.criarReceitaObrigatorio}</span>
              </span>
              <Input
                type="text"
                value={titulo}
                onChange={(e) => {
                  clearSuccess()
                  setTitulo(e.target.value)
                }}
                placeholder={m.criarReceitaTituloPlaceholder}
                aria-required="true"
              />
            </label>
            <label className={`${labelCls} sm:w-56`}>
              {m.criarReceitaIdiomaOriginal}
              <select
                value={originalLocale}
                onChange={(e) => {
                  clearSuccess()
                  setOriginalLocale(e.target.value)
                }}
                className={fieldClassName}
              >
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {messages.locale[LOCALE_LABEL_KEY[l]]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Descrição */}
          <label className={labelCls}>
            {m.criarReceitaDescricaoCampo}
            <Textarea
              rows={2}
              value={descricao}
              onChange={(e) => {
                clearSuccess()
                setDescricao(e.target.value)
              }}
              className="resize-y"
            />
          </label>

          {/* Ingredientes — lista dinâmica (rawText / quantidade / unidade), SEM força. */}
          <fieldset className="flex flex-col gap-4 border-0 p-0">
            <legend className="mb-1 text-sm font-medium text-fg">
              {m.criarReceitaIngredientes}
            </legend>
            <ul role="list" className="flex flex-col gap-3">
              {itens.map((item, index) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end sm:p-4"
                >
                  <label className={`${labelCls} min-w-0 flex-1`}>
                    {`${m.criarReceitaIngrediente} ${index + 1}`}
                    <Input
                      type="text"
                      value={item.rawText}
                      onChange={(e) => patchItem(index, 'rawText', e.target.value)}
                      placeholder={m.criarReceitaIngredientePlaceholder}
                    />
                  </label>
                  <label className={`${labelCls} sm:w-28`}>
                    {m.criarReceitaQuantidade}
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={item.quantidade}
                      onChange={(e) => patchItem(index, 'quantidade', e.target.value)}
                      placeholder={m.criarReceitaQuantidadePlaceholder}
                    />
                  </label>
                  <label className={`${labelCls} sm:w-40`}>
                    {m.criarReceitaUnidade}
                    <select
                      value={item.unidade}
                      onChange={(e) => patchItem(index, 'unidade', e.target.value)}
                      className={fieldClassName}
                    >
                      <option value="">{m.criarReceitaUnidadeNenhuma}</option>
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
                    aria-label={`${m.criarReceitaRemoverIngrediente} ${index + 1}`}
                  >
                    {m.criarReceitaRemoverIngrediente}
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <Button type="button" variant="secondary" onClick={addItem}>
                {m.criarReceitaAdicionarIngrediente}
              </Button>
            </div>
          </fieldset>

          {/* Cozinha + Categoria (selects, opcionais) */}
          <div className="flex flex-col gap-4 sm:flex-row">
            <label className={`${labelCls} sm:flex-1`}>
              {m.criarReceitaCozinha}
              <select
                value={cozinha}
                onChange={(e) => {
                  clearSuccess()
                  setCozinha(e.target.value)
                }}
                className={fieldClassName}
              >
                <option value="">{m.criarReceitaCozinhaNenhuma}</option>
                {COZINHAS.map((c) => (
                  <option key={c} value={c}>
                    {messages.cozinhaLabel[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${labelCls} sm:flex-1`}>
              {m.criarReceitaCategoria}
              <select
                value={categoria}
                onChange={(e) => {
                  clearSuccess()
                  setCategoria(e.target.value)
                }}
                className={fieldClassName}
              >
                <option value="">{m.criarReceitaCategoriaNenhuma}</option>
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {messages.categoriaLabel[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Restrições — REUSO de FacetFieldset (labels de messages.restricaoLabel). */}
          <FacetFieldset
            legend={m.criarReceitaRestricoes}
            options={restricaoOptions}
            selected={restricoes}
            onToggle={toggleRestricao}
          />

          {/* Porções + Dificuldade (number, faixas canônicas, step=1 sinaliza inteiro). */}
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
            <label className={`${labelCls} sm:w-40`}>
              {m.criarReceitaPorcoes}
              <Input
                type="number"
                min={PORCOES.min}
                max={PORCOES.max}
                step={1}
                value={porcoes}
                onChange={(e) => {
                  clearSuccess()
                  setPorcoes(e.target.value)
                }}
              />
            </label>
            <label className={`${labelCls} sm:w-40`}>
              {m.criarReceitaDificuldade}
              <Input
                type="number"
                min={DIFICULDADE.min}
                max={DIFICULDADE.max}
                step={1}
                value={dificuldade}
                onChange={(e) => {
                  clearSuccess()
                  setDificuldade(e.target.value)
                }}
              />
            </label>
          </div>

          {/* Modo de preparo — lista dinâmica de passos. */}
          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-medium text-fg">{m.criarReceitaPassos}</legend>
            <ol className="flex flex-col gap-2">
              {passos.map((passo, index) => (
                <li key={passo.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className={`${labelCls} min-w-0 flex-1`}>
                    {`${m.criarReceitaPasso} ${index + 1}`}
                    <Input
                      type="text"
                      value={passo.texto}
                      onChange={(e) => patchPasso(index, e.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => removePasso(index)}
                    disabled={passos.length <= 1}
                    aria-label={`${m.criarReceitaRemoverPasso} ${index + 1}`}
                  >
                    {m.criarReceitaRemoverPasso}
                  </Button>
                </li>
              ))}
            </ol>
            <div>
              <Button type="button" variant="secondary" onClick={addPasso}>
                {m.criarReceitaAdicionarPasso}
              </Button>
            </div>
          </fieldset>

          {/* Notas */}
          <label className={labelCls}>
            {m.criarReceitaNotas}
            <Textarea
              rows={2}
              value={notas}
              onChange={(e) => {
                clearSuccess()
                setNotas(e.target.value)
              }}
              className="resize-y"
            />
          </label>

          {/* Status JUNTO da ação (fim do form longo): <p role="status"> (sucesso, polite) e
              <p role="alert"> (erro, assertive) como IRMÃOS AUTÔNOMOS — cada role define sua
              própria polidez; sem wrapper aria-live fixo (evita conflito polite vs assertive).
              No sucesso o foco vem para cá (feedbackRef), então tabIndex={-1} + scroll-mt. */}
          {status === 'success' && (
            <p
              ref={feedbackRef}
              tabIndex={-1}
              role="status"
              className="scroll-mt-4 rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg outline-none"
            >
              {m.criarReceitaSucesso}
            </p>
          )}
          {status === 'error' && errorKey && (
            <p
              role="alert"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
            >
              {mapErro(m, errorKey)}
            </p>
          )}

          <div>
            <Button type="submit" aria-busy={status === 'loading'}>
              {status === 'loading' ? m.criarReceitaEnviando : m.criarReceitaEnviar}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
