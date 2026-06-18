import { describe, it, expect } from 'vitest'
import { decidePostGenerationRestrictionNotices } from '@/domain/recipe-restrictions'
import { RESTRICOES } from '@/domain/vocabulary'

/**
 * Motor PURO do Aviso PÓS-geração (issue #87, endurecimento ADR-0004). Diferente do
 * pré-geração (que parte do que o usuário DECLAROU + alérgenos de catálogo via FK), aqui
 * a entrada é a RECEITA GERADA pelo LLM: `restricoes` que o próprio modelo declarou +
 * `ingredientes[].rawText` LIVRE (sem ingredientId). O alérgeno é detectado casando as
 * PALAVRAS normalizadas do rawText contra as CHAVES de `ALLERGEN_CONTRADICTIONS`.
 *
 * Cobre: match por palavra reusando o vocabulário (87b); pontuação que o LLM emite
 * (FIX do blocker — split por fronteira não-alfanumérica); match por PALAVRA, NUNCA
 * substring ('triângulo'/'integral' não casam 'trigo'); token fora do mapa silencia;
 * rawText vazio/null nunca dispara; dedup por restrição em vários ingredientes; total.
 */

describe('decidePostGenerationRestrictionNotices — Aviso pós-geração (#87)', () => {
  // P1 (87a) — receita gerada com 'farinha de trigo' + restricoes:['sem_gluten'] dispara
  it('P1 sem_gluten + ingrediente "farinha de trigo" ⇒ 1 aviso {sem_gluten, trigo}', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_gluten'],
        ingredientes: [{ rawText: 'farinha de trigo' }],
      }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'trigo' }] })
  })

  // P2 (87a, FIX blocker pontuação) — pontuação do LLM não silencia o Aviso
  it('P2 pontuação ("farinha de trigo." / "leite," / "queijo; trigo") ainda dispara', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_gluten'],
        ingredientes: [{ rawText: 'farinha de trigo.' }],
      }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'trigo' }] })

    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_lactose'],
        ingredientes: [{ rawText: 'leite,' }],
      }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_lactose', alergeno: 'leite' }] })

    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_gluten'],
        ingredientes: [{ rawText: 'queijo; trigo' }],
      }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'trigo' }] })
  })

  // P3 (87b) — match por PALAVRA, nunca substring: 'triângulo'/'integral' não casam 'trigo'
  it('P3 "triângulo"/"integral" NÃO casam "trigo" (palavra, não substring) ⇒ silêncio', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_gluten'],
        ingredientes: [{ rawText: 'triângulo de massa integral' }],
      }),
    ).toEqual({ avisos: [] })
  })

  // P4 (87b) — token fora do mapa silencia
  it('P4 "queijo" (fora do mapa) + sem_gluten ⇒ silêncio', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_gluten'],
        ingredientes: [{ rawText: 'queijo ralado' }],
      }),
    ).toEqual({ avisos: [] })
  })

  // P5 (87b) — rawText vazio/null nunca dispara (ausência ≠ contradição)
  it('P5 rawText "" / null ⇒ silêncio (ausência nunca dispara)', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_gluten'],
        ingredientes: [{ rawText: '' }, { rawText: null }],
      }),
    ).toEqual({ avisos: [] })
  })

  // P6 (87b) — restrição declarada que NÃO bate o ingrediente silencia
  it('P6 vegetariano + "leite" ⇒ silêncio (ovolacto aceita laticínio — D1, reusa o mapa)', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['vegetariano'],
        ingredientes: [{ rawText: 'leite integral' }],
      }),
    ).toEqual({ avisos: [] })
  })

  // P7 (87b) — dedup por restrição em vários ingredientes; delega a decideRestrictionNotices
  it('P7 dois ingredientes com trigo + sem_gluten ⇒ 1 aviso (dedup por restrição)', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_gluten'],
        ingredientes: [{ rawText: 'farinha de trigo' }, { rawText: 'massa de trigo' }],
      }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'trigo' }] })
  })

  // P8 (87b) — laticínio dispara as DUAS restrições (sem_lactose E vegano), 1 por restrição
  it('P8 [sem_lactose,vegano] + "leite" ⇒ 2 avisos (reusa o vocabulário do mapa)', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_lactose', 'vegano'],
        ingredientes: [{ rawText: 'leite condensado' }],
      }),
    ).toEqual({
      avisos: [
        { kind: 'contradicao', restricao: 'sem_lactose', alergeno: 'leite' },
        { kind: 'contradicao', restricao: 'vegano', alergeno: 'leite' },
      ],
    })
  })

  // P9 — token alternativo do mapa (wheat) casa igual; alergeno volta normalizado
  it('P9 sem_gluten + "Wheat Flour" (maiúscula, token inglês) ⇒ 1 aviso {sem_gluten, wheat}', () => {
    expect(
      decidePostGenerationRestrictionNotices({
        restricoes: ['sem_gluten'],
        ingredientes: [{ rawText: 'Wheat Flour' }],
      }),
    ).toEqual({ avisos: [{ kind: 'contradicao', restricao: 'sem_gluten', alergeno: 'wheat' }] })
  })

  // P10 — total / sem throw em qualquer combinação razoável
  it('P10 é total: não lança com rawText vazio/espaços/pontuação/null e todas as restrições', () => {
    expect(() =>
      decidePostGenerationRestrictionNotices({
        restricoes: [...RESTRICOES],
        ingredientes: [{ rawText: '' }, { rawText: '   ' }, { rawText: '!!! ,.;' }, { rawText: null }],
      }),
    ).not.toThrow()
  })

  // P11 — saída locale-neutra (só códigos, nunca mensagem)
  it('P11 cada aviso carrega SÓ códigos (kind/restricao/alergeno) — nunca mensagem', () => {
    const { avisos } = decidePostGenerationRestrictionNotices({
      restricoes: ['sem_gluten'],
      ingredientes: [{ rawText: 'farinha de trigo' }],
    })
    expect(avisos).toHaveLength(1)
    expect(Object.keys(avisos[0]).sort()).toEqual(['alergeno', 'kind', 'restricao'])
  })
})
