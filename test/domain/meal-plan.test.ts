import { describe, it, expect } from 'vitest'
import {
  MEAL_PLAN_MAX_DATE,
  MEAL_PLAN_MAX_RANGE_DAYS,
  MEAL_PLAN_MIN_DATE,
  MEAL_PLAN_NOTE_MAX,
  MEAL_SLOTS,
  addDays,
  compareMealPlanEntries,
  isMealSlot,
  isPlanDate,
  parsePlanNote,
  parsePlanPorcoes,
  parsePlanRange,
  planPreviousWeekCopy,
  rangeLength,
  weekDays,
  weekStartOf,
  type CopyableMealPlanEntry,
  type MealSlot,
} from '@/domain/meal-plan'

/**
 * Kernel PURO do Plano de refeições (ADR-0035): datas são DIAS DE CALENDÁRIO (`YYYY-MM-DD`), a
 * semana começa na segunda (ISO 8601), intervalos são inclusivos e limitados, porções são gravadas
 * (lixo ⇒ 'invalid', nunca ignorado).
 */

describe('isPlanDate — só datas REAIS dentro da janela', () => {
  it('aceita datas de calendário válidas (inclusive 29/fev de ano bissexto)', () => {
    expect(isPlanDate('2026-09-28')).toBe(true)
    expect(isPlanDate('2028-02-29')).toBe(true)
    expect(isPlanDate('2026-12-31')).toBe(true)
  })

  it('rejeita datas impossíveis (normalizadas pelo Date) em vez de rolar pro mês seguinte', () => {
    expect(isPlanDate('2026-02-30')).toBe(false)
    expect(isPlanDate('2026-02-29')).toBe(false) // 2026 não é bissexto
    expect(isPlanDate('2026-13-01')).toBe(false)
    expect(isPlanDate('2026-00-10')).toBe(false)
    expect(isPlanDate('2026-04-31')).toBe(false)
    expect(isPlanDate('2026-01-00')).toBe(false)
  })

  it('rejeita formato errado e não-strings, sem lançar', () => {
    for (const v of ['2026-9-28', '28/09/2026', '2026-09-28T00:00:00Z', ' 2026-09-28', '', 'hoje']) {
      expect(isPlanDate(v)).toBe(false)
    }
    for (const v of [null, undefined, 20260928, new Date('2026-09-28'), {}]) {
      expect(isPlanDate(v)).toBe(false)
    }
  })

  it('limites da janela são inclusivos; fora deles é lixo', () => {
    expect(isPlanDate(MEAL_PLAN_MIN_DATE)).toBe(true)
    expect(isPlanDate(MEAL_PLAN_MAX_DATE)).toBe(true)
    expect(isPlanDate(addDays(MEAL_PLAN_MIN_DATE, -1))).toBe(false)
    expect(isPlanDate(addDays(MEAL_PLAN_MAX_DATE, 1))).toBe(false)
    expect(isPlanDate('0001-01-01')).toBe(false)
    expect(isPlanDate('9999-12-31')).toBe(false)
  })
})

describe('addDays — aritmética de calendário em UTC (sem horário de verão)', () => {
  it('atravessa fim de mês, de ano e 29/fev', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-09-28', 0)).toBe('2026-09-28')
  })

  it('aceita n negativo (volta pro ano anterior)', () => {
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-09-28', -7)).toBe('2026-09-21')
  })

  it('dias de troca de horário de verão (EUA/Europa/antigo BR) andam exatamente 1 dia', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09') // DST EUA começa
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30') // DST Europa começa
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26') // DST Europa termina
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02') // DST EUA termina
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
  })

  it('somar 7 × 1 dia = somar 7 dias', () => {
    let d = '2026-10-29'
    for (let i = 0; i < 7; i++) d = addDays(d, 1)
    expect(d).toBe(addDays('2026-10-29', 7))
    expect(d).toBe('2026-11-05')
  })
})

describe('weekStartOf — a semana começa na SEGUNDA', () => {
  it('uma segunda é o próprio início da semana', () => {
    expect(weekStartOf('2026-09-28')).toBe('2026-09-28')
  })

  it('terça…sábado voltam pra segunda da mesma semana', () => {
    expect(weekStartOf('2026-09-29')).toBe('2026-09-28')
    expect(weekStartOf('2026-10-03')).toBe('2026-09-28')
  })

  it('um DOMINGO pertence à semana da segunda ANTERIOR (não à seguinte)', () => {
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28')
  })

  it('atravessa mês e ano', () => {
    expect(weekStartOf('2026-03-01')).toBe('2026-02-23') // domingo
    expect(weekStartOf('2027-01-03')).toBe('2026-12-28') // domingo
    expect(weekStartOf('2026-01-01')).toBe('2025-12-29') // quinta
  })
})

