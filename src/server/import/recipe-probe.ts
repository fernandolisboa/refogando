/**
 * Seam ÚNICO e mockável do PROBE de saúde de uma URL de receita (#273, ADR-0019).
 *
 * Espelha os outros seams (`recipe-importer.ts`, `embedder.ts`): interface + impl REAL + dublê FAKE no
 * MESMO arquivo, injetado via `getRecipeProbe()/setRecipeProbe()` em `deps.ts`. O probe é ASSISTIVO e
 * IDEMPOTENTE: NÃO persiste nada e NÃO toca a config (allowlist) — é só um check de uma URL ainda-NÃO-vetada
 * antes de o admin decidir adicioná-la. Reporta DOIS sinais — (a) a página tem schema.org/Recipe via
 * JSON-LD? (b) o robots.txt da origem permite o RefogandoBot nesse path? — mas avalia o robots PRIMEIRO e
 * só busca a página se ele PERMITIR (espelha o `RealRecipeImporter`, que devolve `robots_blocked` ANTES do
 * fetch); devolve um `ProbeReport` (derivação pura em `domain/web-search-probe.ts`).
 *
 * SEGURANÇA (SSRF) — o probe é o PRIMEIRO ponto onde URL admin-arbitrária chega ao `fetch` SEM a barreira
 * de allowlist. Defesas, nesta ordem: (1) `parseProbeUrl` (só http(s), rejeita IP privado/loopback/
 * link-local e hostnames internos — a rota já roda isto antes de chamar o seam); (2) resolução DNS de
 * TODOS os endereços ANTES de conectar, rejeitando qualquer privado, e PIN do IP validado no connect
 * (undici `connect.lookup` — o `fetch` não re-resolve; fecha a janela de DNS-rebind entre a checagem e a
 * conexão, com `Host`/SNI TLS = hostname original); (3) follow de redirect LIMITADO (≤3 hops) e
 * RE-VALIDADO por hop (parseProbeUrl + DNS + pin); (4) timeout + cap por streaming. NUNCA lança — todo
 * erro vira `fetched:false` (veredito tratado).
 *
 * DESVIOS CONSCIENTES (registrados aqui, não silenciosos):
 *  - Rate-limiter de politeness (#272) PULADO de propósito: o probe é admin-only e MANUAL (uma URL por
 *    clique), não um crawler — não martela origem.
 */
import { parseImportedRecipe } from '@/domain/recipe-import-parse'
import { jsonLdSignal, type ProbeReport } from '@/domain/web-search-probe'
import { parseProbeUrl } from '@/server/import/probe-url'
import {
  ROBOTS_UA_TOKEN,
  robotsAllows,
  fetchHardenedHtml,
  hostnameOf,
  isHostPublic,
  type AddressLookup,
} from '@/server/import/web-fetch'

// `AddressLookup` mora em `web-fetch.ts` (compartilhado com o fetch endurecido do importer, #448);
// re-exportado aqui p/ compat dos chamadores/testes que já o importavam do seam do probe.
export type { AddressLookup }

export interface RecipeProbe {
  /** Checa a `url` (JSON-LD + robots). Nunca lança — falhas viram `fetched:false`. */
  probe(url: string): Promise<ProbeReport>
}

/**
 * Impl REAL — a ÚNICA I/O (DNS + fetch). NÃO é exercitada por teste de produção; os testes injetam o
 * `FakeRecipeProbe` ou mockam `fetch`/`lookup` para provar a FIAÇÃO. Qualquer erro vira `fetched:false`.
 */
export class RealRecipeProbe implements RecipeProbe {
  constructor(private readonly lookupFn?: AddressLookup) {}

  async probe(url: string): Promise<ProbeReport> {
    // Re-valida a barreira de SSRF defensivamente (a rota já roda parseProbeUrl, mas o seam não confia
    // no chamador) e resolve o host de ORIGEM. NENHUM fetch — nem robots.txt nem página — toca a rede
    // antes de o DNS confirmar que a origem NÃO é privada (defesa contra rebind, fecha o flanco também
    // do GET do robots.txt). Origem inválida/privada ⇒ não-buscável, robots fica no fail-open (true).
    const parsed = parseProbeUrl(url)
    const host = parsed === null ? null : hostnameOf(parsed)
    const originAllowed = host !== null && (await isHostPublic(host, this.lookupFn))
    if (parsed === null || !originAllowed) {
      return { fetched: false, jsonLd: 'absent', robotsAllowed: true }
    }

    // GUARD-RAIL robots (#272, ADR-0019): avalia o robots da ORIGEM PRIMEIRO; só busca a página se ele
    // PERMITIR. FAIL-OPEN (robots indisponível ⇒ true); uma proibição EXPLÍCITA (Disallow casando ⇒ false)
    // curto-circuita ANTES do fetch da página — espelha o `RealRecipeImporter`, que devolve `robots_blocked`
    // sem buscar. Não martelar (nem com o probe admin-manual) um site que nos proibiu.
    let robotsAllowed = true
    try {
      robotsAllowed = await robotsAllows(parsed, ROBOTS_UA_TOKEN, this.lookupFn)
    } catch {
      robotsAllowed = true // FAIL-OPEN (robotsAllows já não lança, mas cinto-e-suspensório)
    }
    if (!robotsAllowed) {
      return { fetched: false, jsonLd: 'absent', robotsAllowed: false }
    }

    // Fetch ENDURECIDO compartilhado (#448): follow LIMITADO re-validado por hop + DNS anti-rebind +
    // streaming com corte + timeout. Antes vivia AQUI; foi consolidado em `web-fetch.ts` p/ o importer usar.
    const page = await fetchHardenedHtml(parsed, this.lookupFn)
    if (!page) return { fetched: false, jsonLd: 'absent', robotsAllowed }
    return { fetched: true, jsonLd: jsonLdSignal(parseImportedRecipe(page.html, page.finalUrl)), robotsAllowed }
  }
}

/**
 * Dublê determinístico para testes: devolve o `ProbeReport` enlatado. Cada teste injeta UMA instância via
 * `setRecipeProbe` (como o `FakeRecipeImporter`). Ignora a URL — só ecoa o report.
 */
export class FakeRecipeProbe implements RecipeProbe {
  constructor(private readonly canned: ProbeReport) {}

  async probe(): Promise<ProbeReport> {
    return this.canned
  }
}
