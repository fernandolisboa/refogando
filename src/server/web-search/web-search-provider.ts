/**
 * Seam ÚNICO e mockável para a DESCOBERTA na WEB (#164, ADR-0019).
 *
 * Espelha os outros seams da fundação (`embedder.ts`, `client.ts`, `recipe-importer.ts`): interface +
 * impl REAL + dublê FAKE no MESMO arquivo, injetado via `getWebSearchProvider()/setWebSearchProvider()`
 * em `deps.ts`. Dá uma LISTA PEQUENA de resultados da web para um termo — cada um um LINK externo
 * `{ title, url, sourceName }`, NUNCA conteúdo armazenado nem ranqueado (a Busca só encontra; os links
 * são ponte de descoberta, ADR-0019).
 *
 * A maioria dos testes injeta o `FakeWebSearchProvider` (links canônicos fixos), como o
 * `FakeEmbedder`/`FakeRecipeImporter`. O caminho REAL (Brave, #271) ganhou testes de unidade próprios
 * com `fetch` mockado (query `site:`, mapeamento, fail-closed, erros → `[]`). O provedor concreto + a
 * credencial são GATE HUMANO de deploy (como a Gemini key): sem credencial, o Real se comporta como
 * DESLIGADO (devolve `[]`, nunca lança) — a feature só "acende" quando o admin liga E há credencial.
 */

import { isUrlAllowed } from '@/domain/web-search-config'
import { bareHost } from '@/domain/source-host'

/** Um resultado da web — SEMPRE um link externo, jamais armazenado nem ranqueado (ADR-0019). */
export type WebSearchResult = {
  /** Título legível do link (o nome da receita na origem). */
  title: string
  /** URL externa (http(s)) — o destino do link. */
  url: string
  /** Nome legível da fonte/publisher (atribuição: "da web · <fonte>"). */
  sourceName: string
}

/** Opções da busca na web. A allowlist é a fonte ÚNICA de domínios (ADR-0019 / web-search-config). */
export type WebSearchOptions = {
  /** Domínios permitidos. O Real RESTRINGE a consulta a estes; vazia ⇒ nada a buscar (`[]`). */
  allowlist: string[]
  /** Locale da Busca (pt-BR/en-US) — dica de idioma para o provedor. Opcional. */
  locale?: string
}

export interface WebSearchProvider {
  /**
   * Busca `term` na web, RESTRITO à allowlist. Devolve poucos links externos. NUNCA lança: erro de
   * rede / sem credencial / provedor indisponível ⇒ `[]` (degradação graciosa — a descoberta segue
   * mostrando só o acervo local).
   */
  search(term: string, opts: WebSearchOptions): Promise<WebSearchResult[]>
}

/** Quantos links no máximo a descoberta mostra (poucos — é ponte, não catálogo). */
export const MAX_WEB_RESULTS = 5

/** Endpoint do Brave Web Search API (v1, #271). Provedor é detalhe trocável (ADR-0019). */
const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
/** Timeout por requisição: a descoberta é assistiva — não pode pendurar a Busca. */
const BRAVE_TIMEOUT_MS = 5_000
/** Teto de tamanho do termo na consulta ao Brave (defesa do seam — o /api/discovery/web já capa). */
const MAX_TERM_LEN = 256
/**
 * Quantos domínios da allowlist consultar por busca. UMA requisição POR domínio (com `site:<domínio>`):
 * múltiplos `site:` num único `q` são ANDados pelo motor (uma página não está em dois sites) e voltam
 * vazio. O fan-out roda em PARALELO, então o teto é budget de RATE-LIMIT do provedor (o free tier do
 * Brave é ~1 req/s) + custo — NÃO está atado ao `MAX_ALLOWLIST=50` (esse é p/ o guard de SSRF/import,
 * outra preocupação). Allowlist > teto ⇒ só os PRIMEIROS (ordem de inserção do admin) são consultados;
 * a saída capa em `MAX_WEB_RESULTS=5` de qualquer jeito (containment, não completude — AC #271). Fan-out
 * maior / batching é follow-up de escala (gated no plano do Brave).
 */
