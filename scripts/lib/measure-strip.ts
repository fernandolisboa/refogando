/**
 * Helpers PUROS da migração one-off "tira a medida do `raw_text`" (ADR-0012/0009 Adendo
 * 2026-06-30, Direção B). A medida estruturada (`quantidade`/`unidade`) é a fonte ÚNICA e JÁ está
 * correta; a migração só REMOVE a medida do texto pra `raw_text` virar o NOME ("320 g de arroz
 * arbóreo" → "arroz arbóreo"). A remoção em si é uma tarefa de LINGUAGEM (um modelo barato a faz —
 * ver `scripts/strip-measure-from-raw-text.ts`), mas a DECISÃO de quais linhas tocar, a VALIDAÇÃO
 * da saída do modelo (anti-alucinação) e a VERIFICAÇÃO pós-migração são puras/determinísticas e
 * testáveis aqui. Nada de DB, nada de SDK.
 */

// Frases de "a gosto"/"q.b." (+ equivalentes EN) que indicam medida não-mensurável embutida no texto.
const TASTE_PHRASE_RE = /(a\s+gosto|à\s+gosto|q\.?\s?b\.?|quanto\s+baste|to\s+taste|as\s+needed)/i

// Conectores líderes ("de"/"of"…) que ligam a medida ao nome — REMOVÍVEIS, não palavras do nome.
const CONNECTORS = new Set(['de', 'do', 'da', 'dos', 'das', 'of'])

/** Normaliza p/ comparar palavras: minúsculas, sem acento, só alfanumérico ('Açúcar,' → 'acucar'). */
export function normalizeWord(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * `true` quando a linha NÃO tem medida estruturada a remover — então NÃO precisa do modelo: sem
 * `quantidade` E sem `unidade` não há medida pra tirar (o texto JÁ é o nome, mesmo que contenha um
 * número legítimo tipo "leite 2%"). Conservador: qualquer medida estruturada (quantidade OU unidade)
 * manda a linha pro modelo, que devolve o nome — se já estava limpo, devolve igual e o guard valida.
 */
export function looksAlreadyClean(quantidade: string | null, unidade: string | null): boolean {
  return (quantidade == null || quantidade === '') && (unidade == null || unidade === '')
}

/**
 * Heurística de VERIFICAÇÃO pós-migração: a linha AINDA aparenta ter medida embutida? Começa com
 * número/fração (medida-prefixo provável) OU é `a_gosto`/`q_b` com a frase ainda no texto (sufixo).
 * Conservadora: um nome legítimo que comece com número ("7 grãos") é falso-positivo — o script lista
 * os remanescentes pra inspeção manual, não os trata como falha automática.
 */
export function stillEmbedsMeasure(rawText: string | null, unidade: string | null): boolean {
  const t = (rawText ?? '').trim()
  if (t === '') return false
  if (/^(½|\d)/.test(t)) return true
  if ((unidade === 'a_gosto' || unidade === 'q_b') && TASTE_PHRASE_RE.test(t)) return true
  return false
}

/**
 * Variante ESTRITA da verificação pós-reparo, ALINHADA com `detectRepair`: usa o MESMO reconhecedor
 * abrangente de quantidade-líder (`beginsWithQuantityToken` — todas as formas: dígito/fração-barra/
 * glifo/número escrito meia|três quartos…, não só o prefixo estreito `^(½|\d)` de `stillEmbedsMeasure`)
 * OU a frase a-gosto/q.b. quando a unidade é a_gosto/q_b. A varredura PÓS-RODADA usa esta pra não relatar
 * "0 restantes" falso quando ainda há um líder ESCRITO embutido que o prefixo estreito não pegaria.
 */
export function stillEmbedsMeasureStrict(rawText: string | null, unidade: string | null): boolean {
  const t = (rawText ?? '').trim()
  if (t === '') return false
  if (beginsWithQuantityToken(t)) return true
  if ((unidade === 'a_gosto' || unidade === 'q_b') && TASTE_PHRASE_RE.test(t)) return true
  return false
}

/**
 * Tira do FIM do texto o "ruído" que NÃO faz parte do núcleo do nome e que o modelo pode legitimamente
 * largar: parêntese final ("(cerca de 1,2 kg)"), frase de propósito ("para servir/untar/decorar/…") e
 * a frase não-mensurável ("a gosto"/"q.b."). Usado só pra achar a palavra-NÚCLEO do nome (o head).
 */
export function stripTrailingNoise(s: string): string {
  let t = s.trim()
  t = t.replace(/\s*\([^)]*\)\s*$/, '').trim() // parêntese final
  t = t.replace(/\s+para\s+\S.*$/i, '').trim() // "… para servir/untar/…"
  t = t.replace(/[\s,]*(a\s+gosto|à\s+gosto|q\.?\s?b\.?|quanto\s+baste|to\s+taste|as\s+needed)\s*$/i, '').trim()
  return t
}

