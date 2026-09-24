import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setTranslator, setEmbedder } from '@/server/deps'
import { FakeTranslator } from '@/server/translation/translator'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { ensureTranslation } from '@/server/recipe/translation'
import { replaceIngredients } from '@/server/recipe/ingredients'
import { recipeTranslation } from '@/db/schema'
import { TRANSLATION_PROMPT_VERSION } from '@/domain/translation-prompt'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'

/**
 * Nome de ingrediente por-locale (#426, ADR-0030 Fatia 2) — integração:
 *  - `ensureTranslation` persiste `recipe_translation.ingredientes` (jsonb por `ordem`) + `prompt_version`.
 *  - `replaceIngredients` INVALIDA (limpa) o jsonb — o nome não descasa da medida ao editar.
 * A tradução real não é testada (Real* não é unit-testado); usa-se FakeTranslator canned/identidade.
 */

const DIM = 1536

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

async function seedFeijoadaOriginOnly(): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: 'Feijoada',
    descricao: 'Ensopado de feijão-preto.',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId, ordem: 0, quantidade: '3', unidade: 'dente', rawText: 'alho' })
  await seedRecipeIngredient({ recipeId, ordem: 1, quantidade: '500', unidade: 'g', rawText: 'feijão-preto' })
  return recipeId
}

describe('ensureTranslation — nome de ingrediente por-locale (#426)', () => {
  it('persiste ingredientes traduzidos por ordem + prompt_version na linha do 2º locale', async () => {
    // Canned com NOMES traduzidos (prova que o traduzido — não o eco — é persistido).
    setTranslator(
      new FakeTranslator({
        titulo: 'Feijoada',
        descricao: 'Black bean stew.',
        passos: null,
        notas: null,
        ingredientes: [
          { ordem: 0, nome: 'garlic' },
          { ordem: 1, nome: 'black beans' },
        ],
      }),
    )
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedFeijoadaOriginOnly()

    const res = await ensureTranslation(db, recipeId, 'en-US')
    expect(res).toEqual({ kind: 'created' })

    const [en] = await db
      .select({ ingredientes: recipeTranslation.ingredientes, promptVersion: recipeTranslation.promptVersion })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    // Guarda o nome traduzido + o nomeOrigem (raw_text-fonte) p/ o display revalidar contra edições.
    expect(en.ingredientes).toEqual([
      { ordem: 0, nome: 'garlic', nomeOrigem: 'alho' },
      { ordem: 1, nome: 'black beans', nomeOrigem: 'feijão-preto' },
    ])
    expect(en.promptVersion).toBe(TRANSLATION_PROMPT_VERSION)
  })

  it('receita sem ingrediente nomeado ⇒ ingredientes fica NULL (cai no raw_text)', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    // Origin-only SEM recipe_ingredient.
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Água', provenance: 'escrita_por_pessoa' })

    await ensureTranslation(db, recipeId, 'en-US')
    const [en] = await db
      .select({ ingredientes: recipeTranslation.ingredientes })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    expect(en.ingredientes).toBeNull()
  })
})

describe('replaceIngredients — PRESERVA o jsonb (revalidação por nomeOrigem, não invalidação) (#426)', () => {
  it('NÃO zera recipe_translation.ingredientes ao editar — o display revalida por nomeOrigem', async () => {
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId, locale: 'en-US', titulo: 'Black Bean Stew', provenance: 'automatica_nao_revisada' })
    await seedRecipeIngredient({ recipeId, ordem: 0, quantidade: '3', unidade: 'dente', rawText: 'alho' })
    const jsonb = [{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }]
    await db
      .update(recipeTranslation)
      .set({ ingredientes: jsonb })
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))

    // Edita a MEDIDA (mesmo nome) — o jsonb DEVE sobreviver (a revalidação por nomeOrigem no display
    // é que decide usar/descartar o nome traduzido; zerar aqui perderia a tradução em toda edição).
    await replaceIngredients(db, recipeId, [{ rawText: 'alho', quantidade: '5', unidade: 'dente' }])

    const [en] = await db
      .select({ ingredientes: recipeTranslation.ingredientes })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    expect(en.ingredientes).toEqual(jsonb)
  })
})