export const MAX_SITE_QUERIES = 8

/** Forma DEFENSIVA do JSON do Brave — só o que lemos; tudo `unknown` (validado no mapeamento). */
type BraveWebResult = { title?: unknown; url?: unknown; profile?: { name?: unknown } }
type BraveResponse = { web?: { results?: unknown } }

/**
 * O deploy tem a credencial do provedor real? Sem ela o `RealWebSearchProvider` devolve `[]` sem tocar a
 * rede. Exposto para a home esconder os gatilhos "Buscar na web" (lê a MESMA env var do `search`, logo abaixo).
 */
export function hasWebSearchCredential(): boolean {
  return !!process.env.WEB_SEARCH_API_KEY
}

/**
 * Impl REAL — Brave Web Search API (#271, gate humano de deploy: ADR-0019). A `WEB_SEARCH_API_KEY` é
 * lida PREGUIÇOSAMENTE no uso (como `RealEmbedder`/`RealGeminiImageGenerator`); ausente ⇒ DESLIGADO
 * (`[]`). A consulta é RESTRITA à allowlist (`site:<domínio>`, uma requisição por domínio) e os
 * resultados são RE-FILTRADOS pela allowlist (defesa em profundidade — o endpoint re-filtra de novo).
 * NUNCA lança: qualquer erro (rede/timeout/HTTP/JSON malformado) de uma consulta vira `[]`.
 */
export class RealWebSearchProvider implements WebSearchProvider {
  async search(term: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
    // Sem domínios liberados OU sem credencial ⇒ nada a buscar (fail-closed, gate humano). NÃO toca
    // a rede.
    const key = process.env.WEB_SEARCH_API_KEY
    const q = term.trim().slice(0, MAX_TERM_LEN)
    if (!key || q.length === 0 || opts.allowlist.length === 0) return []

    const domains = opts.allowlist.slice(0, MAX_SITE_QUERIES)
    const perDomain = await Promise.all(domains.map((d) => this.queryBrave(key, q, d, opts.locale)))

    // Mescla, dedup por url, RE-FILTRA pela allowlist (o provedor é restrito por contrato), capa. Usa
    // o MESMO predicado do endpoint (`isUrlAllowed`: host na allowlist E protocolo http(s)) — fonte
    // única, sem um link `ftp:`/`javascript:` de host listado escapar por aqui.
    const seen = new Set<string>()
    const merged: WebSearchResult[] = []
    for (const list of perDomain) {
      for (const r of list) {
        if (seen.has(r.url) || !isUrlAllowed(r.url, opts.allowlist)) continue
        seen.add(r.url)
        merged.push(r)
        if (merged.length >= MAX_WEB_RESULTS) return merged
      }
    }
    return merged
  }

  /** UMA consulta ao Brave RESTRITA a `domain` via `site:`. NUNCA lança — qualquer erro vira `[]`. */
  private async queryBrave(
    key: string,
    term: string,
    domain: string,
    locale?: string,
  ): Promise<WebSearchResult[]> {
    try {
      const url = new URL(BRAVE_ENDPOINT)
      url.searchParams.set('q', `${term} site:${domain}`)
      url.searchParams.set('count', String(MAX_WEB_RESULTS))
      const loc = braveLocaleParams(locale)
      if (loc.country) url.searchParams.set('country', loc.country)
      if (loc.searchLang) url.searchParams.set('search_lang', loc.searchLang)

      const res = await fetch(url, {
        headers: { accept: 'application/json', 'x-subscription-token': key },
        signal: AbortSignal.timeout(BRAVE_TIMEOUT_MS),
      })
      if (!res.ok) return [] // 401/429/5xx ⇒ degrada (sem lançar, sem vazar corpo ao cliente)
      const body = (await res.json()) as BraveResponse
      // `web.results` ausente/nulo/não-array ⇒ nada a mapear (resposta inesperada do provedor).
      const results = Array.isArray(body.web?.results) ? body.web.results : []
      const mapped: WebSearchResult[] = []
      for (const r of results) {
        const m = toWebSearchResult(r as BraveWebResult)
        if (m) mapped.push(m)
      }
      return mapped
    } catch {
      // URL inválida, DNS, timeout (AbortSignal), TLS, JSON malformado — tudo vira `[]`.
      return []
    }
  }
}

