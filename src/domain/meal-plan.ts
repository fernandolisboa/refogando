/**
 * Kernel PURO do Plano de refeições (ADR-0035) — sem DB, sem I/O, sem relógio. O plano é PRIVADO
 * por Usuário: cada Refeição planejada é (dia, refeição do dia, Receita, porções). O efeito (CRUD,
 * leitura da semana, plano → lista de compras) mora em `@/server/meal-plan/meal-plan`.
 *
 * DATAS são DIAS DE CALENDÁRIO (`YYYY-MM-DD`), nunca instantes: "terça" é a terça do fuso de quem
 * planeja, então o CLIENTE diz qual dia é hoje e qual semana quer ver; o servidor nunca deriva o
 * dia do próprio relógio (ADR-0035 dec.2). A aritmética aqui roda em UTC sobre meia-noite, que não
 * tem horário de verão — somar 1 dia é sempre +24h.
 */

/** Refeições do dia, na ORDEM de exibição (ADR-0035 dec.1). Valores do enum `meal_slot`. */
export const MEAL_SLOTS = ['cafe_da_manha', 'almoco', 'lanche', 'jantar'] as const
export type MealSlot = (typeof MEAL_SLOTS)[number]

export function isMealSlot(value: unknown): value is MealSlot {
  return typeof value === 'string' && (MEAL_SLOTS as readonly string[]).includes(value)
}

/** Porções-alvo de uma Refeição planejada: mesmo intervalo do escalador do detalhe (#452). */
export const MEAL_PLAN_PORCOES_MIN = 1
export const MEAL_PLAN_PORCOES_MAX = 99

/**
 * Teto de Refeições planejadas por DIA — anti-abuso barato (enforced no servidor antes do INSERT,
 * não no banco; corrida no limite é aceitável, como o cap de Listas). Folgado para o uso real
 * (4 refeições × 2–3 pratos).
 */
export const MAX_MEAL_PLAN_ENTRIES_PER_DAY = 12

/** Maior intervalo (em dias, inclusivo) que uma LEITURA aceita (o "gerar lista" usa o de baixo). */
export const MEAL_PLAN_MAX_RANGE_DAYS = 14

/**
 * Maior intervalo de um "gerar lista de compras": uma semana (a UI nunca pede mais). Limita o
 * trabalho por requisição (≤ 7 × `MAX_MEAL_PLAN_ENTRIES_PER_DAY` upserts).
 */
export const MEAL_PLAN_LIST_MAX_RANGE_DAYS = 7

/**
 * Janela de datas aceitas: o plano é de uso doméstico, perto de hoje. Limites FIXOS (sem relógio)
 * só barram lixo (ano 0001, 9999) — o cliente navega livremente entre semanas dentro deles. As
 * pontas caem numa segunda e num domingo, pra a primeira e a última semana serem inteiras.
 */
export const MEAL_PLAN_MIN_DATE = '2019-12-30'
export const MEAL_PLAN_MAX_DATE = '2101-01-02'

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Meia-noite UTC de uma data `YYYY-MM-DD` — base da aritmética e da formatação de calendário. */
export function planDateToUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * `YYYY-MM-DD` que é uma data REAL (rejeita 2026-02-30, 2026-13-01) dentro da janela aceita.
 * Total: nunca lança.
 */
export function isPlanDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = ISO_DATE_RE.exec(value)
  if (!m) return false
  const d = planDateToUtc(value)
  if (Number.isNaN(d.getTime()) || fromUtc(d) !== value) return false
  return value >= MEAL_PLAN_MIN_DATE && value <= MEAL_PLAN_MAX_DATE
}

