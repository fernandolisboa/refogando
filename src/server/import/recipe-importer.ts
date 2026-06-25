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
import { isPathAllowedByRobots } from '@/domain/robots-txt'
import { createDomainRateLimiter, type DomainRateLimiter } from '@/server/import/rate-limit'

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

// Teto de tamanho do corpo baixado (defesa contra páginas gigantescas / abuso de memória). O JSON-LD
// de uma receita vive no <head>/início do <body>; 2 MiB cobre páginas reais com folga.
const MAX_HTML_BYTES = 2 * 1024 * 1024

// User-Agent explícito: alguns sites bloqueiam clientes sem UA. Identifica o bot honestamente.
const IMPORT_USER_AGENT = 'RefogandoBot/1.0 (+recipe-import)'

// Product token do nosso UA (a parte antes da `/`) — é por ele que um grupo do robots.txt nos endereça
// (RFC 9309 §2.2.1, case-insensitive). NÃO confundir com a string completa do `IMPORT_USER_AGENT`.
const ROBOTS_UA_TOKEN = 'RefogandoBot'
// robots.txt é pequeno; cap defensivo bem abaixo do HTML. Timeout curto — robots indisponível ⇒ permitido.
const MAX_ROBOTS_BYTES = 512 * 1024
const ROBOTS_TIMEOUT_MS = 3000

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
    if (!(await this.checkRobotsAllowed(url))) {
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

  /**
   * `true` se o robots.txt da MESMA origem da `url` permite buscarmos esse path (RFC 9309, avaliado
   * pelo domínio puro `isPathAllowedByRobots`). FAIL-OPEN: qualquer falha de obter/avaliar o robots.txt
   * — 4xx/404, 5xx, timeout, erro de rede, redirect — devolve `true` (permitido). Defesas: `redirect:
   * 'manual'` (um 3xx do /robots.txt NÃO leva o fetch a um host arbitrário — fecha o flanco de SSRF que
   * a allowlist da rota validou só p/ o host ALVO), timeout curto e corpo capado.
   */
  private async checkRobotsAllowed(url: string): Promise<boolean> {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      return true // URL inválida cai no fetch_failed adiante; aqui não bloqueamos por robots
    }
    // UM timer cobre fetch + leitura do corpo (signal aborta ambos); a avaliação roda DENTRO do try
    // (o matcher é linear e total, mas o try honra literalmente o fail-open-on-evaluate do docstring).
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS)
    try {
      const res = await fetch(`${target.origin}/robots.txt`, {
        headers: { 'user-agent': IMPORT_USER_AGENT, accept: 'text/plain' },
        redirect: 'manual', // NÃO perseguir 3xx p/ outro host (SSRF) — trata como indisponível
        signal: controller.signal,
      })
      if (!res.ok) return true // 404/4xx (sem regras), 5xx, ou 3xx opaco (manual) ⇒ permitido
      // Dica de tamanho: um robots.txt absurdo é tratado como indisponível (não bufferiza GB na memória).
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_ROBOTS_BYTES) return true
      const raw = await res.text()
      const robotsTxt = raw.length > MAX_ROBOTS_BYTES ? raw.slice(0, MAX_ROBOTS_BYTES) : raw
      return isPathAllowedByRobots(robotsTxt, ROBOTS_UA_TOKEN, target.pathname + target.search)
    } catch {
      return true // timeout/abort/erro de rede/avaliação ⇒ permitido (FAIL-OPEN)
    } finally {
      clearTimeout(timer)
    }
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
  ingredientes: [
    { rawText: '3 cenouras médias', quantidade: '3', unidade: 'unidade' },
    { rawText: '4 ovos', quantidade: '4', unidade: null },
    { rawText: '2 xícaras de açúcar', quantidade: '2', unidade: 'xicara' },
    { rawText: '2 xícaras de farinha de trigo', quantidade: '2', unidade: 'xicara' },
  ],
  sourceName: 'Cozinha da Vovó',
}
