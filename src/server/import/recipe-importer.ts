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
import { createDomainRateLimiter, type DomainRateLimiter } from '@/server/import/rate-limit'
import {
  IMPORT_USER_AGENT,
  MAX_HTML_BYTES,
  ROBOTS_UA_TOKEN,
  robotsAllows,
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
  /** Importa a receita da `url`: fetch + parse JSON-LD. Falhas são TRATADAS (nunca lança). */
  import(url: string): Promise<ImportResult>
}

// Constantes de fetch (UA, caps, timeout) + o fetch FAIL-OPEN do robots.txt vivem em `web-fetch.ts`
// (compartilhados com o probe de saúde #273). Aqui só o ORQUESTRA: rate-limit → robots → página → parse.

/**
 * Impl REAL — fetch da URL + parse PURO do domínio. A ÚNICA I/O é o `fetch`; toda a extração
 * (JSON-LD, locale, ingredientes) é do domínio puro `parseImportedRecipe`. QUALQUER erro de rede/
 * parse/HTTP vira uma falha TRATADA (`fetch_failed`) — NUNCA lança nem vaza stack (espelha o
 * contrato dos outros seams reais). NÃO é exercitada por teste (Fake); só roda ao vivo.
 */
export class RealRecipeImporter implements RecipeImporter {
  // Limiter por-instância (persiste enquanto o singleton lazy de `deps.ts` viver). Injetável p/ teste.
  constructor(private readonly limiter: DomainRateLimiter = createDomainRateLimiter()) {}

  async import(url: string): Promise<ImportResult> {
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

    // GUARD-RAIL robots.txt (#272, ADR-0019): respeita o `Disallow` do site ANTES de buscar a receita.
    // FAIL-OPEN deliberado (≠ o fail-CLOSED do SSRF/allowlist da rota): robots indisponível NÃO é
    // proibição — só uma proibição EXPLÍCITA bloqueia. Roda só no caminho REAL (o Fake nunca chega aqui).
    if (!(await robotsAllows(url, ROBOTS_UA_TOKEN))) {
      return { ok: false, reason: 'robots_blocked' }
    }

    let html: string
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': IMPORT_USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        redirect: 'follow',
      })
      if (!res.ok) return { ok: false, reason: 'fetch_failed' }
      // Defesa de tamanho: lê o corpo capado. (Content-Length é dica; o corte real é no texto.)
      const raw = await res.text()
      html = raw.length > MAX_HTML_BYTES ? raw.slice(0, MAX_HTML_BYTES) : raw
    } catch {
      // URL inválida, DNS, timeout, TLS, etc. — tudo TRATADO como fetch_failed (não importa).
      return { ok: false, reason: 'fetch_failed' }
    }
    return parseImportedRecipe(html, url)
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