/** Soma `n` dias (pode ser negativo) a uma data `YYYY-MM-DD` válida. */
export function addDays(iso: string, n: number): string {
  const d = planDateToUtc(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return fromUtc(d)
}

/** Segunda-feira da semana (ISO 8601, a semana começa na segunda — ADR-0035 dec.2). */
export function weekStartOf(iso: string): string {
  const dow = planDateToUtc(iso).getUTCDay() // 0 = domingo … 6 = sábado
  const sinceMonday = (dow + 6) % 7
  return addDays(iso, -sinceMonday)
}

/** Os 7 dias (segunda → domingo) da semana que começa em `weekStart`. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** Número de dias entre `from` e `to`, inclusivo (`from == to` ⇒ 1). */
export function rangeLength(from: string, to: string): number {
  return Math.round((planDateToUtc(to).getTime() - planDateToUtc(from).getTime()) / 86_400_000) + 1
}

export type PlanRange = { from: string; to: string }

/**
 * Valida um intervalo `[from, to]` (inclusivo): as duas pontas são datas de plano, `from <= to` e o
 * tamanho cabe em `maxDays` (default `MEAL_PLAN_MAX_RANGE_DAYS`). `null` quando inválido (o servidor responde 400).
 */
export function parsePlanRange(
  from: unknown,
  to: unknown,
  maxDays: number = MEAL_PLAN_MAX_RANGE_DAYS,
): PlanRange | null {
  if (!isPlanDate(from) || !isPlanDate(to)) return null
  if (from > to) return null
  if (rangeLength(from, to) > maxDays) return null
  return { from, to }
}

/**
 * Porções-alvo de uma Refeição planejada. `null`/ausente ⇒ `null` (usa as porções da Receita);
 * inteiro dentro do intervalo ⇒ ele mesmo; qualquer outra coisa ⇒ `'invalid'` (400 na rota —
 * aqui, ao contrário do "adicionar à lista", o valor é GRAVADO, então lixo não é ignorado).
 */
export function parsePlanPorcoes(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid'
  if (value < MEAL_PLAN_PORCOES_MIN || value > MEAL_PLAN_PORCOES_MAX) return 'invalid'
  return value
}

/** Ordena Refeições planejadas por dia, depois pela ordem das refeições do dia, depois por criação. */
export function compareMealPlanEntries(
  a: { day: string; slot: MealSlot; createdAt: string },
  b: { day: string; slot: MealSlot; createdAt: string },
): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  const sa = MEAL_SLOTS.indexOf(a.slot)
  const sb = MEAL_SLOTS.indexOf(b.slot)
  if (sa !== sb) return sa - sb
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

// ── Anotação livre (ADR-0037) ────────────────────────────────────────────────────

/** Tamanho máximo de uma Anotação ("jantar fora", "sobras de terça") — o CHECK do banco espelha. */
export const MEAL_PLAN_NOTE_MAX = 80

/**
 * Texto livre de UMA linha, limpo para gravar e comparar: NFC, sem controles, marcas/embeddings/isolates bidi
 * nem invisíveis de largura zero, espaços colapsados, sem pontas. O ZWJ (U+200D) fica: é
 * ele que junta os emoji compostos (👨‍🍳).
 * Usado pela Anotação (ADR-0037) e pelo nome de item da Despensa (ADR-0038).
 */
export function normalizeOneLineText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\p{Cc}\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Anotação livre de uma refeição do dia (ADR-0037): texto curto de UMA linha, no lugar de uma Receita.
 * Normaliza (NFC, sem caracteres de controle nem de direção bidi, espaços colapsados, sem pontas) e só então mede: vazio
 * ou acima de `MEAL_PLAN_NOTE_MAX` ⇒ `'invalid'` (400 na rota; o valor é GRAVADO, lixo não passa).
 * A forma normalizada é a que vai pro banco — a UNIQUE (dia, refeição, anotação) compara ela.
 */
export function parsePlanNote(value: unknown): string | 'invalid' {
  if (typeof value !== 'string') return 'invalid'
  const note = normalizeOneLineText(value)
  if (note.length === 0 || [...note].length > MEAL_PLAN_NOTE_MAX) return 'invalid'
  return note
}

// ── Copiar a semana anterior (ADR-0037) ──────────────────────────────────────────

/** Uma Refeição planejada vista pela cópia: Receita OU Anotação (exatamente um dos dois). */
export type CopyableMealPlanEntry = {
  day: string
  slot: MealSlot
  recipeId: string | null
  note: string | null
  porcoes: number | null
  createdAt: string
}

/**
 * Plano PURO do "Copiar semana anterior" (ADR-0037): cada entrada da semana de origem anda +7 dias e
 * entra no destino SÓ se (a) o dia deslocado cai em `[targetFrom, targetTo]` (na semana corrente o
 * cliente começa de hoje), (b) aquela refeição do dia está VAZIA no destino — copiar só preenche
 * buracos, nunca empilha um segundo almoço sobre o que já foi planejado (o mesmo default do "só
 * preencher refeições vazias" da Sugestão) — e (c) o dia não passou do teto. Entradas da origem que
 * caem na mesma refeição vazia entram JUNTAS (prato + acompanhamento). Saída na ordem do plano;
 * `skippedCount` conta só as que caíam no destino e não entraram.
 */
export function planPreviousWeekCopy(
  source: readonly CopyableMealPlanEntry[],
  existing: ReadonlyArray<{ day: string; slot: MealSlot }>,
  opts: { targetFrom: string; targetTo: string; maxPerDay?: number },
): { toInsert: CopyableMealPlanEntry[]; skippedCount: number } {
  const maxPerDay = opts.maxPerDay ?? MAX_MEAL_PLAN_ENTRIES_PER_DAY
  const occupied = new Set(existing.map((e) => `${e.day}|${e.slot}`))
  const perDay = new Map<string, number>()
  for (const e of existing) perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1)

  const toInsert: CopyableMealPlanEntry[] = []
  let inRange = 0
  for (const e of [...source].sort(compareMealPlanEntries)) {
    const day = addDays(e.day, 7)
    // Fora do destino (ex.: dias que já passaram na semana corrente) não é "pulada": nem foi pedida.
    if (day < opts.targetFrom || day > opts.targetTo) continue
    inRange++
    if (occupied.has(`${day}|${e.slot}`)) continue
    const n = perDay.get(day) ?? 0
    if (n >= maxPerDay) continue
    perDay.set(day, n + 1)
    toInsert.push({ ...e, day })
  }
  return { toInsert, skippedCount: inRange - toInsert.length }
}