describe('weekDays', () => {
  it('devolve os 7 dias segunda → domingo, atravessando o mês', () => {
    expect(weekDays('2026-09-28')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
  })

  it('o domingo da semana tem weekStartOf = a própria segunda', () => {
    const days = weekDays('2026-12-28')
    expect(days).toHaveLength(7)
    expect(days[6]).toBe('2027-01-03')
    for (const d of days) expect(weekStartOf(d)).toBe('2026-12-28')
  })
})

describe('rangeLength', () => {
  it('é inclusivo', () => {
    expect(rangeLength('2026-09-28', '2026-09-28')).toBe(1)
    expect(rangeLength('2026-09-28', '2026-10-04')).toBe(7)
    expect(rangeLength('2026-12-31', '2027-01-01')).toBe(2)
  })
})

describe('parsePlanRange', () => {
  it('aceita from == to (1 dia) e uma semana', () => {
    expect(parsePlanRange('2026-09-28', '2026-09-28')).toEqual({ from: '2026-09-28', to: '2026-09-28' })
    expect(parsePlanRange('2026-09-28', '2026-10-04')).toEqual({ from: '2026-09-28', to: '2026-10-04' })
  })

  it('rejeita from > to', () => {
    expect(parsePlanRange('2026-10-04', '2026-09-28')).toBeNull()
  })

  it(`aceita até ${MEAL_PLAN_MAX_RANGE_DAYS} dias INCLUSIVOS; um a mais é rejeitado`, () => {
    const from = '2026-09-28'
    expect(parsePlanRange(from, addDays(from, MEAL_PLAN_MAX_RANGE_DAYS - 1))).toEqual({
      from,
      to: '2026-10-11',
    })
    expect(parsePlanRange(from, addDays(from, MEAL_PLAN_MAX_RANGE_DAYS))).toBeNull()
  })

  it('rejeita pontas inválidas ou ausentes', () => {
    expect(parsePlanRange('2026-02-30', '2026-03-01')).toBeNull()
    expect(parsePlanRange('2026-09-28', 'amanha')).toBeNull()
    expect(parsePlanRange(null, '2026-09-28')).toBeNull()
    expect(parsePlanRange('2026-09-28', undefined)).toBeNull()
    expect(parsePlanRange(addDays(MEAL_PLAN_MIN_DATE, -1), MEAL_PLAN_MIN_DATE)).toBeNull()
  })

  it('aceita um teto menor (o "gerar lista" usa 7)', () => {
    const from = '2026-09-28'
    expect(parsePlanRange(from, addDays(from, 6), 7)).toEqual({ from, to: '2026-10-04' })
    expect(parsePlanRange(from, addDays(from, 7), 7)).toBeNull()
  })
})

describe('parsePlanPorcoes — gravado, então lixo é "invalid" (não ignorado)', () => {
  it('null/undefined ⇒ null (usa as porções da Receita)', () => {
    expect(parsePlanPorcoes(null)).toBeNull()
    expect(parsePlanPorcoes(undefined)).toBeNull()
  })

  it('inteiros 1–99 passam como estão', () => {
    expect(parsePlanPorcoes(1)).toBe(1)
    expect(parsePlanPorcoes(4)).toBe(4)
    expect(parsePlanPorcoes(99)).toBe(99)
  })

  it('fora do intervalo, fracionário ou não-número ⇒ invalid', () => {
    for (const v of [0, -1, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2', '', true, {}, []]) {
      expect(parsePlanPorcoes(v)).toBe('invalid')
    }
  })
})

describe('isMealSlot', () => {
  it('aceita só os 4 valores do enum', () => {
    for (const s of MEAL_SLOTS) expect(isMealSlot(s)).toBe(true)
    for (const v of ['ceia', 'ALMOCO', '', null, undefined, 0]) expect(isMealSlot(v)).toBe(false)
  })
})

describe('compareMealPlanEntries — dia → refeição do dia → criação', () => {
  const e = (day: string, slot: MealSlot, createdAt: string) => ({ day, slot, createdAt })

  it('ordena por dia antes de tudo', () => {
    const a = e('2026-09-29', 'cafe_da_manha', '2026-09-01T00:00:00.000Z')
    const b = e('2026-09-28', 'jantar', '2026-09-02T00:00:00.000Z')
    expect([a, b].sort(compareMealPlanEntries)).toEqual([b, a])
  })

  it('no mesmo dia, segue a ORDEM das refeições (não a alfabética)', () => {
    const jantar = e('2026-09-28', 'jantar', '2026-09-01T00:00:00.000Z')
    const lanche = e('2026-09-28', 'lanche', '2026-09-01T00:00:00.000Z')
    const almoco = e('2026-09-28', 'almoco', '2026-09-01T00:00:00.000Z')
    const cafe = e('2026-09-28', 'cafe_da_manha', '2026-09-01T00:00:00.000Z')
    expect([jantar, lanche, almoco, cafe].sort(compareMealPlanEntries)).toEqual([cafe, almoco, lanche, jantar])
  })

  it('mesmo dia e refeição ⇒ a mais antiga primeiro; iguais ⇒ 0', () => {
    const older = e('2026-09-28', 'almoco', '2026-09-01T10:00:00.000Z')
    const newer = e('2026-09-28', 'almoco', '2026-09-01T11:00:00.000Z')
    expect(compareMealPlanEntries(newer, older)).toBeGreaterThan(0)
    expect(compareMealPlanEntries(older, newer)).toBeLessThan(0)
    expect(compareMealPlanEntries(older, { ...older })).toBe(0)
  })
})

// ── ADR-0037: Anotação livre + copiar a semana anterior ─────────────────────────

describe('parsePlanNote (ADR-0037)', () => {
  it('normaliza: pontas, espaços repetidos, quebras de linha e controles viram um espaço', () => {
    expect(parsePlanNote('  Jantar   fora ')).toBe('Jantar fora')
    expect(parsePlanNote('Sobras\nde\tterça')).toBe('Sobras de terça')
    expect(parsePlanNote('a\u0000b')).toBe('a b')
    expect(parsePlanNote('abc\u202Edef')).toBe('abc def')
    expect(parsePlanNote('\u2067abc\u2069')).toBe('abc')
    expect(parsePlanNote('\u200Fjantar\u200E')).toBe('jantar')
    expect(parsePlanNote('a\u061Cb')).toBe('a b')
  })
  it('só invisíveis de largura zero ⇒ invalid (não vira uma anotação que não se vê)', () => {
    expect(parsePlanNote('\u200B')).toBe('invalid')
    expect(parsePlanNote('\uFEFF \u200B')).toBe('invalid')
  })
  it('preserva emoji compostos (ZWJ) e acentos', () => {
    expect(parsePlanNote('Pizza 👨‍🍳')).toBe('Pizza 👨‍🍳')
    expect(parsePlanNote('Feijão')).toBe('Feijão')
  })
  it('vazio, só espaço, não-string ou acima do teto ⇒ invalid', () => {
    expect(parsePlanNote('')).toBe('invalid')
    expect(parsePlanNote('   \n ')).toBe('invalid')
    expect(parsePlanNote(42)).toBe('invalid')
    expect(parsePlanNote(null)).toBe('invalid')
    expect(parsePlanNote('x'.repeat(MEAL_PLAN_NOTE_MAX))).toBe('x'.repeat(MEAL_PLAN_NOTE_MAX))
    expect(parsePlanNote('x'.repeat(MEAL_PLAN_NOTE_MAX + 1))).toBe('invalid')
  })
})

describe('planPreviousWeekCopy (ADR-0037)', () => {
  const e = (over: Partial<CopyableMealPlanEntry>): CopyableMealPlanEntry => ({
    day: '2026-09-21',
    slot: 'almoco',
    recipeId: 'r1',
    note: null,
    porcoes: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    ...over,
  })
  const week = { targetFrom: '2026-09-28', targetTo: '2026-10-04' }

  it('anda +7 dias, mantém porções e anotações, na ordem do plano', () => {
    const { toInsert, skippedCount } = planPreviousWeekCopy(
      [
        e({ day: '2026-09-23', slot: 'jantar', recipeId: null, note: 'Jantar fora' }),
        e({ day: '2026-09-21', slot: 'jantar', recipeId: 'r2', porcoes: 4 }),
        e({ day: '2026-09-21', slot: 'almoco' }),
      ],
      [],
      week,
    )
    expect(toInsert.map((x) => [x.day, x.slot, x.recipeId ?? x.note, x.porcoes])).toEqual([
      ['2026-09-28', 'almoco', 'r1', null],
      ['2026-09-28', 'jantar', 'r2', 4],
      ['2026-09-30', 'jantar', 'Jantar fora', null],
    ])
    expect(skippedCount).toBe(0)
  })

  it('só preenche refeições VAZIAS no destino; prato + acompanhamento da origem entram juntos', () => {
    const { toInsert, skippedCount } = planPreviousWeekCopy(
      [e({ slot: 'almoco', recipeId: 'r1' }), e({ slot: 'almoco', recipeId: 'r2' }), e({ slot: 'jantar', recipeId: 'r3' })],
      [{ day: '2026-09-28', slot: 'jantar' }],
      week,
    )
    expect(toInsert.map((x) => x.recipeId)).toEqual(['r1', 'r2'])
    expect(skippedCount).toBe(1)
  })

  it('dias antes de targetFrom nem contam como pulados (semana corrente, de hoje em diante)', () => {
    const { toInsert, skippedCount } = planPreviousWeekCopy(
      [e({ day: '2026-09-21' }), e({ day: '2026-09-24' })],
      [],
      { targetFrom: '2026-09-30', targetTo: '2026-10-04' },
    )
    expect(toInsert.map((x) => x.day)).toEqual(['2026-10-01'])
    expect(skippedCount).toBe(0)
  })

  it('respeita o teto por dia contando o que já existe', () => {
    const { toInsert, skippedCount } = planPreviousWeekCopy(
      [e({ slot: 'almoco', recipeId: 'r1' }), e({ slot: 'jantar', recipeId: 'r2' })],
      [{ day: '2026-09-28', slot: 'cafe_da_manha' }],
      { ...week, maxPerDay: 2 },
    )
    expect(toInsert.map((x) => x.recipeId)).toEqual(['r1'])
    expect(skippedCount).toBe(1)
  })
})
