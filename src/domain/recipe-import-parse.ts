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
 * (recipeIngredient é texto livre tipo "2 xícaras de farinha"), então um parse simples (número líder
 * + unidade reconhecida) extrai a medida estruturada — e, quando casa, a TIRA da linha: `rawText`
 * fica com o NOME do ingrediente SEM a medida ("farinha"), espelhando o contrato de `recipe_ingredient`
 * (ADR-0012 Adendo 2026-06-30: medida estruturada é a fonte ÚNICA; `raw_text` é o nome). Determinístico
 * e best-effort — sem número líder reconhecível, `rawText` mantém a linha como veio (qty/unidade null).
 */

import { canonicalLocale, type Locale } from '@/i18n/locale'
import { UNIDADES, type Unidade } from '@/domain/vocabulary'
import { UNIT_ALIASES } from '@/domain/vocabulary-normalize'

/** Item de ingrediente importado — 1:1 com `recipe_ingredient`. `rawText` é o NOME (sem a medida,
 * best-effort); qty/unidade são a medida estruturada (fonte única). */
export type ImportedIngredient = {
  rawText: string
  quantidade: string | null // numeric(10,3) trafega como string — NUNCA number
  unidade: Unidade | null
}

/**
 * Forma estruturada da Receita importada — espelha o miolo de `ReceitaGenT` que a persistência consome.
 *
 * #272/ADR-0019 (emenda legal): a importação copia SÓ FATOS (título, ingredientes, passos). A
 * **camada expressiva protegida** — a FOTO e o **`description`/headnote** — NÃO é importada: NÃO há
 * campo `descricao` aqui (a importada nasce com headnote em branco; o dono escreve o seu) nem imagem
 * (a `persist-import` nunca cria `recipe_image`; o dono completa pela Galeria). `sourceName` é só
 * para a ATRIBUIÇÃO obrigatória à fonte, nunca um headnote.
 */
export type ImportedRecipe = {
  titulo: string
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

// Conectores líderes ("de"/"of"...) descartados entre a medida e o nome ("320 g DE arroz" → "arroz").
// Só o PRIMEIRO token é removido (o resto do nome é preservado verbatim, incl. um "da fazenda" no meio).
const LEADING_CONNECTORS = new Set(['de', 'do', 'da', 'dos', 'das', 'of'])

/**
 * Best-effort: de um texto cru de ingrediente, extrai (quantidade, unidade) E o `nome` SEM a medida.
 * Quando há um número líder (e, opcionalmente, uma unidade reconhecida), TIRA-os da linha e devolve
 * o que sobra como nome ("320 g de arroz arbóreo" → qty 320 / g / "arroz arbóreo"; "3 ovos" → 3 /
 * null / "ovos"). Sem número líder reconhecível, qty/unidade ficam null e `nome` é a linha trimada
 * (best-effort: a medida segue embutida — caso de borda, ex. "sal a gosto"). Preserva o casing/
 * acentos do nome original (só normaliza para CASAR a unidade). Aceita inteiro/decimal (vírgula OU
 * ponto) e a fração unicode comum ½. NÃO tenta NLP — conservador.
 *
 * LIMITAÇÃO best-effort conhecida (import-only, ADR-0019 — importada é PRIVADA e editável): um nome
 * cujo PRIMEIRO token é um alias de unidade seguido de conector ("1 dente de leão" = dandelion) é
 * sobre-stripado p/ "leão" (o "dente" vira unidade). É o mesmo padrão do caso DESEJADO e comum
 * ("1 dente de alho" → "alho"; "1 fatia de pão" → "pão"), indistinguível sem léxico — aceito como
 * miss raro; o dono corrige a importada editando.
 */
function parseQuantityUnit(raw: string): {
  quantidade: string | null
  unidade: Unidade | null
  nome: string
} {
  const original = raw.trim()
  // número líder (incl. ½), seguido de espaço(s) e do resto. Casa no ORIGINAL (dígitos são
  // case-insensitive); o ½ é normalizado para "0.5" só no valor da quantidade.
  const m = /^(½|\d+(?:[.,]\d+)?)\s+(.+)$/.exec(original)
  if (!m) return { quantidade: null, unidade: null, nome: original }
  const qtyRaw = m[1] === '½' ? '0.5' : m[1].replace(',', '.')
  const qty = Number(qtyRaw)
  // casa com numeric(10,3): até 7 inteiros; descarta o que estoura (rawText preserva o original).
  if (!Number.isFinite(qty) || qtyRaw.replace(/\..*$/, '').length > 7) {
    return { quantidade: null, unidade: null, nome: original }
  }
  // resto COM o casing original; o lower só serve pra casar o alias de unidade.
  const restWords = m[2].trim().split(/\s+/)
  const restLower = restWords.map((w) => w.toLowerCase())
  // A unidade é um EXTRA best-effort: tenta casar o alias mais LONGO primeiro (ex.: "colher de sopa"
  // antes de "colher"), do prefixo mais específico (3 palavras) ao token único.
  let unidade: Unidade | null = null
  let consumed = 0
  for (let n = Math.min(3, restWords.length); n >= 1; n--) {
    const unit = UNIT_ALIASES[restLower.slice(0, n).join(' ')]
    if (unit) {
      unidade = unit
      consumed = n
      break
    }
  }
  // Nome = resto após a unidade, sem UM conector líder ("de"/"of"...). Preserva o casing original.
  let nameWords = restWords.slice(consumed)
  if (nameWords.length > 0 && LEADING_CONNECTORS.has(nameWords[0].toLowerCase())) {
    nameWords = nameWords.slice(1)
  }
  const nome = nameWords.join(' ').trim()
  // Se a unidade comeu tudo (ex.: "2 xícaras" sem ingrediente), mantém o resto cru como nome — não
  // deixa o item sem rótulo. Caso de borda raro (linha de ingrediente sem ingrediente).
  return { quantidade: qtyRaw, unidade, nome: nome !== '' ? nome : restWords.join(' ') }
}

/** Ingredientes (`recipeIngredient`): array de strings (forma usual). `rawText` = NOME (medida tirada,
 * best-effort); qty/unidade = a medida estruturada. */
function parseIngredients(v: unknown): ImportedIngredient[] {
  const items = Array.isArray(v) ? v : v != null ? [v] : []
  const out: ImportedIngredient[] = []
  for (const item of items) {
    const raw = asText(item)
    if (!raw) continue
    const { quantidade, unidade, nome } = parseQuantityUnit(raw)
    out.push({ rawText: nome, quantidade, unidade })
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
      // #272/ADR-0019: o `description`/headnote da fonte é camada protegida — NÃO copiamos (a
      // importada nasce com headnote em branco). Só fatos: título, passos, ingredientes.
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
