'use client'
/**
 * Tela de browse /recipes (#98) — catálogo + comunidade SEM precisar buscar. É o gêmeo
 * "discovery-first" da Busca (#56): mesmo motor de seções/facetas/ordenação, mas SEM campo
 * de texto e SEM estado inicial neutro — ao montar JÁ lista o pool (`?browse=1`). Provê o
 * ÚNICO `<main>` do documento (via `<Container as="main">`), espelhando a home.
 *
 * ADR-0010: consome o ROUTE HANDLER `GET /api/search?browse=1` via `fetch` — NÃO Server
 * Actions, NÃO reimplementa regra de domínio (renderiza o que a rota seccionou/ordenou).
 * Bilíngue (ADR-0014/0001): o locale resolvido entra na query e troca de idioma re-busca.
 *
 * Distinção vs. `SearchExperience`: lá há `q` + `hasCriteria` (sem critério → NÃO chama a
 * API, estado neutro). Aqui NÃO há `q`: o critério é implícito (`browse=1`), então SEMPRE
 * busca — não há `idle`/`dicaInicial`. Default de ordenação = Popularidade (o pool abre
 * pelos mais votados na Comunidade; o Catálogo é editorial e ignora `sort`, ADR-0003).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { btnSecondary, btnSecondarySm } from '@/components/button'
import { COZINHAS, CATEGORIAS, RESTRICOES } from '@/domain/vocabulary'
import type { SearchResponse } from '@/domain/recipe-search-read'
import { FacetFieldset, type FacetOption } from './facet-fieldset'
import { SearchSection } from './search-section'
import { SortToggle } from './sort-toggle'
import type { BadgeLabels } from './recipe-result-item'

type Sort = 'relevancia' | 'popularidade'

type Status = 'loading' | 'done' | 'error'

const DEBOUNCE_MS = 300

export function RecipeBrowseExperience() {
  const { locale, messages } = useLocale()
  const m = messages.busca
  const mb = messages.browse

  const [cozinha, setCozinha] = useState<string[]>([])
  const [categoria, setCategoria] = useState<string[]>([])
  const [restricao, setRestricao] = useState<string[]>([])
  // Default Popularidade (#98): o browse abre pelos mais votados da Comunidade. Só vai à URL
  // quando é 'popularidade' (espelha o estilo de `SearchExperience`); voltar a 'relevancia'
  // remove o param e o backend usa o ranking default. O Catálogo ignora `sort` (ADR-0003).
  const [sort, setSort] = useState<Sort>('popularidade')
  const [data, setData] = useState<SearchResponse | null>(null)
  // Browse SEMPRE busca (critério implícito `browse=1`): inicia em 'loading', sem estado
  // neutro. A primeira busca dispara no effect debounced ao montar.
  const [status, setStatus] = useState<Status>('loading')

  // AbortController da requisição em voo: cancela a anterior quando os critérios mudam
  // (debounce) ou no unmount. Req cancelada NÃO vira erro (AbortError é ignorado).
  const abortRef = useRef<AbortController | null>(null)

  const doBrowse = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const url = new URL('/api/search', window.location.origin)
    url.searchParams.set('browse', '1')
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
  }, [locale, cozinha, categoria, restricao, sort])

  // Debounce: (re)busca ao montar e quando facetas / ordenação / locale mudam. Locale muda →
  // re-busca no novo idioma (AC bilíngue). Cleanup limpa o timeout E aborta a req em voo.
  useEffect(() => {
    const t = setTimeout(() => {
      void doBrowse()
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
    }
  }, [doBrowse])

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

  // Há resultados SE a última busca concluída trouxe ao menos um item. Usa `data` (não
  // `status`) para manter resultados na tela durante refetch (stale-while-revalidate): mudar
  // uma faceta não pode apagar a lista visível e piscar.
  const hasResults =
    data !== null && (data.catalogo.length > 0 || data.comunidade.length > 0)

  const isEmpty = status === 'done' && data !== null && !hasResults

  return (
    <Container as="main" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {mb.titulo}
        </h1>
        <p className="text-muted">{mb.subtitulo}</p>
      </div>

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

        {/* Ordenação da Comunidade (#62/#98): SEMPRE presente (o browse sempre tem critério),
            ao contrário da Busca onde é gateada por `hasCriteria`. Aplica-se só à Comunidade
            (o backend ignora `sort` no Catálogo editorial); o rótulo deixa isso explícito. */}
        <SortToggle
          value={sort}
          onChange={setSort}
          options={[
            { key: 'relevancia', label: messages.comunidade.toggleRelevancia },
            { key: 'popularidade', label: messages.comunidade.togglePopularidade },
          ]}
          groupLabel={messages.comunidade.ordenarPor}
          labelId="browse-sort-toggle-label"
        />

        {/* Limpar filtros: sem campo de texto, desmarcar faceta a faceta seria o único jeito
            de voltar ao pool cheio — este botão dá a ação de um clique que o estado vazio
            promete ("ajuste ou limpe os filtros"). Só aparece quando há alguma faceta ativa. */}
        {(cozinha.length > 0 || categoria.length > 0 || restricao.length > 0) && (
          <button
            type="button"
            className={`${btnSecondarySm} self-start`}
            onClick={() => {
              setCozinha([])
              setCategoria([])
              setRestricao([])
            }}
          >
            {mb.limparFiltros}
          </button>
        )}
      </div>

      {/* Região de estados/resultados. `aria-live="polite"` + `aria-busy` anunciam o fim do
          loading e o resultado (chegada de itens, vazio ou erro) a um leitor de tela. O texto
          VISÍVEL de cada estado é o próprio conteúdo anunciado (sem nó SR-only duplicado). */}
      <div aria-live="polite" aria-busy={status === 'loading'} className="flex flex-col gap-8">
        {status === 'error' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-fg">{messages.system.error}</p>
            <button type="button" className={btnSecondary} onClick={() => void doBrowse()}>
              {messages.system.retry}
            </button>
          </div>
        )}

        {/* Vazio: a busca concluiu sem resultado (pool vazio ou facetas excluíram tudo). */}
        {isEmpty && <p className="text-muted">{mb.semResultado}</p>}

        {/* Loading isolado (linha de "Carregando…") só na PRIMEIRA busca (ainda sem `data`).
            Em refetch, stale-while-revalidate mantém a lista (não pisca). No erro NÃO mostra
            resultados stale: o erro substitui a lista. */}
        {status === 'loading' && !hasResults && (
          <p className="text-muted">{messages.system.loading}</p>
        )}

        {status !== 'error' && hasResults && data !== null && (
          <div className="flex flex-col gap-8">
            <SearchSection
              headingId="browse-section-catalogo"
              heading={m.secaoCatalogo}
              badgeLabels={badgeLabels}
              autoTranslationLabel={m.traducaoAutomatica}
              results={data.catalogo}
            />
            <SearchSection
              headingId="browse-section-comunidade"
              heading={m.secaoComunidade}
              badgeLabels={badgeLabels}
              autoTranslationLabel={m.traducaoAutomatica}
              results={data.comunidade}
            />
          </div>
        )}
      </div>
    </Container>
  )
}
