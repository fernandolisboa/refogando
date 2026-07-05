/**
 * Seam ÚNICO e mockável para IMPORTAR uma receita de um link da web (#165, ADR-0019).
 *
 * Espelha os outros seams da fundação (`embedder.ts`, `client.ts`): interface + impl REAL + dublê
 * FAKE no MESMO arquivo, injetado via `getRecipeImporter()/setRecipeImporter()` em `deps.ts`. A
 * impl REAL faz a ÚNICA parte com I/O — `fetch` da URL — e delega o PARSE ao domínio puro
 * (`parseImportedRecipe`), que extrai schema.org/Recipe (JSON-LD) e detecta o locale. O caminho
 * REAL (rede) NÃO é exercitado por teste; os testes injetam o `FakeRecipeImporter` (receita canônica
 * fixa), como o `FakeEmbedder`/`FakeClaudeClient`.
 *
 * Resultado discriminado (`ImportResult`): `ok` (receita estruturada pronta p/ persistir) OU uma
 * falha TRATADA — `no_jsonld` (sem schema.org/Recipe confiável), `unsupported_locale` (fora de
 * PT/EN — ADR-0001) ou `fetch_failed` (URL inválida/inalcançável/HTTP não-2xx). A rota mapeia
 * qualquer falha tratada → 422 (não importa), NUNCA 500 (não vaza stack).
 */

import { parseImportedRecipe, type ImportedRecipe } from '@/domain/recipe-import-parse'
import { isUrlAllowed } from '@/domain/web-search-config'
import { createDomainRateLimiter, type DomainRateLimiter } from '@/server/import/rate-limit'
import { parseProbeUrl } from '@/server/import/probe-url'
import {
  ROBOTS_UA_TOKEN,
  robotsAllows,
  fetchHardenedHtml,
  hostnameOf,
  isHostPublic,
  type AddressLookup,
} from '@/server/import/web-fetch'

/**
 * Falha TRATADA da importação — nenhuma vira 500. A rota mapeia: `robots_blocked` → 403 (política do
 * site externo), `rate_limited` → 429 (politeness por host), as demais → 422 (não importou). Nunca
 * vaza stack.
 */
export type ImportFailureReason =
  | 'no_jsonld'
  | 'unsupported_locale'
  | 'fetch_failed'
  | 'robots_blocked'
  | 'rate_limited'

export type ImportResult =
  | { ok: true; recipe: ImportedRecipe }
  | { ok: false; reason: ImportFailureReason }

export interface RecipeImporter {
  /**
   * Importa a receita da `url`: fetch + parse JSON-LD. Falhas são TRATADAS (nunca lança). `allowlist`
   * (opcional) é a curadoria de domínios (#164): quando fornecida, CADA hop de redirect é re-checado
   * contra ela (um domínio curado que redirecione p/ host fora da allowlist ⇒ recusado — #448). O Fake
   * ignora ambos os argumentos.
   */
  import(url: string, allowlist?: string[]): Promise<ImportResult>
}

// O fetch da página (ENDURECIDO contra SSRF/rebind/DoS — #448), o fetch FAIL-OPEN do robots.txt e as
// constantes vivem em `web-fetch.ts` (compartilhados com o probe de saúde #273). Aqui só o ORQUESTRA:
// rate-limit → robots → página (fetchHardenedHtml) → parse.

/**
 * Impl REAL — fetch da URL + parse PURO do domínio. A ÚNICA I/O é o `fetch` (via `fetchHardenedHtml`);
 * toda a extração (JSON-LD, locale, ingredientes) é do domínio puro `parseImportedRecipe`. QUALQUER erro
 * de rede/parse/HTTP vira uma falha TRATADA (`fetch_failed`) — NUNCA lança nem vaza stack (espelha o
 * contrato dos outros seams reais). NÃO é exercitada por teste (Fake); só roda ao vivo.
 *
 * SSRF (#448): o `fetch` da página passa pela MESMA barreira endurecida do probe — DNS resolvido antes de
 * conectar (anti-rebind), redirect MANUAL re-validado por hop (um host allowlistado que devolva 302 p/
 * `http://169.254.169.254/` NÃO é seguido), streaming com corte e timeout. Antes o importer seguia
 * `redirect:'follow'` cru, sem re-validar hops nem resolver DNS: o flanco que esta issue fecha.
 */
export class RealRecipeImporter implements RecipeImporter {
  // Limiter por-instância (persiste enquanto o singleton lazy de `deps.ts` viver). Injetável p/ teste.
  // `lookupFn` (resolvedor DNS) também injetável — os testes fixam endereços sem tocar a rede real.
  constructor(
    private readonly limiter: DomainRateLimiter = createDomainRateLimiter(),
    private readonly lookupFn?: AddressLookup,
  ) {}

