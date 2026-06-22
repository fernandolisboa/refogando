/**
 * Parser PURO de schema.org/Recipe (JSON-LD) → forma estruturada da Receita importada (#165, ADR-0019).
 *
 * Camada de DOMÍNIO, PURO: sem rede, sem DB, sem SDK. Recebe o HTML CRU de uma página (a busca da
 * rede vive no seam `RecipeImporter`, server-side) e extrai os blocos `<script type="application/
 * ld+json">`, achando o primeiro objeto cujo `@type` é (ou contém) `Recipe`. Sem JSON-LD confiável
 * → falha tratada (`no_jsonld`), nunca importa lixo.
 *
 * Postura (ADR-0019): a cópia usa o DADO ESTRUTURADO que o site JÁ publica (o que ele expõe ao
 * Google); scraping arbitrário de HTML é frágil e fica FORA. Daí: só JSON-LD.
 *
 * Idioma: só pt-BR/en-US (ADR-0001). Detecta o `inLanguage` do JSON-LD (ou o `lang`/`xml:lang` da
 * tag <html>); fora de PT/EN → `unsupported_locale` (não importa). O locale é canonizado por
 * `canonicalLocale` (mesma fonte única de #4/#23) e mapeado de um `pt`/`en` cru pro nosso pt-BR/en-US.
 *
 * `quantidade`/`unidade` são BEST-EFFORT: schema.org não obriga forma estruturada de ingrediente
 * (recipeIngredient é texto livre tipo "2 xícaras de farinha"), então mantemos o texto CRU em
 * `rawText` (sempre) e SÓ preenchemos quantidade/unidade quando um parse simples (número líder +
 * unidade reconhecida) casa — espelhando `recipe_ingredient` (rawText sempre; qty/unidade nullable).
 */

import { canonicalLocale, type Locale } from '@/i18n/locale'
import { UNIDADES, type Unidade } from '@/domain/vocabulary'

/** Item de ingrediente importado — 1:1 com `recipe_ingredient` (rawText sempre; qty/unidade best-effort). */
export type ImportedIngredient = {
  rawText: string
  quantidade: string | null // numeric(10,3) trafega como string — NUNCA number
  unidade: Unidade | null
}

/** Forma estruturada da Receita importada — espelha o miolo de `ReceitaGenT` que a persistência consome. */
export type ImportedRecipe = {
  titulo: string
  descricao: string | null
  passos: string[]
  notas: string | null
  originalLocale: Locale
  ingredientes: ImportedIngredient[]
  /** Nome legível da fonte (publisher/site) para ATRIBUIÇÃO — nunca "por <Usuário>" (ADR-0019). */
  sourceName: string | null
}

/** Resultado discriminado do parse. `no_jsonld` e `unsupported_locale` são falhas TRATADAS (não importa). */
export type ParseResult =
  | { ok: true; recipe: ImportedRecipe }
  | { ok: false; reason: 'no_jsonld' | 'unsupported_locale' }

// ── Helpers puros ────────────────────────────────────────────────────────────────

/** `@type` pode ser string ('Recipe') ou array (['Recipe','Thing']); casa se 'Recipe' aparece. */
function isRecipeType(type: unknown): boolean {
  if (typeof type === 'string') return type === 'Recipe'
  if (Array.isArray(type)) return type.some((t) => t === 'Recipe')
  return false
}

/**
 * Acha o nó Recipe num JSON-LD parseado. JSON-LD vem em três formas comuns: o objeto direto,
 * um array no topo, ou um `@graph` (array de nós). Varre todas e devolve o 1º `@type` Recipe.
 */
function findRecipeNode(data: unknown): Record<string, unknown> | null {
  const visit = (node: unknown): Record<string, unknown> | null => {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item)
        if (found) return found
      }
      return null
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      if (isRecipeType(obj['@type'])) return obj
      if (Array.isArray(obj['@graph'])) return visit(obj['@graph'])
    }
    return null
  }
  return visit(data)
}

/** Extrai os corpos JSON dos blocos `<script type="application/ld+json">` do HTML. PURO (regex, sem DOM). */
function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = []
  // `[^>]*` tolera atributos extras/ordem; flags `gis` p/ multi-linha e case-insensitive.
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const body = m[1].trim()
    if (body) blocks.push(body)
  }
  return blocks
}

