/**
 * Kernel PURO da Despensa (ADR-0038) — sem DB, sem I/O. A Despensa é UMA lista privada por Usuário de
 * NOMES de ingredientes que ele tem em casa (sem quantidade, dec.1). Aqui vive: a normalização do nome
 * (exibição + chave de dedup), o parse do campo "vários de uma vez", os básicos (dec.3; por pessoa no ADR-0042),
 * os tetos, a separação do resultado em seções (dec.4) e o que o "Cozinhei" tira (ADR-0042). O efeito (CRUD, casamento com as Receitas em SQL, pontes pra
 * Lista de compras) mora em `@/server/pantry/pantry`.
 */
import { normalizeOneLineText } from '@/domain/meal-plan'
import { normalizeText } from '@/domain/recipe-restrictions'

/** Comprimento máximo do nome de um item, por code point (o CHECK do banco espelha: 1–60). */
export const PANTRY_NAME_MAX = 60

/** Teto de itens por Usuário (anti-abuso barato; checado no servidor, sob lock, antes do INSERT). */
export const MAX_PANTRY_ITEMS = 200

/** Teto de nomes num único "adicionar" (o campo aceita vários separados por vírgula). */
export const MAX_PANTRY_ADD_BATCH = 50

/** Uma Receita entra no resultado com no máximo este número de Itens faltando (dec.4). */
export const PANTRY_MAX_MISSING = 3

/** Teto de Receitas no resultado (dec.4). */
export const PANTRY_MATCH_LIMIT = 30

/**
 * Normaliza o nome de um item para GRAVAR e EXIBIR com a mesma limpeza da Anotação do Cardápio
 * (`normalizeOneLineText`, ADR-0037). Vazio ou acima de `PANTRY_NAME_MAX` ⇒ `'invalid'`. Um nome sem nenhuma
 * letra/dígito ("---", "!!") também é inválido: não casaria com nada e viraria chave vazia.
 */
export function parsePantryName(value: unknown): string | 'invalid' {
  if (typeof value !== 'string') return 'invalid'
  const nome = normalizeOneLineText(value)
  if (nome.length === 0 || [...nome].length > PANTRY_NAME_MAX) return 'invalid'
  if (pantryMatchKey(nome).length === 0) return 'invalid'
  return nome
}

/**
 * Chave de DEDUP do item (a UNIQUE `(user_id, match_key)`): `normalizeText` (minúsculo, sem acento) e
 * pontuação/símbolo vira espaço, espaços colapsados. "Ovo", "ovo" e "OVO " são o mesmo item;
 * "pimenta-do-reino" e "pimenta do reino" também. Não é o que casa com as Receitas (isso normaliza o `nome` em
 * SQL, dec.2) — só evita duplicata na lista.
 */
export function pantryMatchKey(nome: string): string {
  return normalizeText(nome)
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim()
}

/**
 * Parse do campo de adicionar: aceita VÁRIOS nomes separados por vírgula, ponto e vírgula ou quebra de
 * linha ("ovo, tomate, queijo"). Cada pedaço passa por `parsePantryName`; pedaços vazios somem (vírgula
 * sobrando não é erro), e repetidos pela chave de dedup colapsam no primeiro. Algum pedaço não-vazio
 * inválido (longo demais) ⇒ `'invalid'` — o servidor responde 400 em vez de gravar só uma parte calada.
 * Acima de `MAX_PANTRY_ADD_BATCH` nomes ⇒ `'too_many'`.
 */
export function splitPantryInput(value: unknown): string[] | 'invalid' | 'too_many' {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null
  if (raw == null) return 'invalid'
  if (raw.length > MAX_PANTRY_ADD_BATCH) return 'too_many'
  const pieces: string[] = []
  for (const chunk of raw) {
    if (typeof chunk !== 'string') return 'invalid'
    for (const p of chunk.split(/[,;\n\r]+/)) {
      if (p.trim().length === 0) continue
      pieces.push(p)
      // Sai cedo: um corpo enorme não chega a ser todo coletado antes do teto.
      if (pieces.length > MAX_PANTRY_ADD_BATCH) return 'too_many'
    }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of pieces) {
    const nome = parsePantryName(p)
    if (nome === 'invalid') return 'invalid'
    const key = pantryMatchKey(nome)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(nome)
  }
  return out.length === 0 ? 'invalid' : out
}