/** A última palavra de CONTEÚDO do nome (o "head"/núcleo) — âncora confiável: a medida vem ANTES
 * (prefixo: "320 g de …") e o ruído de propósito vem DEPOIS (tirado por `stripTrailingNoise`). */
function lastContentWord(s: string): string | null {
  const words = stripTrailingNoise(s).split(/\s+/).map(normalizeWord).filter((w) => w !== '')
  return words.length > 0 ? words[words.length - 1] : null
}

export type StripValidation = { ok: true } | { ok: false; reason: string }

/**
 * GUARD anti-alucinação da saída do modelo: o `nome` proposto tem de ser uma REDUÇÃO do original que
 * só TIRA a MEDIDA — não inventa, não traduz, e (crucial) NÃO DROPA o NÚCLEO do nome. Rejeita se:
 *  - vazio (após trim);
 *  - mais COMPRIDO que o original (strip só encurta);
 *  - introduz um TOKEN novo (palavra ausente no original, ignorando acento/caixa) — pega tradução/rephrase;
 *  - introduz um DÍGITO ausente no original (a medida SAI, não entra);
 *  - SOME com a palavra-NÚCLEO do nome (a última palavra de conteúdo do original, fora o ruído de
 *    propósito) — pega a omissão corruptora ("100 g de queijo parmesão ralado" → "parmesão" REJEITADO,
 *    "300 g de azeite de oliva extra virgem" → "azeite" REJEITADO), SEM barrar o strip benéfico de
 *    palavras de porção/recipiente ("4 folhas de alga nori" → "alga nori" PASSA, núcleo "nori" intacto).
 * Linha rejeitada mantém o `raw_text` original e é SINALIZADA pro dono revisar à mão (nunca corrompe).
 */
export function validateStrippedName(original: string, candidate: string): StripValidation {
  const orig = original.trim()
  const cand = candidate.trim()
  if (cand === '') return { ok: false, reason: 'nome vazio' }
  if (cand.length > orig.length) return { ok: false, reason: 'nome mais comprido que o original' }

  const candTokens = cand.split(/\s+/).map(normalizeWord).filter((w) => w !== '')
  const candSet = new Set(candTokens)

  const origTokens = new Set(orig.split(/\s+/).map(normalizeWord).filter((w) => w !== ''))
  for (const n of candTokens) {
    if (!origTokens.has(n)) return { ok: false, reason: `token novo "${n}" (não estava no original)` }
  }

  // O NÚCLEO do nome (última palavra de conteúdo) TEM de sobreviver — pega a omissão corruptora sem
  // barrar o strip de porção/propósito (que mexe só no prefixo/sufixo de ruído, não no head).
  const head = lastContentWord(orig)
  if (head != null && !candSet.has(head)) {
    return { ok: false, reason: `palavra-núcleo do nome sumiu "${head}"` }
  }

  const origDigits = new Set(orig.match(/\d/g) ?? [])
  for (const d of cand.match(/\d/g) ?? []) {
    if (!origDigits.has(d)) return { ok: false, reason: `dígito novo "${d}"` }
  }
  return { ok: true }
}

/** Tira UM conector líder ("de"/"of"…) do candidato — limpa um resíduo tipo "de farinha" → "farinha".
 * Só o PRIMEIRO token, e só se for conector; preserva "queijo de Minas" (conector no meio fica). */
export function stripLeadingConnector(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length > 1 && CONNECTORS.has(normalizeWord(words[0]))) return words.slice(1).join(' ')
  return name.trim()
}