/** Normaliza um campo schema.org que pode ser string OU objeto `{ '@value': ... }` para texto limpo. */
function asText(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length > 0 ? t : null
  }
  if (v && typeof v === 'object') {
    const val = (v as Record<string, unknown>)['@value']
    if (typeof val === 'string') return asText(val)
    const name = (v as Record<string, unknown>)['name']
    if (typeof name === 'string') return asText(name)
  }
  return null
}

/**
 * Passos de preparo (`recipeInstructions`): schema.org permite string única, array de strings, array
 * de `HowToStep` ({ text }) ou `HowToSection` ({ itemListElement: HowToStep[] }). Achata tudo para
 * string[] (texto de cada passo), descartando vazios. Uma string única vira UM passo.
 */
function parseInstructions(v: unknown): string[] {
  const out: string[] = []
  const push = (node: unknown): void => {
    if (typeof node === 'string') {
      const t = node.trim()
      if (t) out.push(t)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) push(item)
      return
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      // HowToSection → desce nos itemListElement; HowToStep → usa text/name.
      if (Array.isArray(obj['itemListElement'])) {
        push(obj['itemListElement'])
        return
      }
      const text = asText(obj['text']) ?? asText(obj['name'])
      if (text) out.push(text)
    }
  }
  push(v)
  return out
}

// Unidades reconhecíveis no texto cru de ingrediente → nosso enum `Unidade`. Best-effort, conservador:
// só aliases comuns PT/EN sem ambiguidade. O que não casar fica como rawText puro (qty/unidade null).
const UNIT_ALIASES: Record<string, Unidade> = {
  // métricas (PT/EN compartilham)
  g: 'g', grama: 'g', gramas: 'g', gram: 'g', grams: 'g',
  kg: 'kg', quilo: 'kg', quilos: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', mililitro: 'ml', mililitros: 'ml',
  l: 'l', litro: 'l', litros: 'l', liter: 'l', liters: 'l',
  // colheres
  'colher de sopa': 'colher_de_sopa', 'colheres de sopa': 'colher_de_sopa',
  tablespoon: 'colher_de_sopa', tablespoons: 'colher_de_sopa', tbsp: 'colher_de_sopa',
  'colher de cha': 'colher_de_cha', 'colheres de cha': 'colher_de_cha',
  'colher de chá': 'colher_de_cha', 'colheres de chá': 'colher_de_cha',
  teaspoon: 'colher_de_cha', teaspoons: 'colher_de_cha', tsp: 'colher_de_cha',
  // volume
  xicara: 'xicara', xicaras: 'xicara', xícara: 'xicara', xícaras: 'xicara',
  cup: 'xicara', cups: 'xicara',
  // contáveis
  unidade: 'unidade', unidades: 'unidade', unit: 'unidade', units: 'unidade',
  dente: 'dente', dentes: 'dente', clove: 'dente', cloves: 'dente',
  fatia: 'fatia', fatias: 'fatia', slice: 'fatia', slices: 'fatia',
  pitada: 'pitada', pitadas: 'pitada', pinch: 'pitada', pinches: 'pitada',
}

/**
 * Best-effort: de um texto cru de ingrediente, extrai (quantidade, unidade) SÓ quando há um número
 * líder seguido de uma unidade reconhecida. Caso contrário devolve ambos null (o rawText carrega tudo).
 * Aceita inteiro/decimal (vírgula OU ponto) e a fração unicode comum ½. NÃO tenta NLP — conservador.
 */
function parseQuantityUnit(raw: string): { quantidade: string | null; unidade: Unidade | null } {
  const text = raw.trim().toLowerCase().replace(/½/g, '0.5')
  // número líder: 1+ dígitos, opcional decimal com . ou ,
  const m = /^(\d+(?:[.,]\d+)?)\s+(.+)$/.exec(text)
  if (!m) return { quantidade: null, unidade: null }
  const qtyRaw = m[1].replace(',', '.')
  const qty = Number(qtyRaw)
  // casa com numeric(10,3): até 7 inteiros; descarta o que estoura (rawText preserva o original).
  if (!Number.isFinite(qty) || qtyRaw.replace(/\..*$/, '').length > 7) {
    return { quantidade: null, unidade: null }
  }
  const rest = m[2]
  // O número líder JÁ é uma quantidade útil (ex.: "3 ovos" → 3 / null). A unidade é um EXTRA best-
  // effort: tenta casar o alias mais LONGO primeiro (ex.: "colher de sopa" antes de "colher"),
  // pegando o prefixo de palavras do `rest`, do mais específico (3 palavras) ao token único.
  const words = rest.split(/\s+/)
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const candidate = words.slice(0, n).join(' ')
    const unit = UNIT_ALIASES[candidate]
    if (unit) return { quantidade: qtyRaw, unidade: unit }
  }
  // Número sem unidade reconhecida: mantém a quantidade, unidade null (o rawText preserva o resto).
  return { quantidade: qtyRaw, unidade: null }
}

