import { describe, it, expect } from 'vitest'
import { decideRestrictionNotices } from '@/domain/recipe-restrictions'
import { RESTRICOES } from '@/domain/vocabulary'

/**
 * Tabela-verdade do motor puro de Aviso de restrição (issue #7, §5.1). Módulo PURO —
 * sem DB, sem locale, sem prosa. Emite SÓ contradições, SÓ códigos
 * (`kind`/`restricao`/`alergeno`). Cobre célula a célula: match canônico e tokens
 * alternativos; normalização (maiúscula+acento); independência por restrição;
 * laticínio contradiz `sem_lactose`/`vegano` mas NUNCA `vegetariano` (D1, guarda contra
 * falso alarme); ausência de dado (`null`/`[]`) nunca dispara; sem restrição declarada
 * nada contradiz; dedup por restrição; total/sem throw. Mais um loop defensivo
 * afirmando que NENHUM par dispara sem entrada no mapa.
 */

describe('decideRestrictionNotices — tabela-verdade', () => {
  // U1 — match canônico: trigo contradiz sem_gluten
  it('U1 sem_gluten + item alergenos:[trigo] ⇒ 1 aviso contradicao', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['sem_gluten'], items: [{ alergenos: ['trigo'] }] }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'trigo' }] })
  })

  // U2 — token alternativo: gluten também contradiz sem_gluten
  it('U2 sem_gluten + item alergenos:[gluten] (token alternativo) ⇒ 1 aviso', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['sem_gluten'], items: [{ alergenos: ['gluten'] }] }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'gluten' }] })
  })

  // U3 — normalização: maiúscula + acento casa, alergeno volta normalizado
  it('U3 sem_gluten + item alergenos:[Glúten] (maiúscula+acento) ⇒ 1 aviso, alergeno normalizado', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['sem_gluten'], items: [{ alergenos: ['Glúten'] }] }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'gluten' }] })
  })

  // U4 — laticínio contradiz sem_lactose
  it('U4 sem_lactose + item alergenos:[leite] ⇒ 1 aviso restricao:sem_lactose', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['sem_lactose'], items: [{ alergenos: ['leite'] }] }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_lactose', alergeno: 'leite' }] })
  })

  // U5 — laticínio contradiz vegano
  it('U5 vegano + item alergenos:[leite] ⇒ 1 aviso restricao:vegano (laticínio contradiz vegano)', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['vegano'], items: [{ alergenos: ['leite'] }] }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'vegano', alergeno: 'leite' }] })
  })

  // U6 — laticínio NÃO contradiz vegetariano (D1: ovolacto aceita laticínio)
  it('U6 vegetariano + item alergenos:[leite] ⇒ 0 avisos (ovolacto aceita laticínio — D1)', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['vegetariano'], items: [{ alergenos: ['leite'] }] }),
    ).toEqual({ avisos: [] })
  })

  // U7 — independência: cada restrição avaliada por si, laticínio dispara as duas
  it('U7 [sem_lactose,vegano] + item alergenos:[leite] ⇒ 2 avisos (1 por restrição)', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['sem_lactose', 'vegano'], items: [{ alergenos: ['leite'] }] }),
    ).toEqual({
      avisos: [
        { kind: 'contradicao', restricao: 'sem_lactose', alergeno: 'leite' },
        { kind: 'contradicao', restricao: 'vegano', alergeno: 'leite' },
      ],
    })
  })

  // U8 — ausência de dado (raw-text-only / FK sem dado) NUNCA dispara
  it('U8 item alergenos:null + sem_gluten ⇒ 0 avisos (ausência nunca dispara)', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['sem_gluten'], items: [{ alergenos: null }] }),
    ).toEqual({ avisos: [] })
  })

  // U9 — FK com dado explicitamente vazio: declarado fica não-verificado, sem falso alarme
  it('U9 item alergenos:[] + sem_gluten ⇒ 0 avisos (declarado não-verificado, sem falso alarme)', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['sem_gluten'], items: [{ alergenos: [] }] }),
    ).toEqual({ avisos: [] })
  })

  // U10 — sem restrição declarada, nada a contradizer
  it('U10 restricoes:[] + item alergenos:[trigo] ⇒ 0 avisos (nada declarado)', () => {
    expect(
      decideRestrictionNotices({ restricoes: [], items: [{ alergenos: ['trigo'] }] }),
    ).toEqual({ avisos: [] })
  })

  // U11 — dedup por restrição: dois itens com o mesmo alérgeno → uma entrada
  it('U11 dois itens alergenos:[trigo] + sem_gluten ⇒ 1 aviso (dedup por restrição)', () => {
    expect(
      decideRestrictionNotices({
        restricoes: ['sem_gluten'],
        items: [{ alergenos: ['trigo'] }, { alergenos: ['trigo'] }],
      }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'trigo' }] })
  })

  // U12 — alérgeno sem entrada no mapa nunca dispara
  it('U12 item alergenos:[corante] + qualquer restrição ⇒ 0 avisos (só dispara em match do mapa)', () => {
    expect(
      decideRestrictionNotices({ restricoes: ['sem_gluten', 'vegano'], items: [{ alergenos: ['corante'] }] }),
    ).toEqual({ avisos: [] })
  })

  // U13 — mistura FK-com-dado + raw-text-only
  it('U13 sem_gluten + item [trigo] + item null ⇒ 1 aviso (mistura FK-com-dado + raw-text)', () => {
    expect(
      decideRestrictionNotices({
        restricoes: ['sem_gluten'],
        items: [{ alergenos: ['trigo'] }, { alergenos: null }],
      }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'trigo' }] })
  })

  // U14 — input vazio: total, sem throw
  it('U14 input vazio (restricoes:[], items:[]) ⇒ {avisos:[]}', () => {
    expect(decideRestrictionNotices({ restricoes: [], items: [] })).toEqual({ avisos: [] })
  })

  // ── Saída locale-neutra: nunca há `mensagem` no domínio ───────────────────────
  it('cada aviso carrega SÓ códigos — nunca mensagem (locale-neutro)', () => {
    const { avisos } = decideRestrictionNotices({
      restricoes: ['sem_gluten'],
      items: [{ alergenos: ['trigo'] }],
    })
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).not.toHaveProperty('mensagem')
    expect(Object.keys(avisos[0]).sort()).toEqual(['alergeno', 'kind', 'restricao'])
  })

  // ── Total / sem throw em qualquer combinação razoável ─────────────────────────
  it('é total: não lança com tokens vazios/espaços/desconhecidos', () => {
    expect(() =>
      decideRestrictionNotices({
        restricoes: [...RESTRICOES],
        items: [{ alergenos: ['', '   ', 'desconhecido'] }, { alergenos: null }, { alergenos: [] }],
      }),
    ).not.toThrow()
  })

  // ── Loop defensivo: NENHUM par dispara sem entrada no mapa ─────────────────────
  it('um alérgeno fora do mapa nunca dispara, qualquer que seja a restrição declarada', () => {
    for (const restricao of RESTRICOES) {
      const result = decideRestrictionNotices({
        restricoes: [restricao],
        items: [{ alergenos: ['ingrediente_qualquer_sem_mapa'] }],
      })
      expect(result).toEqual({ avisos: [] })
    }
  })
})
