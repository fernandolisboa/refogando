'use client'
/**
 * Tela de Busca (#56) — o cérebro client com TODO o estado e o fetch. É a home (#56,
 * Decisão 1): provê o ÚNICO `<main>` do documento (via `<Container as="main">`).
 *
 * ADR-0010: a UI consome o ROUTE HANDLER `GET /api/search` via `fetch` — NÃO Server
 * Actions. NÃO reimplementa regra de domínio: renderiza o que a rota devolve (seções já
 * vêm separadas e ordenadas; `classifySection` do domínio decide o selo). Bilíngue
 * (ADR-0014/0001): o locale resolvido entra na query (`?locale=`) e troca de idioma
 * re-busca no novo idioma.
 *
 * Estados tratados (impeccable): inicial neutro (sem critério → NÃO chama a API, espelha
 * o early-return do handler), carregando, erro+retry, vazio, sugestões.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { btnPrimary, btnSecondary } from '@/components/button'
import { COZINHAS, CATEGORIAS, RESTRICOES } from '@/domain/vocabulary'
import type { SearchResponse } from '@/domain/recipe-search-read'
import { FacetFieldset, type FacetOption } from './facet-fieldset'
import { SearchSection } from './search-section'
import { SortToggle } from './sort-toggle'
import type { BadgeLabels } from './recipe-result-item'

type Sort = 'relevancia' | 'popularidade'

type Status = 'idle' | 'loading' | 'done' | 'error'

const DEBOUNCE_MS = 300

export function SearchExperience() {
  const { locale, messages } = useLocale()
  const m = messages.busca

  // #116: estado de sessão SÓ para a CÓPIA (a dica inicial). O `viewerId` real e o gate vivem
  // no servidor (GET /api/search o resolve do cookie) — a UI nunca passa id nenhum. fail-open
  // (error / isPending) → trata como anônimo (dica de comunidade), sem travar a tela.
  const { data: session } = useSession()
  const dicaInicial = session ? m.dicaInicialLogado : m.dicaInicial

  const [q, setQ] = useState('')
  const [cozinha, setCozinha] = useState<string[]>([])
  const [categoria, setCategoria] = useState<string[]>([])
  const [restricao, setRestricao] = useState<string[]>([])
  // Ordenação da Comunidade (#62). `relevancia` é o default; só vai à URL quando difere
  // (espelha o estilo de `q`/facetas). Mudar `sort` re-monta `doSearch` ⇒ o effect
  // debounced re-busca. O servidor reordena SÓ a Comunidade (Catálogo é editorial, ADR-0003).
  const [sort, setSort] = useState<Sort>('relevancia')
  const [data, setData] = useState<SearchResponse | null>(null)
  const [status, setStatus] = useState<Status>('idle')

  // AbortController da requisição em voo: cancelar a anterior quando os critérios mudam
  // (debounce) ou no unmount. Uma req cancelada NÃO vira estado de erro (AbortError é
  // ignorado).
  const abortRef = useRef<AbortController | null>(null)

  const hasCriteria =
    q.trim() !== '' ||
    cozinha.length > 0 ||
    categoria.length > 0 ||
    restricao.length > 0

  const doSearch = useCallback(async () => {
    // Estado inicial neutro: sem critério, NÃO chama a API (espelha o early-return do
    // handler — evita req supérflua e tela branca).
    if (!hasCriteria) {
      abortRef.current?.abort()
      setData(null)
      setStatus('idle')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const url = new URL('/api/search', window.location.origin)
    if (q.trim() !== '') url.searchParams.set('q', q.trim())
    url.searchParams.set('locale', locale)
    if (cozinha.length > 0) url.searchParams.set('cozinha', cozinha.join(','))
    if (categoria.length > 0) url.searchParams.set('categoria', categoria.join(','))
    if (restricao.length > 0) url.searchParams.set('restricao', restricao.join(','))
    if (sort === 'popularidade') url.searchParams.set('sort', 'popularidade')

    setStatus('loading')
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        setStatus('error')
        return
      }
      const body: SearchResponse = await res.json()
      setData(body)
      setStatus('done')
    } catch (err) {
      // Req cancelada (critérios mudaram / unmount) não é erro de verdade.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setStatus('error')
    }
  }, [hasCriteria, q, locale, cozinha, categoria, restricao, sort])

  // Debounce: re-busca quando q / facetas / locale mudam. Locale muda → re-busca no novo
  // idioma (AC bilíngue). Cleanup limpa o timeout E aborta a req em voo.
  useEffect(() => {
    const t = setTimeout(() => {
      void doSearch()
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
    }
  }, [doSearch])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const toggle = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
      setter((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      ),
    [],
  )

  const cozinhaOptions: FacetOption[] = COZINHAS.map((value) => ({
    value,
    label: messages.cozinhaLabel[value],
  }))
  const categoriaOptions: FacetOption[] = CATEGORIAS.map((value) => ({
    value,
    label: messages.categoriaLabel[value],
  }))
  const restricaoOptions: FacetOption[] = RESTRICOES.map((value) => ({
    value,
    label: messages.restricaoLabel[value],
  }))

  const badgeLabels: BadgeLabels = {
    catalogo: m.seloCatalogo,
    comunidade: m.seloComunidade,
  }
  // #116/own-label: rótulo do selo "Sua receita" (item próprio do viewer).
  const ownLabel = m.seloMinha

  // Há resultados para mostrar SE a última busca concluída trouxe ao menos um item. Usamos
  // `data` (não `status`) para manter os resultados na tela durante um refresh (stale-
  // while-revalidate): re-buscar não pode apagar o que já está visível e fazer a tela
  // piscar a cada tecla.
  const hasResults =
    data !== null &&
    (data.minhas.length > 0 ||
      data.catalogo.length > 0 ||
      data.comunidade.length > 0 ||
      (data.sugestoes !== undefined && data.sugestoes.length > 0))

  const isEmpty = status === 'done' && data !== null && !hasResults

  return (
    <Container as="main" className="flex flex-col gap-8 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        {m.titulo}
      </h1>

      <form
        role="search"
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void doSearch()
        }}
      >
        <label htmlFor="search-q" className="sr-only">
          {m.titulo}
        </label>
        <input
          id="search-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={m.placeholder}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-fg placeholder:text-muted"
        />
        <button type="submit" className={btnPrimary}>
          {m.buscar}
        </button>
      </form>

      <div className="flex flex-col gap-4">
        <FacetFieldset
          legend={m.filtroCozinha}
          options={cozinhaOptions}
          selected={cozinha}
          onToggle={toggle(setCozinha)}
        />
        <FacetFieldset
          legend={m.filtroCategoria}
          options={categoriaOptions}
          selected={categoria}
          onToggle={toggle(setCategoria)}
        />
        <FacetFieldset
          legend={m.filtroRestricao}
          options={restricaoOptions}
          selected={restricao}
          onToggle={toggle(setRestricao)}
        />

        {/* Ordenação da Comunidade (#62). Vive JUNTO do form (gateada por `hasCriteria`),
            NÃO dentro da seção Comunidade: `SearchSection` se omite quando volta vazia, o
            que faria o toggle DESAPARECER e prender o usuário em Popularidade. Aqui ele é
            SEMPRE alcançável quando há busca ativa. Aplica-se só à Comunidade (o backend
            ignora `sort` no Catálogo editorial); o rótulo deixa isso explícito. */}
        {hasCriteria && (
          <SortToggle
            value={sort}
            onChange={setSort}
            options={[
              { key: 'relevancia', label: messages.comunidade.toggleRelevancia },
              { key: 'popularidade', label: messages.comunidade.togglePopularidade },
            ]}
            groupLabel={messages.comunidade.ordenarPor}
            labelId="sort-toggle-label"
          />
        )}
      </div>

      {/* Consulta resolvida (#10) — eco READ-ONLY nesta fatia (Decisão 6). Mostra o que a
          lente Perfil culinário entendeu do termo difuso. Some naturalmente quando há
          faceta explícita (a API não ecoa `consulta` então). Gated por `status==='done'`:
          nunca mostra a resolução de uma busca ANTERIOR junto de um erro/loading. */}
      {status === 'done' && data?.consulta && (
        <ResolvedQueryEcho
          consulta={data.consulta}
          label={m.consultaLabel}
          cozinhaLabel={messages.cozinhaLabel}
          categoriaLabel={messages.categoriaLabel}
          restricaoLabel={messages.restricaoLabel}
        />
      )}

      {/* Região de estados/resultados. `aria-live="polite"` + `aria-busy` anunciam, a um
          leitor de tela que permaneceu no campo, o fim do loading e o resultado da busca
          (chegada de resultados, vazio ou erro) — sem recarregar a página. O texto VISÍVEL
          de cada estado é o próprio conteúdo anunciado (sem duplicar nó SR-only, que faria
          `findByText` casar dois elementos). */}
      <div aria-live="polite" aria-busy={status === 'loading'} className="flex flex-col gap-8">
        {status === 'error' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-fg">{messages.system.error}</p>
            <button type="button" className={btnSecondary} onClick={() => void doSearch()}>
              {messages.system.retry}
            </button>
          </div>
        )}

        {/* Inicial neutro: só quando nunca houve resultado (não some pra dar lugar ao loading). */}
        {status === 'idle' && data === null && (
          <p className="text-muted">{dicaInicial}</p>
        )}

        {/* Vazio: a busca concluiu sem resultado. */}
        {isEmpty && <p className="text-muted">{m.semResultado}</p>}

        {/* Resultados: stale-while-revalidate — montados sempre que a última busca trouxe
            itens, INCLUSIVE durante o loading de uma re-busca (não pisca). Loading isolado
            (linha de "Carregando…") só na PRIMEIRA busca (ainda sem `data`). No estado de
            erro NÃO mostramos resultados stale: o erro substitui a lista (como antes). */}
        {status === 'loading' && !hasResults && (
          <p className="text-muted">{messages.system.loading}</p>
        )}

        {status !== 'error' && hasResults && data !== null && (
          <div className="flex flex-col gap-8">
            {/* #116/own-label: "Minhas" PRIMEIRO (próprias do viewer). Vazia p/ anônimo (a guarda
                de seção vazia do SearchSection a omite) ⇒ busca de antes byte-a-byte na UI. */}
            <SearchSection
              headingId="search-section-minhas"
              heading={m.secaoMinhas}
              badgeLabels={badgeLabels}
              ownLabel={ownLabel}
              autoTranslationLabel={m.traducaoAutomatica}
              byLabel={m.porAutor}
              results={data.minhas}
            />
            <SearchSection
              headingId="search-section-catalogo"
              heading={m.secaoCatalogo}
              badgeLabels={badgeLabels}
              ownLabel={ownLabel}
              autoTranslationLabel={m.traducaoAutomatica}
              byLabel={m.porAutor}
              results={data.catalogo}
            />
            <SearchSection
              headingId="search-section-comunidade"
              heading={m.secaoComunidade}
              badgeLabels={badgeLabels}
              ownLabel={ownLabel}
              autoTranslationLabel={m.traducaoAutomatica}
              byLabel={m.porAutor}
              results={data.comunidade}
            />
            {data.sugestoes && data.sugestoes.length > 0 && (
              <SearchSection
                headingId="search-section-sugestoes"
                heading={m.talvezQueira}
                badgeLabels={badgeLabels}
                ownLabel={ownLabel}
                autoTranslationLabel={m.traducaoAutomatica}
                byLabel={m.porAutor}
                results={data.sugestoes}
              />
            )}
          </div>
        )}
      </div>
    </Container>
  )
}

/**
 * Eco read-only da Consulta resolvida (#10): junta os rótulos localizados das facetas que
 * a lente entendeu. Toque leve, informativo — NÃO realimenta os checkboxes nem permite
 * editar (edição bidirecional fica fora do escopo do #56 — Decisão 6).
 */
function ResolvedQueryEcho({
  consulta,
  label,
  cozinhaLabel,
  categoriaLabel,
  restricaoLabel,
}: {
  consulta: NonNullable<SearchResponse['consulta']>
  label: string
  cozinhaLabel: Record<string, string>
  categoriaLabel: Record<string, string>
  restricaoLabel: Record<string, string>
}) {
  const partes: string[] = [
    ...(consulta.cozinhas ?? []).map((v) => cozinhaLabel[v] ?? v),
    ...(consulta.categorias ?? []).map((v) => categoriaLabel[v] ?? v),
    ...(consulta.restricoes ?? []).map((v) => restricaoLabel[v] ?? v),
    ...(consulta.tags ?? []),
  ]
  if (partes.length === 0) return null
  return (
    <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
      <span className="font-medium text-fg">{label}</span> {partes.join(', ')}
    </p>
  )
}
