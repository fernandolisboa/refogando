import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { getDb, setEmbedder } from '@/server/deps'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { embedTranslation } from '@/server/embedding/recompute'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'

/**
 * Texto embedado inclui nomes de ingrediente por-locale (#497, ADR-0031 Companheiro ii): hoje
 * `embedTranslation` indexava só `titulo + descricao` — a Busca semântica não achava "receita com
 * grão-de-bico" quando o termo só aparecia na lista de ingredientes. Prova, com `FakeEmbedder`
 * CAPTURANDO o texto (mesmo padrão de `search-semantica.test.ts`), que:
 *  - o nome traduzido entra quando `nomeOrigem` bate com o `raw_text` ATUAL do ingrediente;
 *  - cai no `raw_text` quando não há tradução OU o item foi renomeado desde a tradução
 *    (`nomeOrigem` diverge) — MESMA regra do display (`resolveRecipeView`), reusada via
 *    `resolveIngredientName`;
 *  - a MEDIDA (quantidade/unidade) nunca entra no texto (Direção B).
 */

const DIM = 1536

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

async function embedAndCapture(recipeId: string, locale: string): Promise<string> {
  let captured = ''
  setEmbedder(new FakeEmbedder(DIM, (text) => {
    captured = text
    return new Array(DIM).fill(0)
  }))
  const r = await embedTranslation(getDb(), recipeId, locale)
  expect(r.ok).toBe(true)
  return captured
}

describe('embedTranslation — nomes de ingrediente por-locale no texto embedado (#497)', () => {
  it('inclui o nome TRADUZIDO (nomeOrigem bate com o raw_text atual) — medida fora', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Chickpea stew',
      descricao: 'A hearty stew.',
      provenance: 'automatica_nao_revisada',
      ingredientes: [{ ordem: 0, nome: 'chickpeas', nomeOrigem: 'grão-de-bico' }],
    })
    await seedRecipeIngredient({
      recipeId,
      ordem: 0,
      quantidade: '2',
      unidade: 'xicara',
      rawText: 'grão-de-bico',
    })

    const text = await embedAndCapture(recipeId, 'en-US')

    expect(text).toBe('Chickpea stew A hearty stew. chickpeas')
    // A medida (quantidade/unidade) nunca aparece no texto embedado (Direção B).
    expect(text).not.toContain('xicara')
    expect(text).not.toContain('2')
  })

  it('cai no raw_text quando o ingrediente foi renomeado desde a tradução (nomeOrigem diverge)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Onion soup',
      descricao: null,
      provenance: 'automatica_nao_revisada',
      // Tradução feita quando o raw_text era "cebola" — mas o ingrediente foi renomeado p/ "alho-poró".
      ingredientes: [{ ordem: 0, nome: 'onion', nomeOrigem: 'cebola' }],
    })
    await seedRecipeIngredient({ recipeId, ordem: 0, quantidade: '1', unidade: 'unidade', rawText: 'alho-poró' })

    const text = await embedAndCapture(recipeId, 'en-US')

    // Nunca o nome traduzido ERRADO ("onion") ao lado do ingrediente atual — cai no raw_text.
    expect(text).toBe('Onion soup alho-poró')
    expect(text).not.toContain('onion')
  })

  it('sem tradução de ingredientes (jsonb NULL) ⇒ cai no raw_text de todos os itens', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Sopa de cebola',
      descricao: 'Sopa clássica.',
      provenance: 'escrita_por_pessoa',
    })
    await seedRecipeIngredient({ recipeId, ordem: 0, quantidade: '1', unidade: 'unidade', rawText: 'cebola' })
    await seedRecipeIngredient({ recipeId, ordem: 1, quantidade: '2', unidade: 'l', rawText: 'caldo' })

    const text = await embedAndCapture(recipeId, 'pt-BR')

    expect(text).toBe('Sopa de cebola Sopa clássica. cebola caldo')
  })

  it('sem ingredientes na receita ⇒ texto idêntico ao pré-#497 (titulo + descricao)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Água com gás',
      descricao: null,
      provenance: 'escrita_por_pessoa',
    })

    const text = await embedAndCapture(recipeId, 'pt-BR')

    expect(text).toBe('Água com gás')
  })
})
