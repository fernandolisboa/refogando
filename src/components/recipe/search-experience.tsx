'use client'
/**
 * Home-Descoberta (#56/#236) — o cérebro client com TODO o estado de busca/feed e o fetch. É a HOME
 * (ADR-0020 "a Descoberta é a home"): provê o ÚNICO `<main>` do documento (via `<Container as="main">`).
 *
 * DUAS faces na MESMA superfície (refino INLINE, nunca tela separada — #236):
 *  - REPOUSO (sem critério): mostra o feed do POOL PÚBLICO já SEEDADO pelo SSR (`initialFeed`), navegável
 *    via `<DiscoveryFeed>` (paginação por cursor no `/api/feed`). É o estado INDEXÁVEL — o crawler já viu
 *    o feed no HTML; o cliente apenas o reflete e pagina.
 *  - REFINADO (com `q`/faceta/`sort`): a Busca assume a superfície e mostra os resultados. O estado é
 *    REFLETIDO na URL (`router.replace`) — recarregar com `?q=`/faceta cai no `noindex` do
 *    `generateMetadata` (#236). Limpar tudo volta a URL pro repouso `/{locale}` e o feed seeded reaparece.
 *
 * ADR-0010: a UI consome o ROUTE HANDLER `GET /api/search` via `fetch` — NÃO Server Actions. NÃO
 * reimplementa regra de domínio: renderiza o que a rota devolve (seções já vêm separadas e ordenadas;
 * `classifySection` do domínio decide o selo). Bilíngue (ADR-0014/0001): o locale resolvido entra na
 * query (`?locale=`) e troca de idioma re-busca no novo idioma.
 *
 * Estados tratados (impeccable): repouso (feed seeded, sem chamar a Busca — espelha o early-return do
 * handler), carregando, erro+retry, vazio, sugestões.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CATEGORIAS, RESTRICOES } from '@/domain/vocabulary'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import type { SearchResponse, SearchResult } from '@/domain/recipe-search-read'
import { FacetFieldset, type FacetOption } from './facet-fieldset'
import { SearchSection } from './search-section'
import { SortToggle } from './sort-toggle'
import { DiscoveryFeed } from './discovery-feed'
import { CooksToFollowRail } from './cooks-to-follow-rail'
import { CookSearchCluster } from './cook-search-cluster'
import type { ProfileFollowUser } from '@/domain/recipe-profile-read'
import type { BadgeLabels } from './recipe-result-item'
import { ImportRecipeDialog, type ImportDialogLabels, type WebLink } from './import-recipe-dialog'

type Sort = 'relevancia' | 'popularidade'

type Status = 'idle' | 'loading' | 'done' | 'error'

const DEBOUNCE_MS = 300

/**
 * #164 (ADR-0019): a ponte de descoberta na web SÓ dispara quando o nosso acervo veio RASO — a soma
 * de minhas+catalogo+comunidade ABAIXO deste limiar. Com acervo suficiente, NÃO chamamos a web (não
 * taxa o caminho quente). Conforme o acervo cresce, a ponte some sozinha.
 */
const SHALLOW_THRESHOLD = 3

// Um link da web (#164) — resultado externo da descoberta, NUNCA armazenado nem ranqueado. O tipo é
// OWNED por `import-recipe-dialog` (que o consome como gatilho de import, #169) e re-usado aqui.