/** Ingredientes (`recipeIngredient`): array de strings (forma usual). rawText sempre; qty/unidade best-effort. */
function parseIngredients(v: unknown): ImportedIngredient[] {
  const items = Array.isArray(v) ? v : v != null ? [v] : []
  const out: ImportedIngredient[] = []
  for (const item of items) {
    const raw = asText(item)
    if (!raw) continue
    const { quantidade, unidade } = parseQuantityUnit(raw)
    out.push({ rawText: raw, quantidade, unidade })
  }
  return out
}

/**
 * Detecta o locale de origem. Prioridade: `inLanguage` do nó Recipe → `lang`/`xml:lang` da <html>.
 * Mapeia um tag cru (pt, pt-BR, en, en-US, EN_US…) pro nosso pt-BR/en-US via canonicalLocale (que já
 * é case-insensitive) e, como fallback, casa o idioma base (pt→pt-BR, en→en-US). `null` se nada PT/EN.
 */
function detectLocale(recipeNode: Record<string, unknown>, html: string): Locale | null {
  const fromNode = asText(recipeNode['inLanguage'])
  const fromHtml = /<html[^>]*\blang=["']([^"']+)["']/i.exec(html)?.[1] ?? null
  const candidates = [fromNode, fromHtml].filter((x): x is string => x != null)
  for (const cand of candidates) {
    const normalized = cand.trim().replace(/_/g, '-')
    const canon = canonicalLocale(normalized)
    if (canon) return canon
    const base = normalized.split('-')[0].toLowerCase()
    if (base === 'pt') return 'pt-BR'
    if (base === 'en') return 'en-US'
  }
  return null
}

/**
 * Parser PRINCIPAL. Recebe o HTML cru + a URL de origem (só p/ derivar `sourceName` quando o JSON-LD
 * não traz publisher). Falhas TRATADAS: nenhum JSON-LD/Recipe → `no_jsonld`; locale fora de PT/EN →
 * `unsupported_locale`. Sucesso → `ImportedRecipe` pronto p/ a persistência.
 */
export function parseImportedRecipe(html: string, sourceUrl: string): ParseResult {
  let recipeNode: Record<string, unknown> | null = null
  for (const block of extractJsonLdBlocks(html)) {
    let data: unknown
    try {
      data = JSON.parse(block)
    } catch {
      continue // bloco malformado: ignora, tenta o próximo
    }
    const found = findRecipeNode(data)
    if (found) {
      recipeNode = found
      break
    }
  }
  if (!recipeNode) return { ok: false, reason: 'no_jsonld' }

  // Título é o campo MÍNIMO de uma Receita (recipe_translation.titulo é NOT NULL). Sem `name` legível,
  // não há Receita confiável → tratamos como JSON-LD não-confiável (não importa).
  const titulo = asText(recipeNode['name'])
  if (!titulo) return { ok: false, reason: 'no_jsonld' }

  const originalLocale = detectLocale(recipeNode, html)
  if (!originalLocale) return { ok: false, reason: 'unsupported_locale' }

  // sourceName: publisher.name → author.name → host da URL. Atribuição à FONTE, nunca ao Usuário.
  const sourceName =
    asText((recipeNode['publisher'] as Record<string, unknown> | undefined)?.['name']) ??
    asText(recipeNode['publisher']) ??
    asText((recipeNode['author'] as Record<string, unknown> | undefined)?.['name']) ??
    asText(recipeNode['author']) ??
    hostOf(sourceUrl)

  return {
    ok: true,
    recipe: {
      titulo,
      descricao: asText(recipeNode['description']),
      passos: parseInstructions(recipeNode['recipeInstructions']),
      notas: null,
      originalLocale,
      ingredientes: parseIngredients(recipeNode['recipeIngredient']),
      sourceName,
    },
  }
}

/** Host legível da URL (p/ fallback de atribuição). Inválida → null. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

/** Re-export utilitário: o seam valida unidades contra o enum. (Mantém UNIDADES como fonte única.) */
export const KNOWN_UNITS: readonly Unidade[] = UNIDADES