// ╔══════════════════════════════════════════════════════════════════════════════════════════╗
// ║ REPARAÇÃO DETERMINÍSTICA (Track B) — refaz o strip SEM modelo e classifica o que consertar. ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════╝
//
// A migração-IA (`strip-measure-from-raw-text.ts`) deixou DOIS resíduos: (a) OVER-STRIP — o modelo
// comeu uma palavra de PORÇÃO genuína ("4 folhas de alga nori" → "alga nori", perdendo "folhas",
// que o contrato Direção B manda MANTER no nome); (b) STILL-EMBEDS — linhas SINALIZADAS pelo guard
// (mantidas como vieram) e vazamentos pós-migração que AINDA carregam a medida no texto. Estes
// helpers refazem o strip de forma 100% determinística (cruzando o texto com a medida estruturada
// conhecida) pra um script de REPARAÇÃO restaurar o original (over-strip) ou limpar o resíduo
// (still-embeds). A FRAÇÃO é o bloqueio crítico: "1/2 xícara de óleo" + unidade=xicara reduz a "óleo"
// — IGUAL ao atual ⇒ classificado 'none' ⇒ NÃO tocado (nunca corrompido).

// Glifos de fração vulgar Unicode (½ ⅓ ⅔ ¼ ¾ …) que aparecem como quantidade-líder na prosa.
const FRACTION_GLYPHS = '½⅓⅔¼¾⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚'

// Reconhecedor da QUANTIDADE-LÍDER em prosa, em TODAS as formas (ordem = mais específica primeiro;
// a alternância do JS é left-to-right, então a mista "1 e 1/2" precede o inteiro solto "1"). O
// lookahead `(?=\s|$|[,;.])` exige fronteira após a quantidade — evita casar "um" dentro de "umbigo"
// ou "2" em "2%". O ramo glifo aceita inteiro grudado ("2½"); o ramo escrito cobre meia/meio + as
// frações escritas comuns (três quartos / dois terços / um quarto) e os inteiros um|uma|dois|duas|três.
const LEADING_QTY_RE = new RegExp(
  '^(?:' +
    `\\d+(?:[.,]\\d+)?\\s+e\\s+(?:meia|meio|\\d+\\/\\d+|[${FRACTION_GLYPHS}])` + // mista: "1 e 1/2", "1 e meia"
    '|tr[eê]s\\s+quartos|dois\\s+ter[çc]os|um\\s+quarto|um\\s+ter[çc]o' + // frações escritas (multi-palavra)
    '|\\d+\\/\\d+' + // fração barra "1/2", "3/4"
    `|\\d*[${FRACTION_GLYPHS}]` + // glifo (com inteiro grudado opcional): "½", "2½"
    '|\\d+(?:[.,]\\d+)?' + // decimal/inteiro: "1", "1,5", "320"
    '|meia|meio|uma|duas|dois|tr[eê]s|um' + // números/frações escritos (1 palavra)
    ')(?=\\s|$|[,;.])',
  'i',
)

// Valor numérico de cada glifo de fração vulgar — pra extrair o VALOR do token-líder (corroboração).
const FRACTION_GLYPH_VALUE: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6,
}

// Valor numérico dos números/frações ESCRITOS (chave normalizada: minúscula, sem acento, espaço único).
const WRITTEN_QTY_VALUE: Record<string, number> = {
  meia: 0.5, meio: 0.5, um: 1, uma: 1, dois: 2, duas: 2, tres: 3,
  'um quarto': 0.25, 'tres quartos': 0.75, 'dois tercos': 2 / 3, 'um terco': 1 / 3,
}

/**
 * VALOR numérico de um token de quantidade-líder em prosa (o `m[0]` casado por `LEADING_QTY_RE`), em
 * qualquer forma — inteiro/decimal (vírgula→ponto), fração-barra "1/2", glifo "½"/"2½", mista "1 e 1/2"/
 * "2 e meia", e número/fração ESCRITO (meia/um/dois/três/um quarto/três quartos/dois terços). `null`
 * quando não dá pra extrair um número. Usado pela CORROBORAÇÃO de `detectRepair` (o líder só conta como
 * medida embutida quando IGUALA a `quantidade` estruturada).
 */