export function SearchExperience({
  home = false,
  initialFeed = [],
  initialNextCursor = null,
}: {
  /**
   * #236: montada como a HOME-Descoberta? `true` ⇒ o REPOUSO (sem critério) mostra o feed SEEDADO
   * (`<DiscoveryFeed>`), INCLUSIVE quando vazio (estado neutro do feed). `false`/ausente (a Busca
   * legada montada fora da home) ⇒ o repouso mostra a dica inicial de antes — sem regressão.
   */
  home?: boolean
  /**
   * #236: 1ª página do feed do POOL PÚBLICO já SEEDADA pelo SSR (anônimo/indexável). Mostrada no
   * REPOUSO quando `home`. Default `[]`.
   */
  initialFeed?: SearchResult[]
  /** #236: cursor da 2ª página do feed seeded (null = a 1ª já é o fim). */
  initialNextCursor?: string | null
} = {}) {
  const { locale, messages } = useLocale()
  const m = messages.busca
  const router = useRouter()

  // #116: estado de sessão SÓ para a CÓPIA (a dica inicial). O `viewerId` real e o gate vivem
  // no servidor (GET /api/search o resolve do cookie) — a UI nunca passa id nenhum. fail-open
  // (error / isPending) → trata como anônimo (dica de comunidade), sem travar a tela.
  // #166: a mesma sessão decide o ramo do CTA "Gerar com IA": logado → link pro /create; visitante
  // → convite de entrar (espelha o gate do RecipeDetailActions: pending/error/null = anônimo).
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const dicaInicial = authed ? m.dicaInicialLogado : m.dicaInicial

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

  // #164: links da WEB (ADR-0019) — seção SEPARADA, fora do ranking interno. Carregam DEPOIS de
  // /api/search (não bloqueiam os resultados locais) e SÓ quando o acervo local veio raso.
  const [webLinks, setWebLinks] = useState<WebLink[]>([])

  // #275: estado do 2º gatilho EXPLÍCITO "buscar na web" ao fim dos resultados (coexiste com o
  // automático #164). `idle` ⇒ CTA disponível; `loading` ⇒ fetch em voo (botão disabled + "buscando…");
  // `done` ⇒ a busca manual concluiu. Quando `done` E `webLinks` segue vazio, mostramos o aviso neutro
  // (degradação graciosa, sem provedor/allowlist). Reseta a `idle` a cada nova busca (ver `doSearch`).
  const [webManualState, setWebManualState] = useState<'idle' | 'loading' | 'done'>('idle')

  // #279: cluster de COZINHEIROS (ADR-0024) — busca PARALELA por nome/@handle, FORA do ranking de
  // receitas. Flutua acima das receitas quando casa alguém. Fetch independente de /api/search/cooks.
  const [cooks, setCooks] = useState<ProfileFollowUser[]>([])

  // AbortController da requisição em voo: cancelar a anterior quando os critérios mudam
  // (debounce) ou no unmount. Uma req cancelada NÃO vira estado de erro (AbortError é
  // ignorado).
  const abortRef = useRef<AbortController | null>(null)
  // AbortController SEPARADO da descoberta na web (#164): cancelar a anterior a cada nova busca
  // (a web é um fetch independente, disparado depois do /api/search).
  const webAbortRef = useRef<AbortController | null>(null)
  // AbortController SEPARADO da busca de Cozinheiros (#279): cancela a anterior a cada nova busca
  // (paralelo independente do /api/search — um responde sem o outro).
  const cooksAbortRef = useRef<AbortController | null>(null)
  // #275: token de reentrância da busca MANUAL na web. Incrementa a cada clique no CTA; o handler
  // captura o valor local e só transiciona para `done` se ainda for a corrida CORRENTE. Protege a
  // corrida em que uma NOVA busca (nova digitação) ABORTA o fetch manual em voo: `discoverWeb` engole
  // o AbortError, então sem este guarda (mais o boolean de conclusão) o `done` obsoleto pintaria o
  // aviso "nada na web" indevidamente.
  const webManualTokenRef = useRef(0)

  const hasCriteria =
    q.trim() !== '' ||
    cozinha.length > 0 ||
    categoria.length > 0 ||
    restricao.length > 0

  /**
   * #164 (ADR-0019): descoberta na web — só chamada pelo `doSearch` QUANDO o acervo local veio raso.
   * Fetch INDEPENDENTE de `/api/discovery/web` (não bloqueia os resultados locais; estes já estão na
   * tela). Os links são EXTERNOS, numa seção SEPARADA, FORA do ranking interno. Qualquer falha (rede,
   * desligado) ⇒ `[]` silencioso — a descoberta na web é assistiva, nunca derruba a Busca. Só o termo
   * `q` alimenta a web (facetas não se aplicam a links externos).
   */
  const discoverWeb = useCallback(
    // #275: RETORNA um boolean — `true` só quando a busca COMPLETOU de verdade (res.ok + parse). `false`
    // quando foi ABORTADA (corrida superada por nova busca) ou `!res.ok`. O handler manual usa isso para
    // NÃO transicionar para `done` numa corrida abortada (que pintaria o aviso "nada na web" obsoleto).
    async (term: string): Promise<boolean> => {
      webAbortRef.current?.abort()
      const controller = new AbortController()
      webAbortRef.current = controller
      const url = new URL('/api/discovery/web', window.location.origin)
      url.searchParams.set('q', term)
      url.searchParams.set('locale', locale)
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) return false
        const body = (await res.json()) as { results: WebLink[] }
        setWebLinks(body.results ?? [])
        return true
      } catch {
        // AbortError ou rede caída: descoberta na web é assistiva — silencia (mantém só o local).
        return false
      }
    },
    [locale],
  )

  /**
   * #275 (ADR-0019): 2º gatilho da descoberta na web — acionado por CLIQUE EXPLÍCITO no CTA "buscar na
   * web" ao fim dos resultados (preserva "Busca nunca cria" / fetch-só-por-ação). Reusa a MESMA
   * `discoverWeb` (allowlist-restrita, degrade-200) — NUNCA dá erro vermelho: o pior caso é o aviso
   * neutro quando volta vazio. Guarda de reentrância (`loading`) evita duplo-clique. `done` distingue
   * "rodou manualmente" de "nunca rodou" (que `webLinks.length` sozinho não diferencia).
   */
  const handleWebManual = useCallback(async () => {
    const term = q.trim()
    if (term === '' || webManualState === 'loading') return
    // Captura o token DESTA corrida. Só transiciona para `done` se, ao resolver, (a) este ainda for o
    // último clique (token bate) E (b) a `discoverWeb` COMPLETOU (não foi abortada por uma nova busca).
    // Corrida superada ⇒ `discoverWeb` devolve `false` e o reset de `doSearch` já devolveu o CTA a
    // `idle`; sem este guarda, o `done` obsoleto pintaria o aviso "nada na web". NÃO há estado de erro
    // vermelho — a degradação graciosa (aviso neutro só quando completou vazio) permanece.
    const token = (webManualTokenRef.current += 1)
    setWebManualState('loading')
    const completed = await discoverWeb(term)
    if (completed && webManualTokenRef.current === token) {
      setWebManualState('done')
    }
  }, [q, webManualState, discoverWeb])

  /**
   * #279 (ADR-0024): busca de COZINHEIROS — fetch PARALELO de `/api/search/cooks` por nome/@handle.
   * Espelha `discoverWeb` (AbortController próprio, falha silenciosa, assistivo). É LOCALE-INDEPENDENTE
   * (nome/@handle/avatar não traduzem) ⇒ sem `?locale=`. Disparado JUNTO da busca (não-bloqueante), SÓ
   * com termo >= 2 chars; a rota faz o gate fino (barra id/email, termo classificado < 2).
   */
  const discoverCooks = useCallback(async (term: string) => {
    cooksAbortRef.current?.abort()
    const controller = new AbortController()
    cooksAbortRef.current = controller
    const url = new URL('/api/search/cooks', window.location.origin)
    url.searchParams.set('q', term)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        // HTTP não-ok (rota degrada a 200, então isto é raro): limpa o cluster STALE da busca anterior.
        setCooks([])
        return
      }
      const body = (await res.json()) as { cooks: ProfileFollowUser[] }
      setCooks(body.cooks ?? [])
    } catch {
      // AbortError (busca superada) ou rede caída: o cluster é assistivo — silencia (não limpa: o
      // abort vem de uma nova busca que já vai semear; rede caída mantém o último resultado).
    }
  }, [])

  const doSearch = useCallback(async () => {
    // Estado inicial neutro: sem critério, NÃO chama a API (espelha o early-return do
    // handler — evita req supérflua e tela branca).
    if (!hasCriteria) {
      abortRef.current?.abort()
      webAbortRef.current?.abort()
      cooksAbortRef.current?.abort()
      setData(null)
      setWebLinks([])
      setCooks([])
      setStatus('idle')
      return
    }

    // #279: cluster de Cozinheiros em PARALELO (antes do await do /api/search — não-bloqueante). Só com
    // termo >= 3 chars (alinha com o trigrama do índice + corta ruído de 1–2 chars; a rota faz o gate
    // fino no termo CLASSIFICADO). Facet-only ou termo curto ⇒ aborta e limpa o cluster (some ao trocar
    // pra busca-por-faceta). Independente do resultado das receitas.
    const cookTerm = q.trim()
    if (cookTerm.length >= 3) {
      void discoverCooks(cookTerm)
    } else {
      cooksAbortRef.current?.abort()
      setCooks([])
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

      // #275: toda nova busca BEM-SUCEDIDA volta o CTA manual a `idle` (reaparece ao mudar q/faceta/sort).
      // SÓ aqui (não no early-return de repouso nem no catch de erro) — senão o CTA piscaria fora do
      // estado `done`. O effect debounced re-roda `doSearch` a cada mudança, então o reset é automático.
      setWebManualState('idle')

      // #164: GATING da descoberta na web. Os resultados LOCAIS já estão na tela (acima). Só
      // depois, e SÓ se o acervo local veio RASO (abaixo do limiar) E há um termo de texto,
      // disparamos a web (fetch independente, não-bloqueante). Acervo suficiente ⇒ NÃO chama (e
      // limpa qualquer link da web de uma busca anterior). Facetas-só (sem `q`) NÃO acionam a web.
      const localCount = body.minhas.length + body.catalogo.length + body.comunidade.length
      const term = q.trim()
      if (term !== '' && localCount < SHALLOW_THRESHOLD) {
        void discoverWeb(term)
      } else {
        webAbortRef.current?.abort()
        setWebLinks([])
      }
    } catch (err) {
      // Req cancelada (critérios mudaram / unmount) não é erro de verdade.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setStatus('error')
    }
  }, [hasCriteria, q, locale, cozinha, categoria, restricao, sort, discoverWeb, discoverCooks])

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

  /**
   * #236: REFLETE o estado de busca/filtro na URL (refino INLINE na MESMA superfície). REFINADO ⇒
   * `?q=…`/facetas (`router.replace`, sem empilhar histórico a cada tecla) → recarregar cai no
   * `noindex` do `generateMetadata`. REPOUSO (sem critério) ⇒ a URL volta ao caminho NU `/{locale}`
   * (sem query) — o estado indexável. `sort` só vai à URL quando difere do default (espelha a query).
   * O `pathname` corrente é a base: NÃO recompõe o prefixo de locale (o proxy/path já o garante).
   * Guarda no SSR/jsdom-sem-window: sem `window`, não reflete (nada a sincronizar).
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (q.trim() !== '') params.set('q', q.trim())
    if (cozinha.length > 0) params.set('cozinha', cozinha.join(','))
    if (categoria.length > 0) params.set('categoria', categoria.join(','))
    if (restricao.length > 0) params.set('restricao', restricao.join(','))
    if (sort === 'popularidade') params.set('sort', 'popularidade')
    const query = params.toString()
    const target = query === '' ? window.location.pathname : `${window.location.pathname}?${query}`
    // Só reescreve se MUDOU (evita um replace redundante por render que poderia laçar com o router).
    const current = `${window.location.pathname}${window.location.search}`
    if (target !== current) router.replace(target)
  }, [q, cozinha, categoria, restricao, sort, router])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      webAbortRef.current?.abort()
      cooksAbortRef.current?.abort()
    }
  }, [])

  const toggle = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
      setter((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      ),
    [],
  )

  // #317: as opções de cozinha vêm do leitor data-driven via contexto (semeado no layout),
  // não mais do enum estático `COZINHAS` × `messages.cozinhaLabel`. Já chegam localizadas.
  const cozinhaVocab = useCozinhaVocab()
  const cozinhaOptions: FacetOption[] = cozinhaVocab.map(({ value, label }) => ({ value, label }))
  // Mapa slug→rótulo p/ o eco da Consulta resolvida (mantém o `?? v` lá: um slug selecionado
  // na URL mas fora do escopo ativo cai no próprio slug).
  const cozinhaLabelMap: Record<string, string> = Object.fromEntries(
    cozinhaVocab.map((o) => [o.value, o.label]),
  )
  const categoriaOptions: FacetOption[] = CATEGORIAS.map((value) => ({
    value,
    label: messages.categoriaLabel[value],
  }))
  const restricaoOptions: FacetOption[] = RESTRICOES.map((value) => ({
    value,
    label: messages.restricaoLabel[value],
  }))

  // #160: contagem de facetas ATIVAS (soma das três facetas multi-seleção). Rótulo do gatilho
  // "+ filtros" → "+ filtros (n)" quando há seleção. Sort NÃO entra (é ordenação, não filtro).
  const activeFacetCount = cozinha.length + categoria.length + restricao.length
  const filtrosLabel =
    activeFacetCount > 0
      ? m.filtrosContagem.replace('{count}', String(activeFacetCount))
      : m.filtros

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

  // #275: contagem do acervo LOCAL (mesmas 3 seções do gate automático #164, sem `sugestoes`). O CTA
  // manual cobre o caso COMPLEMENTAR do auto-gate (acervo SUFICIENTE: `localCount >= SHALLOW_THRESHOLD`)
  // — "rolei até o fim e nada serviu". No caminho raso (`< limiar`) o auto já disparou, então o CTA não
  // aparece (sem flash nem redundância). Espelha byte-a-byte o `localCount` de `doSearch`.
  const localCount = data ? data.minhas.length + data.catalogo.length + data.comunidade.length : 0

  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-fg">
        {m.titulo}
      </h1>

      {/* Busca EDITORIAL (protótipo RefoStage): input serifado sem moldura, com ícone de lupa
          e uma borda inferior grossa. Busca ao vivo (debounce no efeito); Enter também dispara. */}
      <form
        role="search"
        className="flex items-center gap-2.5 border-b-2 border-fg pb-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          void doSearch()
        }}
      >
        <Search className="size-[18px] shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
        <label htmlFor="search-q" className="sr-only">
          {m.titulo}
        </label>
        <input
          id="search-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={m.placeholder}
          className="w-full border-none bg-transparent font-display text-lg text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
        />
      </form>

      {/* #166: CTA PERMANENTE "Gerar com IA" — sempre visível (com e SEM resultados), porque
          gerar é o mote do app. NÃO auto-dispara (a Busca nunca cria): logado → link pro fluxo
          de criação `/create` PRÉ-PREENCHENDO o termo buscado; visitante → convite de entrar
          (gerar exige conta). Vive logo abaixo do campo, antes dos resultados, pra estar sempre
          ao alcance. `aria-hidden` no ícone (decorativo); o rótulo é o nome acessível do link. */}
      <GerarComIaCta
        q={q}
        authed={authed}
        sessionPending={session.isPending}
        gerarLabel={m.gerarComIa}
        conviteTitulo={messages.minhasCriacoes.convidaEntrarTitulo}
        conviteTexto={messages.minhasCriacoes.convidaEntrarTexto}
        signInLabel={messages.nav.signIn}
      />

      {/* #278 (ADR-0024): trilho "Cozinheiros pra seguir" — SÓ na home (`home`) e SÓ em REPOUSO
          (`!hasCriteria`): é a companhia de descoberta do feed de repouso; ao buscar, a superfície é
          tomada pelos resultados e o trilho some. É uma ILHA SÓ-LOGADA que renderiza `null` no SSR/anon
          (Modelo B — a home indexável segue byte-idêntica) e FORA da live region abaixo (não é status
          efêmero). Variante anônima/global = follow-up deferido. */}
      {home && !hasCriteria && <CooksToFollowRail />}

      <div className="flex flex-col gap-4">
        {/* #160: filtros RECOLHIDOS por padrão atrás de um disclosure NATIVO (mesmo padrão
            `<details>/<summary>` do RecipeImageManager — sem lib). Recolher/expandir é só um
            toggle de visibilidade do <details>: o estado das facetas vive no useState do pai,
            então não se perde a seleção nem re-dispara a busca. O <summary> mostra "+ filtros"
            com a contagem de facetas ativas. As 3 facetas vivem DENTRO do disclosure. */}
        <details className="flex flex-col gap-4">
          <summary className="cursor-pointer select-none text-sm font-medium text-muted hover:text-fg">
            {filtrosLabel}
          </summary>
          <div className="mt-4 flex flex-col gap-4">
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
          </div>
        </details>

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
          cozinhaLabel={cozinhaLabelMap}
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
        {/* #279: cluster de Cozinheiros — flutua no TOPO dos resultados (acima de qualquer estado de
            receita) quando alguém casa o termo. Gated `status !== 'error'` (espelha a seção "Da web").
            `key` = assinatura dos cooks ⇒ remonta ao trocar de busca, RESETANDO o "Ver todos" expandido
            (sem setState em effect). Renderiza `null` quando não casa ninguém. */}
        {status !== 'error' && (
          <CookSearchCluster key={cooks.map((c) => c.handle).join(',')} cooks={cooks} />
        )}

        {status === 'error' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-fg">{messages.system.error}</p>
            <Button variant="secondary" type="button" onClick={() => void doSearch()}>
              {messages.system.retry}
            </Button>
          </div>
        )}

        {/* #236 REPOUSO: sem critério de busca, a superfície mostra o FEED da Descoberta já SEEDADO
            pelo SSR (pool público, indexável) em vez da dica neutra. O `DiscoveryFeed` reflete a 1ª
            página do crawler e pagina via /api/feed. Sem feed seeded (Busca legada montada fora da
            home), cai na dica inicial de antes (não regride). A Busca, ao digitar/filtrar, troca este
            bloco pelos resultados (refino inline). */}
        {status === 'idle' && data === null && (
          home ? (
            <DiscoveryFeed initialItems={initialFeed} initialNextCursor={initialNextCursor} />
          ) : (
            <p className="text-muted">{dicaInicial}</p>
          )
        )}

        {/* Vazio: a busca concluiu sem RECEITA. #279: só mostra "nenhum resultado" se TAMBÉM não há
            Cozinheiro casando — senão o cluster acima carrega o resultado (cook casa, receita vazia). */}
        {isEmpty && cooks.length === 0 && <p className="text-muted">{m.semResultado}</p>}

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
              byLabel={m.porAutor} aiLabel={m.imagemSeloIa}
              locale={locale}
              results={data.minhas}
            />
            <SearchSection
              headingId="search-section-catalogo"
              heading={m.secaoCatalogo}
              badgeLabels={badgeLabels}
              ownLabel={ownLabel}
              autoTranslationLabel={m.traducaoAutomatica}
              byLabel={m.porAutor} aiLabel={m.imagemSeloIa}
              locale={locale}
              results={data.catalogo}
            />
            <SearchSection
              headingId="search-section-comunidade"
              heading={m.secaoComunidade}
              badgeLabels={badgeLabels}
              ownLabel={ownLabel}
              autoTranslationLabel={m.traducaoAutomatica}
              byLabel={m.porAutor} aiLabel={m.imagemSeloIa}
              locale={locale}
              results={data.comunidade}
            />
            {data.sugestoes && data.sugestoes.length > 0 && (
              <SearchSection
                headingId="search-section-sugestoes"
                heading={m.talvezQueira}
                badgeLabels={badgeLabels}
                ownLabel={ownLabel}
                autoTranslationLabel={m.traducaoAutomatica}
                byLabel={m.porAutor} aiLabel={m.imagemSeloIa}
                locale={locale}
                results={data.sugestoes}
              />
            )}
          </div>
        )}

        {/* #164: seção SEPARADA "Da web" (ADR-0019). Renderiza FORA do bloco de resultados locais (que
            só monta com `hasResults`), porque o caso mais comum é acervo VAZIO + links da web — esses
            links têm de aparecer mesmo sem nenhum resultado local. São LINKS externos (target/rel
            external), marcados "da web", NÃO misturados ao ranking interno. Carregam DEPOIS do
            /api/search (não bloqueiam) e só quando o acervo veio raso. Some quando `webLinks` esvazia. */}
        {status !== 'error' && webLinks.length > 0 && (
          <WebDiscoverySection
            links={webLinks}
            heading={m.secaoDaWeb}
            descricao={m.daWebDescricao}
            authed={authed}
            sessionPending={session.isPending}
            importLabels={{
              titulo: m.importarTitulo,
              texto: m.importarTexto,
              confirmar: m.importarConfirmar,
              verNoSite: m.importarVerNoSite,
              cancelar: m.importarCancelar,
              importando: m.importarImportando,
              erroNaoImportavel: m.importarErroNaoImportavel,
              erroRobotsBloqueado: m.importarErroRobotsBloqueado,
              erroLimite: m.importarErroLimite,
              erroGenerico: m.importarErroGenerico,
              conviteTitulo: m.importarConviteTitulo,
              conviteTexto: m.importarConviteTexto,
              signInLabel: messages.nav.signIn,
              daWebFonte: m.daWebFonte,
            }}
            // Sucesso (201): leva o usuário direto à receita importada (detalhe canônico). De lá,
            // "Minhas criações" a lista marcada como importada (#169). #231 (ADR-0020): a importada
            // nasce privada e o import não devolve slug — navega pro fallback canônico por UUID
            // `/{locale}/recipes/<uuid>` (que 308a pro slug). Nunca link nu sem locale.
            onImported={(recipeId) => router.push(recipeDetailPath(locale, recipeId))}
          />
        )}

        {/* #275: 2º gatilho EXPLÍCITO "buscar na web" ao FIM dos resultados (dentro da live region). SÓ
            quando: busca concluída, há termo, o acervo veio SUFICIENTE (o auto-gate #164 já cobre o raso)
            e a seção "Da web" ainda não foi preenchida (`webLinks` vazio). Particiona o espaço do auto:
            raso ⇒ auto disparou (sem CTA); suficiente ⇒ CTA disponível — nunca os dois (sem flash). Some
            quando o clique popula `webLinks` (a WebDiscoverySection acima assume). */}
        {status === 'done' &&
          q.trim() !== '' &&
          localCount >= SHALLOW_THRESHOLD &&
          webLinks.length === 0 && (
            <WebManualCta
              state={webManualState}
              onSearch={handleWebManual}
              ctaLabel={m.webManualCta}
              buscandoLabel={m.webManualBuscando}
              nadaLabel={m.webManualNada}
            />
          )}
      </div>
    </Container>
  )
}

