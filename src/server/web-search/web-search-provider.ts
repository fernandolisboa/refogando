/**
 * Seam ÚNICO e mockável para a DESCOBERTA na WEB (#164, ADR-0019).
 *
 * Espelha os outros seams da fundação (`embedder.ts`, `client.ts`, `recipe-importer.ts`): interface +
 * impl REAL + dublê FAKE no MESMO arquivo, injetado via `getWebSearchProvider()/setWebSearchProvider()`
 * em `deps.ts`. Dá uma LISTA PEQUENA de resultados da web para um termo — cada um um LINK externo
 * `{ title, url, sourceName }`, NUNCA conteúdo armazenado nem ranqueado (a Busca só encontra; os links
 * são ponte de descoberta, ADR-0019).
 *
 * O caminho REAL (rede) NÃO é exercitado por teste; os testes injetam o `FakeWebSearchProvider` (links
 * canônicos fixos), como o `FakeEmbedder`/`FakeRecipeImporter`. O provedor concreto + a credencial são
 * GATE HUMANO de deploy (como a Gemini key): sem credencial/provedor, o Real se comporta como
 * DESLIGADO (devolve `[]`, nunca lança) — a feature só "acende" quando o admin liga E há credencial.
 */

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

/**
 * Impl REAL — provedor de busca na web (gate humano de deploy, ADR-0019). Hoje é um STUB consciente:
 * sem credencial/provedor configurado, devolve `[]` (comporta-se como DESLIGADO). A integração concreta
 * (provedor de busca + parser dos resultados, RESTRITA à allowlist) entra quando a credencial estiver
 * no ambiente — espelha o `RealEmbedder`/`RealGeminiImageGenerator` (key lida PREGUIÇOSAMENTE no uso).
 * Este caminho NÃO é exercitado por teste (Fake). Qualquer erro vira `[]` (NUNCA lança).
 */
export class RealWebSearchProvider implements WebSearchProvider {
  async search(_term: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
    // Sem domínios liberados ⇒ nada a buscar (fail-closed). Mesmo com allowlist, sem credencial de
    // provedor a feature fica DESLIGADA (gate humano): devolve vazio em vez de lançar.
    const key = process.env.WEB_SEARCH_API_KEY
    if (!key || opts.allowlist.length === 0) return []
    // Integração concreta deferida ao gate humano (provedor + parser restrito à allowlist). Até lá,
    // comporta-se como desligado — a descoberta degrada graciosamente para só o acervo local.
    return []
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
    url: 'https://panelinha.com.br/receita/feijoada',
    sourceName: 'Panelinha',
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