function parseLeadingQtyValue(token: string): number | null {
  const t = token.trim()
  if (t === '') return null

  // mista: "<inteiro> e <fração>" ("1 e 1/2", "2 e meia", "1 e ½")
  const mixed = /^(\d+(?:[.,]\d+)?)\s+e\s+(.+)$/i.exec(t)
  if (mixed) {
    const whole = Number(mixed[1].replace(',', '.'))
    const frac = parseLeadingQtyValue(mixed[2])
    return Number.isFinite(whole) && frac != null ? whole + frac : null
  }

  // fração-barra: "1/2", "3/4"
  const bar = /^(\d+)\/(\d+)$/.exec(t)
  if (bar) {
    const den = Number(bar[2])
    return den !== 0 ? Number(bar[1]) / den : null
  }

  // glifo (com inteiro grudado opcional): "½", "2½"
  const glyph = new RegExp(`^(\\d*)([${FRACTION_GLYPHS}])$`).exec(t)
  if (glyph) {
    const whole = glyph[1] === '' ? 0 : Number(glyph[1])
    const g = FRACTION_GLYPH_VALUE[glyph[2]]
    return g != null && Number.isFinite(whole) ? whole + g : null
  }

  // decimal/inteiro: "1", "1,5", "320"
  if (/^\d+(?:[.,]\d+)?$/.test(t)) {
    const n = Number(t.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }

  // escrito (1 ou multi-palavra): normaliza p/ a chave de WRITTEN_QTY_VALUE.
  const key = t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return key in WRITTEN_QTY_VALUE ? WRITTEN_QTY_VALUE[key] : null
}

/**
 * Reconhece e REMOVE a quantidade-líder em prosa (qualquer forma) do começo do texto. Devolve o RESTO
 * (sem a quantidade, trim de separadores líderes), `hadQuantity` e o `value` numérico do líder casado
 * (ou `null` se não-parseável). NÃO toca alias de unidade nem conector — só a quantidade numérica/escrita.
 * Base de `deterministicStrip`, `beginsWithQuantityToken` e da corroboração de `detectRepair`.
 */
export function stripLeadingQuantity(text: string): { rest: string; hadQuantity: boolean; value: number | null } {
  const t = (text ?? '').trim()
  const m = LEADING_QTY_RE.exec(t)
  if (!m) return { rest: t, hadQuantity: false, value: null }
  const rest = t.slice(m[0].length).replace(/^[\s,;.]+/, '')
  return { rest, hadQuantity: true, value: parseLeadingQtyValue(m[0]) }
}

// Alias de unidade do ENUM (forma normalizada por palavra → valor do enum) — SELF-CONTAINED (não
// importa de recipe-import-parse.ts; é fronteira do Track A. Drift é aceitável p/ um script one-off).
// Só as unidades NÃO-CONTÁVEIS entram (são as que viram alias-de-medida no texto); 'unidade' contável
// e 'a_gosto'/'q_b' não têm alias removível por aqui. Chaves já NORMALIZADAS (normalizeWord por palavra,
// juntadas por espaço): "colher de chá" → "colher de cha"; "xícara" → "xicara".
const ENUM_UNIT_ALIASES: Record<string, string> = {
  g: 'g', grama: 'g', gramas: 'g', gram: 'g', grams: 'g',
  kg: 'kg', quilo: 'kg', quilos: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', mililitro: 'ml', mililitros: 'ml',
  l: 'l', litro: 'l', litros: 'l', liter: 'l', liters: 'l',
  'colher de sopa': 'colher_de_sopa', 'colheres de sopa': 'colher_de_sopa',
  tablespoon: 'colher_de_sopa', tablespoons: 'colher_de_sopa', tbsp: 'colher_de_sopa',
  'colher de cha': 'colher_de_cha', 'colheres de cha': 'colher_de_cha',
  teaspoon: 'colher_de_cha', teaspoons: 'colher_de_cha', tsp: 'colher_de_cha',
  xicara: 'xicara', xicaras: 'xicara', cup: 'xicara', cups: 'xicara',
  dente: 'dente', dentes: 'dente', clove: 'dente', cloves: 'dente',
  fatia: 'fatia', fatias: 'fatia', slice: 'fatia', slices: 'fatia',
  pitada: 'pitada', pitadas: 'pitada', pinch: 'pitada', pinches: 'pitada',
}

// Unidades NÃO-CONTÁVEIS: as que carregam alias-de-medida removível do texto ("g", "xícara", "dente"…).
// 'unidade' (contável) e 'a_gosto'/'q_b' (não-mensuráveis) ficam de fora — não têm alias a tirar.
const NON_COUNTABLE = new Set([
  'g', 'kg', 'ml', 'l', 'colher_de_sopa', 'colher_de_cha', 'xicara', 'dente', 'fatia', 'pitada',
])

/** `true` se a unidade é NÃO-CONTÁVEL (carrega alias-de-medida removível: g, xícara, dente, colher…).
 * 'unidade' (contável), 'a_gosto'/'q_b' e null ⇒ false. Usado pra escopar a sanidade "suspected-
 * fraction": só uma linha de unidade NÃO-contável com fração-líder reintroduziria o alias se fosse
 * mal-classificada como over-strip — a tripwire que deve ficar em 0. */
export function isNonCountableUnit(unidade: string | null): boolean {
  return unidade != null && NON_COUNTABLE.has(unidade)
}

// Conjunto de TODAS as palavras (normalizadas) que aparecem em algum alias — pra detectar resíduo de
// medida nas "palavras largadas" (ver detectRepair): se o modelo só largou conector/alias, ele estava
// CERTO e o atual é mais limpo (none); só restauramos quando uma palavra GENUÍNA (porção) foi perdida.
const ALIAS_WORD_SET = new Set(
  Object.keys(ENUM_UNIT_ALIASES).flatMap((k) => k.split(' ')),
)

// Frase não-mensurável ("a gosto"/"q.b."/…) no FIM — a "medida" de a_gosto/q_b. Tirada de `raw_text`
// só quando a unidade estruturada é a_gosto/q_b (aí a frase É a medida embutida).
const TRAILING_TASTE_RE = /[\s,]*(a\s+gosto|à\s+gosto|q\.?\s?b\.?|quanto\s+baste|to\s+taste|as\s+needed)\s*$/i

/** Tira UM conector líder ("de"/"of"…) se houver MAIS de uma palavra OU se sobra texto não-conector. */
function dropOneLeadingConnector(text: string): string {
  const words = text.trim().split(/\s+/)
  if (words.length > 1 && CONNECTORS.has(normalizeWord(words[0]))) return words.slice(1).join(' ')
  return text.trim()
}

/** Tira o alias de unidade líder (1–3 palavras, o mais LONGO primeiro) que mapeia pra ESTA unidade. */
function dropLeadingUnitAlias(text: string, unidade: string): string {
  const words = text.trim().split(/\s+/)
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const key = words.slice(0, n).map(normalizeWord).filter((w) => w !== '').join(' ')
    if (ENUM_UNIT_ALIASES[key] === unidade) return words.slice(n).join(' ')
  }
  return text.trim()
}