/**
 * #164/#169 (ADR-0019): seção "Da web" — resultados EXTERNOS de descoberta quando o acervo é raso.
 * Cada item é o GATILHO de um `ImportRecipeDialog` (#169): clicar abre a confirmação de IMPORTAR a
 * receita pro perfil privado (com saída "Ver no site" e, p/ visitante, convite de entrar). NÃO é uma
 * Receita do nosso acervo: NUNCA usa o `RecipeResultItem` (que linka `/recipes/<id>` interno) — é
 * deliberadamente uma lista de cartões marcados "da web · <fonte>", fora do ranking interno. Heading
 * nível 2 (como as outras seções de resultado). O dialog tem o link externo dentro (exibir ≠ importar).
 */
function WebDiscoverySection({
  links,
  heading,
  descricao,
  authed,
  sessionPending,
  importLabels,
  onImported,
}: {
  links: WebLink[]
  heading: string
  descricao: string
  authed: boolean
  sessionPending: boolean
  importLabels: ImportDialogLabels
  onImported: (recipeId: string) => void
}) {
  return (
    <section aria-labelledby="search-section-da-web" className="flex flex-col gap-3">
      <h2
        id="search-section-da-web"
        className="font-display text-lg font-semibold text-fg"
      >
        {heading}
      </h2>
      <p className="max-w-[60ch] text-sm text-muted">{descricao}</p>
      <ul className="flex flex-col gap-3">
        {links.map((link) => (
          <li key={link.url}>
            <ImportRecipeDialog
              link={link}
              authed={authed}
              sessionPending={sessionPending}
              labels={importLabels}
              onImported={onImported}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * #275 (ADR-0019): CTA EXPLÍCITO "buscar na web" ao FIM dos resultados — o 2º gatilho da descoberta na
 * web, para o caso "rolei até o fim e nada serviu" (acervo suficiente, o auto-gate #164 não disparou).
 * Dispara `discoverWeb` SÓ por clique do usuário (a Busca nunca cria). Três faces:
 *  - `idle`: o botão (variant secondary, espelha o retry);
 *  - `loading`: o MESMO botão disabled + `aria-busy` + rótulo "buscando…" (feedback + guard de duplo-clique);
 *  - `done` com a web vazia: um aviso NEUTRO ("nada na web agora") — degradação graciosa sem provedor/
 *    allowlist, NUNCA estado de erro vermelho. (Quando a web popula links, o pai esconde este bloco e a
 *    `WebDiscoverySection` assume — então `done` aqui ⇒ necessariamente voltou vazio.)
 */
function WebManualCta({
  state,
  onSearch,
  ctaLabel,
  buscandoLabel,
  nadaLabel,
}: {
  state: 'idle' | 'loading' | 'done'
  onSearch: () => void
  ctaLabel: string
  buscandoLabel: string
  nadaLabel: string
}) {
  if (state === 'done') {
    return <p className="text-sm text-muted">{nadaLabel}</p>
  }
  const loading = state === 'loading'
  return (
    <div>
      <Button
        variant="secondary"
        type="button"
        onClick={onSearch}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? buscandoLabel : ctaLabel}
      </Button>
    </div>
  )
}

/**
 * CTA permanente "Gerar com IA" (#166) — o mote do app, sempre visível na Busca (com e SEM
 * resultados). NÃO auto-dispara: a Busca nunca cria. Dois ramos, espelhando o gate do
 * `RecipeDetailActions` (a UI só escolhe a CÓPIA; o gate de escrita real é server-side):
 *
 *  - LOGADO → link pro fluxo de criação `/create?q=<termo>`, PRÉ-PREENCHENDO o texto livre com o
 *    termo buscado. A rota `/create` monta `CreateShellClient → CreateDrawer`, que lê o `?q` da URL
 *    e o repassa como `initialFreeText` ao Prompt aberto (ponte #166; a Busca nunca gera). Sem
 *    termo, leva ao `/create` cru (gerar do zero).
 *  - VISITANTE → convite de entrar (gerar exige conta), reusando `minhasCriacoes.convidaEntrar*`
 *    + `nav.signIn`, o mesmo padrão de convite do detalhe da Receita.
 *
 * Enquanto a sessão resolve (`sessionPending`), mostra o ramo logado (otimista): o pior caso é
 * um clique que cai no gate de escrita do servidor — nunca um flash do convite pra quem está
 * logado. O ícone Sparkles é decorativo (`aria-hidden`); o rótulo nomeia o link/seção.
 */
function GerarComIaCta({
  q,
  authed,
  sessionPending,
  gerarLabel,
  conviteTitulo,
  conviteTexto,
  signInLabel,
}: {
  q: string
  authed: boolean
  sessionPending: boolean
  gerarLabel: string
  conviteTitulo: string
  conviteTexto: string
  signInLabel: string
}) {
  // Visitante (sessão resolvida e SEM usuário): convite de entrar. Otimista durante o pending.
  if (!authed && !sessionPending) {
    return (
      <section
        aria-labelledby="gerar-ia-convite-titulo"
        className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
      >
        {/* O rótulo do convite é um <p> (não um <h2>) DE PROPÓSITO: a Busca reserva os headings
            nível 2 às seções de RESULTADO (Catálogo/Comunidade/Minhas). `aria-labelledby` não
            exige um heading no alvo — então o convite continua nomeado pro leitor de tela sem
            poluir o outline do documento. */}
        <p
          id="gerar-ia-convite-titulo"
          className="flex items-center gap-2 font-display text-lg font-semibold text-fg"
        >
          <Sparkles className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          {gerarLabel}
        </p>
        <p className="max-w-[60ch] text-sm text-muted">{conviteTexto}</p>
        <div>
          <Button asChild>
            <Link href="/sign-in">{signInLabel}</Link>
          </Button>
        </div>
        {/* `conviteTitulo` ("Entre para fazer isso") dá o contexto extra pro leitor de tela — o
            rótulo VISÍVEL é o próprio "Gerar com IA". */}
        <span className="sr-only">{conviteTitulo}</span>
      </section>
    )
  }

  // Logado (ou sessão ainda resolvendo): link pro /create com o termo pré-preenchido. Só anexa
  // `?q` quando há termo (sem `?q=` vazio espúrio na URL).
  const href = q.trim() !== '' ? `/create?q=${encodeURIComponent(q.trim())}` : '/create'
  return (
    <div>
      <Button asChild>
        <Link href={href}>
          <Sparkles className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          {gerarLabel}
        </Link>
      </Button>
    </div>
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