/** Mapeia um resultado cru do Brave → `WebSearchResult`. `null` se sem url/título usável. */
function toWebSearchResult(r: BraveWebResult): WebSearchResult | null {
  if (typeof r.url !== 'string' || typeof r.title !== 'string' || r.title.trim() === '') return null
  const fromHost = sourceNameFromUrl(r.url)
  if (!fromHost) return null // URL inválida → descarta (sem link sem destino)
  // Atribuição: prefere o nome do publisher do Brave (`profile.name`, ex.: "TudoGostoso"); cai no
  // host pelado quando ausente. (O FakeWebSearchProvider usa nomes curados — o Real só os tem quando
  // o Brave os fornece.)
  const publisher = typeof r.profile?.name === 'string' ? r.profile.name.trim() : ''
  return { title: r.title, url: r.url, sourceName: publisher !== '' ? publisher : fromHost }
}

/** Nome da fonte = host "pelado" (sem `www.`) — atribuição "da web · <fonte>". `null` se URL inválida.
 *  Delega ao domínio puro `bareHost` (#272): fonte única da normalização compartilhada com a atribuição. */
function sourceNameFromUrl(url: string): string | null {
  return bareHost(url)
}

/**
 * Locale da Busca → dicas de país/idioma do Brave (opcionais). Desconhecido ⇒ sem dica.
 *
 * `search_lang` é um ENUM FECHADO do Brave: pt-BR exige `'pt-br'` (NÃO `'pt'` — esse valor
 * dá HTTP 422, que `queryBrave` engole pra `[]`, deixando TODA descoberta web em português
 * silenciosamente vazia). `'en'` é válido no enum, então en-US fica como está.
 */
function braveLocaleParams(locale?: string): { country?: string; searchLang?: string } {
  switch (locale) {
    case 'pt-BR':
      return { country: 'BR', searchLang: 'pt-br' }
    case 'en-US':
      return { country: 'US', searchLang: 'en' }
    default:
      return {}
  }
}

/**
 * Dublê determinístico para testes: devolve links canônicos fixos (FILTRADOS pela allowlist, como o
 * Real faria), ou uma lista enlatada passada no construtor. Cada teste injeta UMA instância via
 * `setWebSearchProvider`. NUNCA toca a rede. Allowlist vazia ⇒ `[]` (espelha o fail-closed do Real).
 */
export class FakeWebSearchProvider implements WebSearchProvider {
  constructor(private readonly canned?: WebSearchResult[]) {}

  async search(_term: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
    if (opts.allowlist.length === 0) return []
    const results = this.canned ?? CANONICAL_WEB_RESULTS
    // Só links cujo host está coberto pela allowlist (o Real é restrito à allowlist por construção).
    return results
      .filter((r) => hostInAllowlist(r.url, opts.allowlist))
      .slice(0, MAX_WEB_RESULTS)
  }
}

/** Links canônicos fixos do FakeWebSearchProvider (hosts cobertos pela allowlist canônica dos testes). */
export const CANONICAL_WEB_RESULTS: WebSearchResult[] = [
  {
    title: 'Feijoada Completa',
    url: 'https://www.tudogostoso.com.br/receita/feijoada',
    sourceName: 'TudoGostoso',
  },
  {
    title: 'Feijoada à Brasileira',
    url: 'https://cybercook.com.br/receita/feijoada',
    sourceName: 'CyberCook',
  },
]

/** Helper local: o host da `url` está coberto pela allowlist (igual/subdomínio)? `false` se URL inválida. */
function hostInAllowlist(url: string, allowlist: string[]): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
  const bare = host.startsWith('www.') ? host.slice(4) : host
  return allowlist.some((d) => bare === d || bare.endsWith('.' + d))
}
