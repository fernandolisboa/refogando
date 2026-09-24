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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CATEGORIAS, RESTRICOES } from '@/domain/vocabulary'
import { searchTermGenerability } from '@/domain/generate-from-search'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import type { SearchResponse, SearchResult } from '@/domain/recipe-search-read'
import { FacetFieldset, type FacetOption } from './facet-fieldset'
import { SearchSection } from './search-section'
import { SortToggle } from './sort-toggle'
import { DiscoveryFeed } from './discovery-feed'
import { CooksToFollowRail } from './cooks-to-follow-rail'
import { useRecommendedCooks } from './use-recommended-cooks'
import { shouldShowRecommendedRail } from '@/domain/recommended-cooks-read'
import { CookSearchCluster } from './cook-search-cluster'
import type { ProfileFollowUser } from '@/domain/recipe-profile-read'
import type { BadgeLabels } from './recipe-result-item'
import { ImportRecipeDialog, type ImportDialogLabels, type WebLink } from './import-recipe-dialog'
import { useHomeSearch } from './home-search-context'

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
  highlight = null,
  webAvailable = true,
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
  /**
   * #457: bloco "Receita da semana" — JSX já montado pelo Server Component pai (`page.tsx`), que
   * fez a leitura DB-direta/anônima do slot editorial. Renderizado SÓ no REPOUSO (mesmo branch do
   * `<DiscoveryFeed>`, ANTES dele) — nunca aparece no estado REFINADO (busca ativa), espelhando o
   * feed seeded. `null` (ausente/catálogo vazio) ⇒ nada renderiza, sem regressão pra quem não é home.
   */
  highlight?: ReactNode
  /**
   * A Descoberta na web está LIGADA (config admin + allowlist não vazia + chave do provedor)? Resolvido
   * no servidor pela home. `false` ⇒ a Busca nem chama `/api/discovery/web` e esconde os gatilhos
   * "Buscar na web" (seriam um beco sem saída). Default `true` preserva o comportamento de antes.
   */
  webAvailable?: boolean
} = {}) {
  const { locale, messages } = useLocale()
  const m = messages.busca
  const router = useRouter()
  const pathname = usePathname()
  const returnTo = pathname ?? '/'

  // #116: estado de sessão SÓ para a CÓPIA (a dica inicial). O `viewerId` real e o gate vivem
  // no servidor (GET /api/search o resolve do cookie) — a UI nunca passa id nenhum. fail-open
  // (error / isPending) → trata como anônimo (dica de comunidade), sem travar a tela.
  // #166: a mesma sessão decide o ramo do CTA "Gerar com IA": logado → link pro /create; visitante
  // → convite de entrar (espelha o gate do RecipeDetailActions: pending/error/null = anônimo).
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const dicaInicial = authed ? m.dicaInicialLogado : m.dicaInicial

  // #5 (protótipo final): o TERMO da busca foi ELEVADO ao HomeSearchProvider (layout) pra a pílula
  // viver DENTRO do header (linha 2, só na home) enquanto este componente segue sendo o cérebro. Só
  // o `q` sobe; todo o resto do estado fica aqui. `registerSubmit` deixa o Enter no pill disparar o
  // `doSearch` sem esperar o debounce (como o `onSubmit` da pílula de antes). Sem provider montado (a
  // Busca legada fora da home, ou testes do header), o default INERTE do contexto evita explodir.
  const { q, setQ, registerSubmit, setWide } = useHomeSearch()
  const [cozinha, setCozinha] = useState<string[]>([])
  const [categoria, setCategoria] = useState<string[]>([])
  const [restricao, setRestricao] = useState<string[]>([])
  // Ordenação da Comunidade (#62). `relevancia` é o default; só vai à URL quando difere
  // (espelha o estilo de `q`/facetas). Mudar `sort` re-monta `doSearch` ⇒ o effect
  // debounced re-busca. O servidor reordena SÓ a Comunidade (Catálogo é editorial, ADR-0003).
  const [sort, setSort] = useState<Sort>('relevancia')
  const [data, setData] = useState<SearchResponse | null>(null)
  const [status, setStatus] = useState<Status>('idle')

  // #5 (Direção C): a trilha de filtros é PERMANENTE no desktop (`lg:`) e vira um DISCLOSURE no mobile
  // (botão "Filtros"). `filtersOpen` governa SÓ a abertura no mobile — no desktop a trilha ignora este
  // estado (CSS `lg:flex`). Recolher/expandir é puro toggle de visibilidade: as facetas vivem no
  // useState do pai, então não se perde seleção nem re-dispara busca (só uma instância no DOM).
  const [filtersOpen, setFiltersOpen] = useState(false)

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

  // #5: status da busca de Cozinheiros, SÓ para não FLASHAR o cartão de estado vazio. O cluster e a busca
  // de receitas resolvem em paralelo; sem isto, um termo que casa um Cozinheiro mas zero receitas pintaria
  // o cartão "Nada por aqui — nem na comunidade" no intervalo até o cluster chegar (afirmação falsa, logo
  // desmentida). `loading` enquanto a busca de cooks do termo CORRENTE está em voo ⇒ segura o cartão vazio.
  const [cooksStatus, setCooksStatus] = useState<'idle' | 'loading' | 'done'>('idle')

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
        setCooksStatus('done')
        return
      }
      const body = (await res.json()) as { cooks: ProfileFollowUser[] }
      setCooks(body.cooks ?? [])
      setCooksStatus('done')
    } catch (err) {
      // AbortError (busca superada): uma nova busca já re-setou `cooksStatus='loading'` — NÃO mexer (não
      // limpa: o abort vem de uma nova busca que já vai semear). Rede caída: marca `done` para o estado
      // vazio poder aparecer (não fica preso em `loading` suprimindo o cartão).
      if (!(err instanceof DOMException && err.name === 'AbortError')) setCooksStatus('done')
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
      setCooksStatus('idle')
      setStatus('idle')
      return
    }

    // #279: cluster de Cozinheiros em PARALELO (antes do await do /api/search — não-bloqueante). Só com
    // termo >= 3 chars (alinha com o trigrama do índice + corta ruído de 1–2 chars; a rota faz o gate
    // fino no termo CLASSIFICADO). Facet-only ou termo curto ⇒ aborta e limpa o cluster (some ao trocar
    // pra busca-por-faceta). Independente do resultado das receitas.
    const cookTerm = q.trim()
    if (cookTerm.length >= 3) {
      // #5: marca `loading` SÍNCRONO (antes de qualquer await) ⇒ quando a busca de receitas concluir
      // vazia, o cartão vazio fica suprimido até a busca de cooks resolver (sem flash de "nada na
      // comunidade" logo antes de um Cozinheiro aparecer). `discoverCooks` volta a `done` ao resolver.
      setCooksStatus('loading')
      void discoverCooks(cookTerm)
    } else {
      cooksAbortRef.current?.abort()
      setCooks([])
      // Sem busca de cooks (termo curto/faceta-only) ⇒ não há o que suprimir: o cartão vazio pode aparecer.
      setCooksStatus('idle')
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
      // #5 (protótipo final): a web AUTO só acende no acervo RASO-mas-NÃO-vazio (1..2 locais, OU
      // sugestões-only com 0 diretos). No TRULY-empty (`!hasAny` ≡ `isEmpty`) NÃO auto-dispara — o
      // estado vazio passa a OFERECER o cartão "Buscar na web" (ação do usuário; o mock final mostra
      // o cartão, sem "Da web" automática). `hasAny` INCLUI `sugestoes` (senão a busca sugestões-only,
      // localCount 0, perderia a ponte web — regressão vs o `localCount < 3` de antes).
      const hasAny = localCount > 0 || (body.sugestoes?.length ?? 0) > 0
      const term = q.trim()
      if (webAvailable && term !== '' && localCount < SHALLOW_THRESHOLD && hasAny) {
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
  }, [hasCriteria, q, locale, cozinha, categoria, restricao, sort, discoverWeb, discoverCooks, webAvailable])

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

  // #5: registra o `doSearch` corrente como o `submit` do HomeSearchBar — Enter no pill dispara a
  // busca AGORA (bypassa o debounce de 300ms), preservando o comportamento do `onSubmit` da pílula
  // de antes. Re-registra quando `doSearch` muda de identidade (deps do useCallback).
  useEffect(() => {
    registerSubmit(() => void doSearch())
  }, [doSearch, registerSubmit])

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
      // #5: o `q` vive no provider de SESSÃO (layout), não morre com este componente. Ao SAIR da home
      // (unmount) zera o termo — voltar à home depois cai em REPOUSO, não num refino obsoleto. `setQ`
      // é estável (setter do useState do provider), então o cleanup roda só no unmount.
      setQ('')
    }
  }, [setQ])

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

  // Gerar a partir da busca: `ok` ⇒ o termo já serve de pedido (cartão no vazio + atalho sob os
  // resultados); `too_short` ⇒ dica "digite mais algumas letras" no lugar do cartão; `none` (sem termo,
  // só facetas) ⇒ cartão genérico do vazio, sem atalho.
  const generability = searchTermGenerability(q)

  // #275: contagem do acervo LOCAL (mesmas 3 seções do gate automático #164, sem `sugestoes`). O CTA
  // manual cobre o caso COMPLEMENTAR do auto-gate (acervo SUFICIENTE: `localCount >= SHALLOW_THRESHOLD`)
  // — "rolei até o fim e nada serviu". No caminho raso (`< limiar`) o auto já disparou, então o CTA não
  // aparece (sem flash nem redundância). Espelha byte-a-byte o `localCount` de `doSearch`.
  const localCount = data ? data.minhas.length + data.catalogo.length + data.comunidade.length : 0

  // #278 (ADR-0024 emendado): o fetch dos "Cozinheiros em alta" é ELEVADO pra cá (era dentro do trilho) pra
  // o LAYOUT decidir NUM ÚNICO render se abre as 3 colunas das telas largas — sem coluna fantasma vazia no
  // caso anon/SSR/poucos-cozinheiros. `cooks` vem `[]` p/ Visitante/SSR (Modelo B), então `railVisible` só
  // liga p/ logado, em REPOUSO (`!hasCriteria`) e com ≥1 cozinheiro (`shouldShowRecommendedRail`; só 0 esconde).
  // É a ÚNICA chave da largura larga (`xl:max-w-wide`) + da 3ª coluna abaixo — anon/busca ficam no layout
  // 2-col `reading` APROVADO (home indexável byte-idêntica).
  const { cooks: recommendedCooks } = useRecommendedCooks()
  const railVisible = home && !hasCriteria && shouldShowRecommendedRail(recommendedCooks.length)

  // Publica `railVisible` no header (via HomeSearchProvider) pra ele ALARGAR junto (`xl:max-w-wide`) e a
  // chrome alinhar com as 3 colunas do corpo. Reseta a `false` ao desmontar (sair da home) ou quando o
  // trilho some (busca / poucos cozinheiros) — o header volta à largura `page` APROVADA.
  useEffect(() => {
    setWide(railVisible)
    return () => setWide(false)
  }, [railVisible, setWide])

  return (
    <Container
      as="main"
      size="reading"
      className={cn('flex flex-col gap-8 py-8 sm:py-12', railVisible && 'xl:max-w-wide')}
    >
      {/* #5 (ADR-0020 "a Descoberta é a home"): o `<h1>` é a IDENTIDADE da página E a fonte do `<title>`
          de SEO (generateMetadata lê `busca.titulo`), renomeado "Descobrir receitas". Fica sr-only — o
          mock Direção C não tem título visível; o heading VISÍVEL da home indexável é o do feed de repouso
          (DiscoveryFeed `<h2>`). sr-only é clip-based (segue no DOM, crawlável), não display:none. */}
      <h1 className="sr-only">{m.titulo}</h1>

      {/* #5 (protótipo final): a pílula de busca MUDOU-SE pra DENTRO do header (linha 2, só na home) —
          ver `HomeSearchBar`/`SiteHeader`. O termo (`q`) vem do `HomeSearchProvider`; aqui o cérebro só
          o consome (debounce + Enter via `registerSubmit`). O `<h1>` sr-only acima segue sendo a
          identidade da página E a fonte do `<title>` de SEO (generateMetadata lê `busca.titulo`). */}

      {/* #5 (Direção C / 3 colunas): grade [trilha de filtros | coluna principal | cozinheiros].
          - `lg:` (1024–1279): 2 colunas [trilha | principal], centradas em `reading` (52rem) = APROVADO.
          - `xl:` (≥1280, SÓ com `railVisible`): 3 colunas [trilha 200px | leitura ≤700px | cozinheiros
            300px], `justify-center` no container largo (96rem); `2xl:` sobe pros números do 1440p
            (240/780/340 + gap 72px). O 3º track só existe quando o trilho VAI pintar — sem coluna
            fantasma no caso anon/poucos-cozinheiros (a home indexável fica 2-col `reading`).
          - Mobile: coluna única — barra de ferramentas em cima, trilha como disclosure, depois os
            resultados; o trilho de cozinheiros recua pro FIM do feed (ver o item da grade abaixo).
          Posicionamento EXPLÍCITO (`lg:`/`xl:col-start/row-start`) p/ cada bloco cair na sua coluna. */}
      <div
        className={cn(
          'grid grid-cols-1 gap-x-7 gap-y-4 lg:grid-cols-[11.75rem_1fr]',
          railVisible &&
            'xl:grid-cols-[12.5rem_minmax(0,43.75rem)_18.75rem] xl:justify-center xl:gap-x-12 2xl:grid-cols-[15rem_minmax(0,48.75rem)_21.25rem] 2xl:gap-x-[4.5rem]',
        )}
      >
        {/* Barra de ferramentas: "Filtros" (SÓ mobile) + eco "Resultados para X" + ordenação. Col 2 /
            linha 1 (na coluna principal). No desktop a trilha é permanente ⇒ "Filtros" some (`lg:hidden`).
            Em REPOUSO (`!hasCriteria`) a barra não tem conteúdo de desktop (Filtros é mobile; sort/eco só
            com critério) ⇒ `lg:hidden` colapsa a linha vazia e a coluna principal sobe pra linha 1
            (`lg:row-start-1`, abaixo), alinhando o feed ao topo da trilha (sem espaço morto no mock). */}
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 lg:col-start-2 lg:row-start-1',
            !hasCriteria && 'lg:hidden',
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            {/* Disclosure MOBILE da trilha (WAI-ARIA disclosure: aria-expanded/-controls → `#search-filters`).
                `type=button` (defensivo: fora do <form>, mas nunca submete). */}
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              aria-controls="search-filters"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-fg transition-colors hover:border-brand lg:hidden"
            >
              {filtrosLabel}
            </button>
            {q.trim() !== '' && (
              <p className="text-sm text-muted">
                {m.resultadosPara}{' '}
                <strong className="font-semibold text-fg">{`“${q.trim()}”`}</strong>
              </p>
            )}
          </div>
          {/* Ordenação da Comunidade (#62). Gateada por `hasResults` (não `hasCriteria`): o mock esconde a
              ordenação no estado VAZIO/loading (ordenar zero resultados não faz sentido). Seguro contra o
              "trap" do T-sort-D: `hasResults` é INVARIANTE a `sort` (sort só reordena a Comunidade; o nº de
              itens não muda), então a visibilidade não oscila ao alternar — o usuário nunca fica preso em
              Popularidade. Vive na barra, NÃO dentro da seção Comunidade (que some quando vazia). */}
          {hasResults && (
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

        {/* TRILHA de filtros — col 1, linhas 1-2 (desktop permanente); mobile = disclosure (`hidden` até
            abrir via "Filtros"). UMA instância no DOM: `hidden`/`lg:flex` só mostra/reposiciona — NUNCA
            duplica facetas (senão getByLabelText casaria 2 e quebraria os testes). Recolher/expandir é
            puro CSS: a seleção vive no pai, não re-dispara busca. LINHAS de checkbox (FacetFieldset). */}
        <aside
          id="search-filters"
          className={cn(
            'flex-col gap-6 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:flex',
            filtersOpen ? 'flex' : 'hidden',
          )}
        >
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
        </aside>

        {/* COLUNA PRINCIPAL — col 2. Linha 2 quando há barra (com critério); linha 1 em REPOUSO (a barra é
            `lg:hidden`, então o feed sobe e alinha ao topo da trilha). Eco da consulta + repouso (FORA da
            live region) + a região viva dos resultados de busca. */}
        <div
          className={cn(
            'flex min-w-0 flex-col gap-8 lg:col-start-2',
            hasCriteria ? 'lg:row-start-2' : 'lg:row-start-1',
          )}
        >
          {/* Consulta resolvida (#10) — eco READ-ONLY (Decisão 6). Some quando há faceta explícita. Gated
              por `status==='done'`: nunca mostra a resolução de uma busca ANTERIOR junto de erro/loading. */}
          {status === 'done' && data?.consulta && (
            <ResolvedQueryEcho
              consulta={data.consulta}
              label={m.consultaLabel}
              cozinhaLabel={cozinhaLabelMap}
              categoriaLabel={messages.categoriaLabel}
              restricaoLabel={messages.restricaoLabel}
            />
          )}

          {/* #236 REPOUSO — FORA da live region (conteúdo NAVEGÁVEL, não status efêmero: a paginação do
              feed não pode floodar o leitor de tela). home ⇒ feed SSR seeded (indexável, com `<h2>`
              visível); Busca legada ⇒ dica inicial. Ao buscar/filtrar, sai daqui e a região viva assume. */}
          {status === 'idle' &&
            data === null &&
            (home ? (
              <>
                {/* #457: "Receita da semana" — SÓ no repouso, ACIMA do feed. */}
                {highlight}
                <DiscoveryFeed initialItems={initialFeed} initialNextCursor={initialNextCursor} />
              </>
            ) : (
              <p className="text-muted">{dicaInicial}</p>
            ))}

          {/* Região VIVA dos resultados de BUSCA. `aria-live=polite` + `aria-busy` anunciam fim de loading
              e resultado (chegada/vazio/erro) sem recarregar. O texto VISÍVEL de cada estado é o anunciado
              (sem duplicar nó SR-only, que faria `findByText` casar dois elementos). */}
          <div aria-live="polite" aria-busy={status === 'loading'} className="flex flex-col gap-8">
            {/* #279: cluster de Cozinheiros flutua no TOPO dos resultados quando alguém casa o termo.
                Gated `status!=='error'` (espelha "Da web"); `key`=assinatura dos cooks (remonta ⇒ reseta
                "Ver todos"). null quando ninguém casa. */}
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

            {/* #5 (protótipo final) + #279: estado VAZIO honesto — kicker (não-heading) + manchete
                serifada (h2) + corpo (`semResultado`, a copy do mock) + os DOIS cartões do mock:
                "Gerar com IA" (saída de criação contextual) E "Buscar na web" (gatilho MANUAL — o mock
                final mostra ESTE cartão no vazio, não a "Da web" automática; o auto-gate #164 agora só
                acende no raso-NÃO-vazio). UM único `<section>` nomeado + UM h2; os cartões são `<div>`s
                com título `<p>` (não h2/region aninhado dentro da live region — a11y). Só quando NÃO há
                Cozinheiro casando (senão o cluster acima É o resultado) E a busca de cooks do termo
                corrente já assentou (`cooksStatus !== 'loading'`) — senão o cartão flasharia "nada na
                comunidade" no intervalo até o cluster chegar (#5). */}
            {isEmpty && cooks.length === 0 && cooksStatus !== 'loading' && (
              <section
                aria-labelledby="busca-vazio-titulo"
                className="flex flex-col gap-3 rounded-2xl border border-border bg-surface px-6 py-6"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {m.vazioKicker}
                </span>
                <h2 id="busca-vazio-titulo" className="font-display text-2xl font-semibold text-fg">
                  {m.vazioTitulo}
                </h2>
                <p className="max-w-[54ch] text-sm text-muted">{m.semResultado}</p>
                <div className="mt-1 flex flex-col gap-2.5">
                  {generability === 'too_short' ? (
                    <p className="text-sm text-muted">{m.digiteMaisLetras}</p>
                  ) : (
                    <GerarComIaCta
                      q={q}
                      authed={authed}
                      sessionPending={session.isPending}
                      gerarLabel={m.gerarComIa}
                      cardTitulo={m.vazioGerarTitulo}
                      cardTexto={m.vazioGerarTexto}
                      conviteTitulo={messages.minhasCriacoes.convidaEntrarTitulo}
                      conviteTexto={messages.minhasCriacoes.convidaEntrarTexto}
                      signInLabel={messages.nav.signIn}
                      returnTo={returnTo}
                    />
                  )}
                  {/* Card "Buscar na web": SÓ com termo (`handleWebManual` early-returns sem `q` ⇒ na
                      busca faceta-only o botão seria morto) e SÓ enquanto a web não populou (`webLinks`
                      vazio) — ao popular, a `WebDiscoverySection` abaixo assume e este cartão some (sem
                      ficar redundante acima dos resultados que ele produziu). */}
                  {webAvailable && q.trim() !== '' && webLinks.length === 0 && (
                    <BuscarNaWebCard
                      state={webManualState}
                      onSearch={handleWebManual}
                      titulo={m.vazioWebTitulo}
                      texto={m.vazioWebTexto}
                      botaoLabel={m.buscar}
                      buscandoLabel={m.webManualBuscando}
                      nadaLabel={m.webManualNada}
                    />
                  )}
                </div>
              </section>
            )}

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

        {/* Atalho "Gerar com IA" SOB os resultados: a busca achou algo, mas talvez não o que a pessoa
            queria. Só com termo que já serve de pedido (`ok`) e busca assentada (`done`), pra não piscar
            a cada tecla. Link para `/create?q=` (logado) ou para entrar (visitante) — nunca gera sozinho. */}
        {status === 'done' && hasResults && generability === 'ok' && (
          <GerarAtalho
            q={q}
            authed={authed}
            sessionPending={session.isPending}
            lead={m.gerarAtalhoLead}
            label={m.gerarAtalho.replace('{termo}', q.trim())}
            returnTo={returnTo}
          />
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
        {webAvailable &&
          status === 'done' &&
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
        </div>

        {/* TRILHO "Cozinheiros em alta" (#278, ADR-0024 emendado) — 3ª coluna da grade. Item DIRETO da
            grade (irmão da coluna principal ⇒ FORA da live region, invariante #5). Renderiza SÓ quando
            `railVisible` (logado + repouso + ≥1 cozinheiro) — sem coluna fantasma vazia. `xl:col-start-3`
            = coluna à DIREITA em telas largas; `lg:col-start-2 lg:row-start-2` = abaixo da coluna principal
            em laptops estreitos (1024–1279); mobile (col única): flui como ÚLTIMO item ⇒ no FIM do feed. */}
        {railVisible && (
          <div className="lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1">
            <CooksToFollowRail cooks={recommendedCooks} />
          </div>
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
      {/* #5 (protótipo final): linhas compactas com divisórias finas — border-top no <ul>, cada
          gatilho traz a sua border-bottom (ver ImportRecipeDialog). */}
      <ul className="border-t border-border">
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
 * #5 (protótipo final): cartão "Buscar na web" do ESTADO VAZIO — o gatilho MANUAL da descoberta na web
 * no caminho TRULY-empty (o auto-gate #164 agora só acende no raso-NÃO-vazio). Reusa a máquina de
 * estados do #275 (`handleWebManual` → `webManualState`): `idle` ⇒ botão "Buscar" (contornado, como no
 * mock); `loading` ⇒ o mesmo botão disabled + `aria-busy` + "Buscando…"; `done` com a web vazia ⇒ aviso
 * NEUTRO ("nada na web agora"), nunca erro vermelho. Quando a web POPULA, o PAI esconde este cartão
 * (gate `webLinks.length === 0`) e a `WebDiscoverySection` abaixo assume — então `done` aqui ⇒ voltou
 * vazio. É um `<div>` (não region/section) com título `<p>`: não aninha landmark/heading dentro da live
 * region (a11y, espelha o `GerarComIaCta`). O botão é gateado no PAI por `q.trim() !== ''`.
 */
function BuscarNaWebCard({
  state,
  onSearch,
  titulo,
  texto,
  botaoLabel,
  buscandoLabel,
  nadaLabel,
}: {
  state: 'idle' | 'loading' | 'done'
  onSearch: () => void
  titulo: string
  texto: string
  botaoLabel: string
  buscandoLabel: string
  nadaLabel: string
}) {
  const loading = state === 'loading'
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold text-fg">{titulo}</p>
        <p className="mt-1 text-sm text-muted">{texto}</p>
      </div>
      {state === 'done' ? (
        <p className="shrink-0 text-sm text-muted">{nadaLabel}</p>
      ) : (
        <Button
          variant="outline"
          type="button"
          onClick={onSearch}
          disabled={loading}
          aria-busy={loading}
          className="shrink-0"
        >
          {loading ? buscandoLabel : botaoLabel}
        </Button>
      )}
    </div>
  )
}

/**
 * Cartão "Gerar com IA" do ESTADO VAZIO (#5, ADR-0019 emenda) — a saída de criação CONTEXTUAL quando a
 * busca não acha nada. REBAIXADO do CTA permanente de antes (#166): a entrada SEMPRE-disponível pra criar
 * é o "Criar" do header global; aqui é a ponte do "não achei, e agora?". NÃO auto-dispara: a Busca nunca
 * cria. Dois ramos, espelhando o gate do `RecipeDetailActions` (a UI só escolhe a CÓPIA; o gate de escrita
 * real é server-side):
 *
 *  - LOGADO → CARTÃO com título/descrição + link pro fluxo de criação `/create?q=<termo>`, PRÉ-PREENCHENDO
 *    o texto livre com o termo buscado. A rota `/create` monta `CreateShellClient → CreateDrawer`, que lê o
 *    `?q` da URL e o repassa como `initialFreeText` (ponte; a Busca nunca gera). Sem termo (vazio por
 *    faceta), leva ao `/create` cru (gerar do zero) — sem `?q=` espúrio.
 *  - VISITANTE → convite de entrar (gerar exige conta), reusando `minhasCriacoes.convidaEntrar*` + `nav.signIn`.
 *
 * Enquanto a sessão resolve (`sessionPending`), mostra o ramo logado (otimista): o pior caso é um clique
 * que cai no gate de escrita do servidor — nunca um flash do convite pra quem está logado. O ícone Sparkles
 * é decorativo (`aria-hidden`); o rótulo nomeia o link/seção.
 */
function GerarComIaCta({
  q,
  authed,
  sessionPending,
  gerarLabel,
  cardTitulo,
  cardTexto,
  conviteTitulo,
  conviteTexto,
  signInLabel,
  returnTo,
}: {
  q: string
  authed: boolean
  sessionPending: boolean
  gerarLabel: string
  cardTitulo: string
  cardTexto: string
  conviteTitulo: string
  conviteTexto: string
  signInLabel: string
  returnTo: string
}) {
  // Visitante (sessão resolvida e SEM usuário): convite de entrar. Otimista durante o pending.
  if (!authed && !sessionPending) {
    return (
      // #5: um <div> (não <section>) — a seção do estado VAZIO em volta já provê o landmark `region`
      // nomeado; aninhar OUTRO landmark nomeado dentro da live region só adiciona verbosidade pro leitor
      // de tela. O rótulo do convite segue um <p> (não <h2>): a Busca reserva os headings nível 2 às
      // seções de RESULTADO.
      <div className="flex flex-col gap-3 rounded-xl border border-brand/50 bg-brand/[0.06] px-4 py-4">
        <p
          className="flex items-center gap-2 font-display text-base font-semibold text-fg"
        >
          <Sparkles className="size-[18px] shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
          {gerarLabel}
        </p>
        <p className="max-w-[60ch] text-sm text-muted">{conviteTexto}</p>
        <div>
          <Button asChild>
            <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{signInLabel}</Link>
          </Button>
        </div>
        {/* `conviteTitulo` ("Entre para fazer isso") dá o contexto extra pro leitor de tela — o
            rótulo VISÍVEL é o próprio "Gerar com IA". */}
        <span className="sr-only">{conviteTitulo}</span>
      </div>
    )
  }

  // Logado (ou sessão ainda resolvendo): CARTÃO com título/descrição + link pro /create com o termo
  // pré-preenchido. Só anexa `?q` quando há termo (sem `?q=` vazio espúrio na URL).
  const href = q.trim() !== '' ? `/create?q=${encodeURIComponent(q.trim())}` : '/create'
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/50 bg-brand/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold text-fg">{cardTitulo}</p>
        <p className="mt-1 text-sm text-muted">{cardTexto}</p>
      </div>
      <Button asChild className="shrink-0">
        <Link href={href}>
          <Sparkles className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          {gerarLabel}
        </Link>
      </Button>
    </div>
  )
}

/**
 * Atalho discreto "Gerar “termo” com IA" sob os resultados. Mesmo destino do `GerarComIaCta` do vazio
 * (logado → `/create?q=`; visitante → entrar, voltando para a busca), mas em uma linha: aqui a busca
 * TROUXE resultados, então gerar é a saída secundária, não a principal.
 */
function GerarAtalho({
  q,
  authed,
  sessionPending,
  lead,
  label,
  returnTo,
}: {
  q: string
  authed: boolean
  sessionPending: boolean
  lead: string
  label: string
  returnTo: string
}) {
  const href =
    !authed && !sessionPending
      ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}`
      : `/create?q=${encodeURIComponent(q.trim())}`
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <span>{lead}</span>
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 font-medium text-brand-ink underline-offset-4 hover:underline"
      >
        <Sparkles className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        {label}
      </Link>
    </p>
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