/**
 * Refaz o strip da MEDIDA do texto de forma 100% determinística, cruzando-o com a `unidade`
 * estruturada conhecida: tira a quantidade-líder → UM conector → (se a unidade é não-contável) o
 * alias da unidade → UM conector. Para a_gosto/q_b, tira a frase não-mensurável do FIM. MANTÉM todo o
 * resto (palavras de porção como "folhas"/"ramo"/"talo" SOBREVIVEM quando a unidade é contável/null).
 * É a FONTE da verdade do nome esperado — `detectRepair` compara o atual contra isto.
 */
export function deterministicStrip(before: string, unidade: string | null): string {
  let t = stripLeadingQuantity(before).rest
  t = dropOneLeadingConnector(t) // conector ANTES da unidade ("três quartos DE xícara …")
  if (unidade != null && NON_COUNTABLE.has(unidade)) {
    t = dropLeadingUnitAlias(t, unidade)
    t = dropOneLeadingConnector(t) // conector DEPOIS da unidade ("xícara DE óleo")
  }
  if (unidade === 'a_gosto' || unidade === 'q_b') {
    t = t.replace(TRAILING_TASTE_RE, '').trim()
  }
  return t.trim()
}

/** Palavras (normalizadas) de `s`, sem vazios. */
function normWords(s: string): string[] {
  return (s ?? '')
    .trim()
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w !== '')
}

