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

/** Falha TRATADA da importação — nenhuma vira 500; a rota as mapeia para 422 (não importou). */
export type ImportFailureReason = 'no_jsonld' | 'unsupported_locale' | 'fetch_failed'

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

/**
 * Impl REAL — fetch da URL + parse PURO do domínio. A ÚNICA I/O é o `fetch`; toda a extração
 * (JSON-LD, locale, ingredientes) é do domínio puro `parseImportedRecipe`. QUALQUER erro de rede/
 * parse/HTTP vira uma falha TRATADA (`fetch_failed`) — NUNCA lança nem vaza stack (espelha o
 * contrato dos outros seams reais). NÃO é exercitada por teste (Fake); só roda ao vivo.
 */
export class RealRecipeImporter implements RecipeImporter {
  async import(url: string): Promise<ImportResult> {
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
  ingredientes: [
    { rawText: '3 cenouras médias', quantidade: '3', unidade: 'unidade' },
    { rawText: '4 ovos', quantidade: '4', unidade: null },
    { rawText: '2 xícaras de açúcar', quantidade: '2', unidade: 'xicara' },
    { rawText: '2 xícaras de farinha de trigo', quantidade: '2', unidade: 'xicara' },
  ],
  sourceName: 'Cozinha da Vovó',
}