/**
 * Os BÁSICOS PADRÃO (dec.3): o que quase toda casa tem e quase toda Receita pede. Com "Tenho o básico" ligado,
 * entram como termos extras no casamento — mas só cobrem a linha feita INTEIRA de básicos e NUNCA sozinhos
 * justificam mostrar uma Receita (precisa de ao menos um item real da Despensa). Os dois idiomas entram
 * sempre: a Receita pode estar no outro locale. Só nomes inequívocos: "pimenta" sozinha cobriria pimenta
 * dedo-de-moça; "oil" cobriria óleo de gergelim. O rótulo na tela mora em `messages.despensa.basicosLista`.
 * Cada pessoa pode trocar a lista (ADR-0042 dec.4); quem nunca mexeu usa ESTA, byte a byte
 * (`resolvePantryBasics`).
 */
export const PANTRY_BASICS: readonly string[] = [
  'sal',
  'água',
  'óleo',
  'óleo vegetal',
  'azeite',
  'azeite de oliva',
  'pimenta-do-reino',
  'salt',
  'water',
  'vegetable oil',
  'olive oil',
  'black pepper',
]

/** Uma Receita casada, já com o que falta (nomes no locale do viewer). */
export type PantryMatchCounts = {
  total: number
  covered: number
  missing: readonly string[]
}

/** Seções da tela (dec.4): nada faltando ⇒ "Dá pra fazer agora"; 1–3 ⇒ "Falta pouco". */
export function splitPantryMatches<T extends PantryMatchCounts>(matches: readonly T[]): { ready: T[]; almost: T[] } {
  const ready: T[] = []
  const almost: T[] = []
  for (const m of matches) (m.missing.length === 0 ? ready : almost).push(m)
  return { ready, almost }
}

// ── Básicos por pessoa e "Cozinhei" (ADR-0042) ───────────────────────────────────

/** Teto de básicos por Usuário (a lista padrão tem 12; cada um vira termo da regex dos básicos). */
export const MAX_PANTRY_BASICS = 30

/**
 * Os básicos EFETIVOS de uma pessoa: a lista dela, ou a padrão quando nunca mexeu (`NULL` no banco). Lista
 * vazia é escolha explícita ("não tenho básico nenhum") e vale como vazia — não volta ao padrão.
 */
export function resolvePantryBasics(stored: readonly string[] | null | undefined): readonly string[] {
  return stored ?? PANTRY_BASICS
}

/**
 * Valida a lista de básicos que a pessoa salva (ADR-0042 dec.4): um array de nomes, cada um com as MESMAS
 * regras de um item da Despensa (`parsePantryName`), repetidos pela chave colapsam no primeiro. Vazio é
 * válido (a pessoa tirou todos). Não-array ou algum nome inválido ⇒ `'invalid'`; acima de
 * `MAX_PANTRY_BASICS` ⇒ `'too_many'`. Sem split por vírgula: cada elemento é UM nome (a tela manda chips).
 */
export function parsePantryBasics(value: unknown): string[] | 'invalid' | 'too_many' {
  if (!Array.isArray(value)) return 'invalid'
  return parseNameList(value, MAX_PANTRY_BASICS)
}

/**
 * Valida o "Desfazer" do "Cozinhei" (ADR-0042 dec.2): os nomes que o servidor acabou de tirar voltam como
 * vieram. Um nome por elemento — nunca split por vírgula: um item vindo da Lista de compras pode ter vírgula
 * no nome, e o desfazer tem de devolver EXATAMENTE o que saiu. Vazio ⇒ `'invalid'`; teto = o da Despensa.
 */
export function parsePantryRestore(value: unknown): string[] | 'invalid' {
  if (!Array.isArray(value) || value.length === 0) return 'invalid'
  const out = parseNameList(value, MAX_PANTRY_ITEMS)
  return out === 'too_many' ? 'invalid' : out
}

function parseNameList(value: readonly unknown[], max: number): string[] | 'invalid' | 'too_many' {
  if (value.length > max) return 'too_many'
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of value) {
    const nome = parsePantryName(v)
    if (nome === 'invalid') return 'invalid'
    const key = pantryMatchKey(nome)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(nome)
  }
  return out
}

/**
 * "Cozinhei" (ADR-0042 dec.1/3): dos itens da Despensa que o casamento disse que cobrem algum Item da
 * Receita (`usedIds`), quais SAEM. Um item que é básico da pessoa (mesma chave de dedup de algum básico
 * efetivo) FICA — sal não acaba porque se fez um ovo. A ordem de `items` é preservada.
 */
export function splitCookedPantryItems<T extends { id: string; nome: string }>(
  items: readonly T[],
  usedIds: Iterable<string>,
  basics: readonly string[],
): { remove: T[]; keptBasics: T[] } {
  const used = new Set(usedIds)
  const basicKeys = new Set(basics.map(pantryMatchKey))
  const remove: T[] = []
  const keptBasics: T[] = []
  for (const item of items) {
    if (!used.has(item.id)) continue
    if (basicKeys.has(pantryMatchKey(item.nome))) keptBasics.push(item)
    else remove.push(item)
  }
  return { remove, keptBasics }
}