/** `inner` é um SUFIXO-por-palavras ESTRITO de `outer` (mesmas palavras finais, mais curto)? */
function isWordSuffix(inner: string, outer: string): boolean {
  const a = normWords(inner)
  const b = normWords(outer)
  if (a.length === 0 || a.length >= b.length) return false
  const start = b.length - a.length
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[start + i]) return false
  }
  return true
}

/** Uma palavra largada é só RESÍDUO de medida (conector/alias/quantidade) — não uma palavra genuína? */
function isMeasureResidueWord(normWord: string): boolean {
  if (CONNECTORS.has(normWord)) return true
  if (ALIAS_WORD_SET.has(normWord)) return true
  if (beginsWithQuantityToken(normWord)) return true
  return false
}

export type RepairKind = 'still-embeds' | 'over-strip' | 'none'

/**
 * Classifica UMA linha contra (ledger `before` | `raw_text` atual | `quantidade`/`unidade` ao vivo) e
 * devolve o nome RESTAURADO determinístico:
 *  - STILL-EMBEDS (a-gosto): unidade a_gosto/q_b com a frase não-mensurável ainda no texto → limpa o atual.
 *  - STILL-EMBEDS (número CORROBORADO): o número-líder do texto IGUALA a `quantidade` estruturada ⇒ a
 *    medida vazou no nome → limpa o atual (`deterministicStrip(current)`). Pega as SINALIZADAS + vazamentos.
 *  - OVER-STRIP: comparado ao que o strip determinístico faria do ORIGINAL, o atual perdeu palavras-
 *    líderes GENUÍNAS (porção) — é um sufixo estrito do determinístico e o que foi largado NÃO é só
 *    conector/alias/quantidade → restaura o determinístico (que MANTÉM a porção).
 *  - NONE: já casa o strip determinístico (inclui as frações "1/2 xícara de óleo"→"óleo": NÃO tocar) —
 *    ou é uma reescrita que não dá pra reparar com segurança (deixa pro humano via outro caminho).
 *
 * DATA-SAFETY (FIX 1): o número-líder só é tratado como medida embutida quando CORROBORA a medida
 * estruturada (líder == `quantidade`). Um nome que legitimamente COMEÇA com número mas SEM medida que o
 * iguale — "1 cm de gengibre ralado"/null/null, "7 grãos"/null/null, "5 especiarias"/qty 1 — cai em
 * NONE (ou over-strip se o ledger pedir), NUNCA é auto-stripado. `assertCleanName` é o guard final.
 * IDEMPOTENTE: re-rodar sobre um já-restaurado dá 'none'.
 */
export function detectRepair(args: {
  ledgerBefore: string | null
  current: string
  quantidade: string | null
  unidade: string | null
}): { kind: RepairKind; restored: string } {
  const current = (args.current ?? '').trim()

  // A. TASTE still-embeds — unidade a_gosto/q_b com a frase não-mensurável ainda no texto ("sal a gosto").
  if (
    (args.unidade === 'a_gosto' || args.unidade === 'q_b') &&
    stillEmbedsMeasure(current, args.unidade)
  ) {
    return { kind: 'still-embeds', restored: deterministicStrip(current, args.unidade).trim() }
  }

  // B. NUMBER still-embeds CORROBORADO — o número-líder do texto IGUALA a `quantidade` estruturada ⇒ a
  //    medida VAZOU no nome. SEM corroboração (qty null, ou líder ≠ qty) NÃO toca (data-safety FIX 1).
  if (args.quantidade != null && args.quantidade !== '') {
    const lead = stripLeadingQuantity(current)
    const q = Number(args.quantidade.replace(',', '.'))
    if (lead.hadQuantity && lead.value != null && Number.isFinite(q) && Math.abs(lead.value - q) < 1e-3) {
      return { kind: 'still-embeds', restored: deterministicStrip(current, args.unidade).trim() }
    }
  }

  // C. OVER-STRIP — o modelo comeu palavra(s) de porção genuína(s) ante o strip determinístico.
  const before = (args.ledgerBefore ?? '').trim()
  if (before !== '') {
    const det = deterministicStrip(before, args.unidade).trim()
    if (det !== '' && det !== current && isWordSuffix(current, det)) {
      const dropped = normWords(det).slice(0, normWords(det).length - normWords(current).length)
      // Só restaura se ALGUMA palavra largada for GENUÍNA (porção) — se foram só conector/alias, o
      // modelo limpou certo (o atual é mais limpo) ⇒ none.
      if (dropped.some((w) => !isMeasureResidueWord(w))) {
        return { kind: 'over-strip', restored: det }
      }
    }
  }

  return { kind: 'none', restored: current }
}