  async import(url: string, allowlist?: string[]): Promise<ImportResult> {
    // GUARD-RAIL rate-limit (#272): politeness ~1/s por HOST, ANTES de QUALQUER rede — uma tentativa
    // limitada não toca o site (nem robots.txt nem página). A janela cobre a tentativa inteira. A chave
    // é o hostname: subdomínios distintos de um mesmo site allowlistado têm orçamentos separados —
    // aceitável p/ politeness (não é quota dura; é só pra não martelar a origem).
    let hostname = ''
    try {
      hostname = new URL(url).hostname
    } catch {
      // URL inválida: cai no fetch_failed adiante; aqui não consome a janela.
    }
    if (hostname && !this.limiter.tryAcquire(hostname)) {
      return { ok: false, reason: 'rate_limited' }
    }

    // Predicado de allowlist (#164/#448): quando a rota fornece a curadoria, CADA hop (origem E alvos de
    // redirect) é re-checado — fecha o open-redirect de um domínio curado p/ host arbitrário. Allowlist
    // ausente/vazia ⇒ sem re-checagem aqui (a rota já é fail-closed; o Fake e os units não a passam).
    const isHopAllowed =
      allowlist && allowlist.length > 0 ? (u: string) => isUrlAllowed(u, allowlist) : undefined

    // BARREIRA SSRF de ORIGEM (#448): valida a URL (`parseProbeUrl`: só http(s), rejeita IP-literal
    // privado / host interno, zera userinfo), re-checa a allowlist e resolve o DNS da origem ANTES de
    // QUALQUER rede — nem o `/robots.txt` toca uma origem que resolve p/ IP privado (anti-rebind) nem
    // fora da curadoria. Espelha a ordem do probe (DNS-origem → robots → página); sem isto, o allowlist
    // da rota não protegeria um domínio curado que REBINDA para 169.254.169.254 do próprio fetch do
    // robots.txt. Origem inválida/privada/fora-da-allowlist ⇒ fetch_failed.
    const parsed = parseProbeUrl(url)
    const host = parsed === null ? null : hostnameOf(parsed)
    if (
      parsed === null ||
      host === null ||
      (isHopAllowed && !isHopAllowed(parsed)) ||
      !(await isHostPublic(host, this.lookupFn))
    ) {
      return { ok: false, reason: 'fetch_failed' }
    }

    // GUARD-RAIL robots.txt (#272, ADR-0019): respeita o `Disallow` do site ANTES de buscar a receita.
    // FAIL-OPEN deliberado (≠ o fail-CLOSED do SSRF/allowlist da rota): robots indisponível NÃO é
    // proibição — só uma proibição EXPLÍCITA bloqueia. Roda só no caminho REAL (o Fake nunca chega aqui).
    if (!(await robotsAllows(parsed, ROBOTS_UA_TOKEN))) {
      return { ok: false, reason: 'robots_blocked' }
    }

    // Fetch ENDURECIDO (#448): SSRF pós-redirect / DNS-rebind / DoS fechados. Cada hop re-valida
    // parseProbeUrl + DNS + allowlist (isHopAllowed). Non-2xx, host que resolve p/ IP privado, redirect
    // p/ host privado ou fora da allowlist, excesso de hops, corpo oversized, timeout ou qualquer erro
    // ⇒ `null` ⇒ fetch_failed (TRATADO; nunca 500). Nunca lança. Parseia da URL FINAL (pós-redirects).
    const page = await fetchHardenedHtml(parsed, this.lookupFn, isHopAllowed)
    if (!page) return { ok: false, reason: 'fetch_failed' }
    return parseImportedRecipe(page.html, page.finalUrl)
  }
}

/**
 * Dublê determinístico para testes: devolve a receita canônica enlatada (ou uma falha enlatada). Cada
 * teste injeta UMA instância via `setRecipeImporter`. Por default entrega uma receita pt-BR válida
 * (sucesso); o caller pode passar `canned` para fixar outro conteúdo, ou `failure` para exercitar os
 * caminhos 422 (sem-JSON-LD / idioma não suportado / fetch falho) SEM tocar a rede.
 */
export class FakeRecipeImporter implements RecipeImporter {
  constructor(
    private readonly canned?: ImportedRecipe,
    private readonly failure?: ImportFailureReason,
  ) {}

  async import(): Promise<ImportResult> {
    if (this.failure) return { ok: false, reason: this.failure }
    return { ok: true, recipe: this.canned ?? CANONICAL_IMPORTED_RECIPE }
  }
}

/** Receita canônica fixa do FakeRecipeImporter — pt-BR, atribuição à fonte externa (ADR-0019). Sem
 * headnote nem imagem (#272: a importada nasce com a camada protegida em branco). */
export const CANONICAL_IMPORTED_RECIPE: ImportedRecipe = {
  titulo: 'Bolo de Cenoura',
  passos: [
    'Bata as cenouras, os ovos e o óleo no liquidificador.',
    'Misture o açúcar e a farinha; junte ao liquidificado.',
    'Asse a 180°C por 40 minutos.',
  ],
  notas: null,
  originalLocale: 'pt-BR',
  // `rawText` = NOME sem a medida (ADR-0012 Adendo): a medida vive em quantidade/unidade.
  ingredientes: [
    { rawText: 'cenouras médias', quantidade: '3', unidade: 'unidade' },
    { rawText: 'ovos', quantidade: '4', unidade: null },
    { rawText: 'açúcar', quantidade: '2', unidade: 'xicara' },
    { rawText: 'farinha de trigo', quantidade: '2', unidade: 'xicara' },
  ],
  sourceName: 'Cozinha da Vovó',
}