/**
 * `true` se o nome COMEÇA com um token de quantidade — em qualquer forma (dígito, fração-barra, glifo,
 * número escrito meia/meio/um/uma/…), OU o fragmento residual "e 1/2" (a parte fracionária de uma mista
 * cujo inteiro já foi removido). Usado pra FALHAR-ALTO antes de gravar (`assertCleanName`).
 */
export function beginsWithQuantityToken(name: string): boolean {
  const t = (name ?? '').trim()
  if (t === '') return false
  if (stripLeadingQuantity(t).hadQuantity) return true
  // resíduo "e 1/2 …" / "e meia …": fragmento de uma fração mista cujo inteiro já saiu.
  if (new RegExp(`^e\\s+(?:\\d+(?:[.,]\\d+)?(?:\\/\\d+)?|[${FRACTION_GLYPHS}]|meia|meio)(?=\\s|$|[,;.])`, 'i').test(t)) {
    return true
  }
  return false
}

/** GUARD de gravação: ESTOURA se o nome começa com token de quantidade (nunca grava nome "sujo"). */
export function assertCleanName(name: string): void {
  if (beginsWithQuantityToken(name)) {
    throw new Error(`Nome começa com token de quantidade (não-limpo, NÃO gravar): "${name}"`)
  }
}

/**
 * A PRIMEIRA palavra de conteúdo do nome parece SINGULAR (não termina em "s")? Heurística pra montar a
 * lista-do-humano (P3): quando a quantidade > 1 mas o nome começa singular ("4 ovo", "2 escalope") o
 * dono revisa à mão — NUNCA pluralizamos automaticamente (plurais especiais coração/mão/-ão vivem no
 * nome). Olha a PRIMEIRA palavra (o núcleo-cabeça, "gemas de ovo" → "gemas"), não a última.
 */
export function headLooksSingular(rawText: string): boolean {
  const t = (rawText ?? '').trim()
  if (t === '') return false
  const first = normalizeWord(t.split(/\s+/)[0])
  if (first === '') return false
  return !first.endsWith('s')
}

/** System prompt (fixo) do modelo barato que tira a medida do nome. */
export const STRIP_SYSTEM_PROMPT = [
  'Você normaliza nomes de ingredientes de receitas.',
  'Recebe a LINHA de um ingrediente e a sua medida estruturada (quantidade + unidade) JÁ correta.',
  'Sua tarefa: devolver SOMENTE o NOME do ingrediente, SEM a quantidade e SEM a unidade.',
  'Regras estritas: não traduza, não invente, não reescreva — preserve as palavras do nome verbatim, na mesma língua.',
  'Tire também conectores soltos que ligavam a medida ao nome ("de"/"of") no começo.',
  'Se a linha já for só o nome (sem medida), devolva-a igual.',
  'Exemplos: "320 g de arroz arbóreo" → "arroz arbóreo"; "2 xícaras de farinha" → "farinha"; "sal a gosto" → "sal"; "3 ovos" → "ovos".',
].join('\n')

/** PURO: monta o user prompt pra UMA linha. Estável/testável byte-a-byte. */
export function buildStripUserPrompt(
  rawText: string,
  quantidade: string | null,
  unidade: string | null,
): string {
  const medida = [quantidade, unidade].filter((x) => x != null && x !== '').join(' ')
  return [
    `Linha: ${rawText}`,
    medida !== ''
      ? `Medida estruturada (já correta — NÃO a repita no nome): ${medida}`
      : 'Medida estruturada: (nenhuma)',
    'Devolva só o nome do ingrediente, sem a medida.',
  ].join('\n')
}
