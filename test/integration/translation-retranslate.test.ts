import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setTranslator, setEmbedder } from '@/server/deps'
import {
  FakeTranslator,
  type Translator,
  type TranslateInput,
  type TranslateOutput,
} from '@/server/translation/translator'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { ensureTranslation } from '@/server/recipe/translation'
import { retranslateOutdated } from '@/server/translation/retranslate'
import { sourceFingerprintOf, mtFingerprintOfRow } from '@/domain/translation-fingerprint'
import { TRANSLATION_PROMPT_VERSION } from '@/domain/translation-prompt'
import { recipeTranslation } from '@/db/schema'
import {
  seedRecipe,
  seedTranslation,
  seedRecipeIngredient,
  seedRemovedFromPool,
} from '../helpers/recipes'
import { seedUser } from '../helpers/users'

/**
 * `retranslateOutdated` (issue #499, fatia B do ADR-0031 dec.5) — worker que re-traduz um lote
 * capado das traduções DERIVADAS defasadas-e-intocadas. Espelha o setup de
 * `translation-ensure.test.ts` (mesmo harness Postgres real).
 */

const DIM = 1536

/** Dublê que lança SÓ para as fontes cujo título esteja no conjunto — exercita a degradação
 * POR LINHA (uma Receita falha, o lote continua para as demais). */
class SelectiveThrowingTranslator implements Translator {
  constructor(private readonly failTitles: Set<string>) {}
  async translate(input: TranslateInput): Promise<TranslateOutput> {
    if (this.failTitles.has(input.fields.titulo)) {
      throw new Error('tradutor indisponível (dublê seletivo)')
    }
    return input.ingredientes ? { ...input.fields, ingredientes: input.ingredientes } : input.fields
  }
}

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Receita catálogo com SÓ a tradução de origem pt-BR (sem o 2º locale ainda). */
async function seedOriginOnly(titulo: string): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return recipeId
}

async function readTranslation(db: ReturnType<typeof getDb>, recipeId: string, locale: string) {
  const [row] = await db
    .select()
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)))
  return row
}

async function editSource(db: ReturnType<typeof getDb>, recipeId: string, titulo: string) {
  await db
    .update(recipeTranslation)
    .set({ titulo })
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'pt-BR')))
}

describe('anti-drift (#499 AC extra) — mtFingerprintOfRow/sourceFingerprintOf espelham ensureTranslation', () => {
  it('a linha recém-criada por ensureTranslation é INTOCADA e NÃO-defasada pela comparação do worker', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly('Feijoada')

    const res = await ensureTranslation(db, recipeId, 'en-US')
    expect(res).toEqual({ kind: 'created' })

    const en = await readTranslation(db, recipeId, 'en-US')
    expect(en.mtFingerprint).not.toBeNull()
    expect(en.sourceFingerprint).not.toBeNull()

    // Recomputa mt_fingerprint a partir da LINHA persistida (mesma construção da escrita) — bate:
    // a linha recém-criada é INTOCADA.
    const recomputedMt = mtFingerprintOfRow({
      titulo: en.titulo,
      descricao: en.descricao,
      passos: en.passos,
      notas: en.notas,
      ingredientes: en.ingredientes,
    })
    expect(recomputedMt).toBe(en.mtFingerprint)

    // Recomputa source_fingerprint a partir da fonte ATUAL (pt-BR) + ingredientes atuais (nenhum
    // nesta fixture) — bate: a linha NÃO é defasada, e o prompt_version está em dia.
    const source = await readTranslation(db, recipeId, 'pt-BR')
    const recomputedSource = sourceFingerprintOf(
      { titulo: source.titulo, descricao: source.descricao, passos: source.passos, notas: source.notas },
      [],
    )
    expect(recomputedSource).toBe(en.sourceFingerprint)
    expect(en.promptVersion).toBe(TRANSLATION_PROMPT_VERSION)
  })
})

describe('retranslateOutdated (#499) — defasada-e-intocada re-traduz', () => {
  it('catálogo quieto (nada defasado) ⇒ no-op', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly('Bolo de Milho')
    await ensureTranslation(db, recipeId, 'en-US')

    const result = await retranslateOutdated(db, 10)
    expect(result).toEqual({ retranslated: 0, degraded: 0, remaining: 0 })
  })

  it('re-traduz quando a fonte mudou (defasada) e ninguém editou a MT (intocada); preserva slug e provenance', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly('Feijoada')
    await ensureTranslation(db, recipeId, 'en-US')
    const before = await readTranslation(db, recipeId, 'en-US')

    // Original muda (Curador/dono edita pt-BR) — direto no banco: o modelo PULL deriva a
    // defasagem na varredura, sem gatilho de `decideStale` (nunca espalha, ADR-0031 dec.1).
    await editSource(db, recipeId, 'Feijoada Renovada')

    const result = await retranslateOutdated(db, 10)
    expect(result).toEqual({ retranslated: 1, degraded: 0, remaining: 0 })

    const after = await readTranslation(db, recipeId, 'en-US')
    // FakeTranslator identidade ⇒ o título en-US passa a ecoar o NOVO título pt-BR.
    expect(after.titulo).toBe('Feijoada Renovada')
    expect(after.provenance).toBe('automatica_nao_revisada') // mantida (ADR-0031 dec.5)
    expect(after.slug).toBe(before.slug) // slug CONGELADO — nunca re-derivado (ADR-0020)
    expect(after.promptVersion).toBe(TRANSLATION_PROMPT_VERSION)
    // Volta a ser intocada e não-defasada: os fingerprints refletem o conteúdo novo.
    expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint)
    expect(after.mtFingerprint).not.toBe(before.mtFingerprint)
  })

  it('defasada por prompt_version desatualizado (fonte intacta) ⇒ re-traduz mesmo assim', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly('Receita com prompt velho')
    await ensureTranslation(db, recipeId, 'en-US')

    // Simula tradutor melhorado: a versão gravada fica ATRÁS da TRANSLATION_PROMPT_VERSION atual.
    await db
      .update(recipeTranslation)
      .set({ promptVersion: 0 })
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))

    const result = await retranslateOutdated(db, 10)
    expect(result).toEqual({ retranslated: 1, degraded: 0, remaining: 0 })

    const after = await readTranslation(db, recipeId, 'en-US')
    expect(after.promptVersion).toBe(TRANSLATION_PROMPT_VERSION)
  })

  it('pula quando a MT foi editada à mão (não-intocada), mesmo com a fonte defasada', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly('Feijoada')
    await ensureTranslation(db, recipeId, 'en-US')

    // Fonte muda (defasada)...
    await editSource(db, recipeId, 'Feijoada Renovada')
    // ...MAS o Curador editou a MT à mão: o conteúdo diverge do mt_fingerprint gravado ⇒ não-intocada.
    await db
      .update(recipeTranslation)
      .set({ titulo: 'Curated Feijoada Title' })
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))

    const result = await retranslateOutdated(db, 10)
    expect(result).toEqual({ retranslated: 0, degraded: 0, remaining: 0 })

    const after = await readTranslation(db, recipeId, 'en-US')
    expect(after.titulo).toBe('Curated Feijoada Title') // intocada pelo worker — ZERO escrita
  })

  it('degradação POR LINHA: tradutor lança numa Receita ⇒ pula (fica defasada) e o lote continua', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const okId = await seedOriginOnly('Bolo Simples')
    const failId = await seedOriginOnly('Torta Impossível')
    await ensureTranslation(db, okId, 'en-US')
    await ensureTranslation(db, failId, 'en-US')

    // Ambas ficam defasadas (a fonte muda).
    await editSource(db, okId, 'Bolo Simples v2')
    await editSource(db, failId, 'Torta Impossível v2')

    // Tradutor falha SÓ para a fonte da 'Torta Impossível v2'.
    setTranslator(new SelectiveThrowingTranslator(new Set(['Torta Impossível v2'])))

    const result = await retranslateOutdated(db, 10)
    expect(result).toEqual({ retranslated: 1, degraded: 1, remaining: 1 })

    const ok = await readTranslation(db, okId, 'en-US')
    expect(ok.titulo).toBe('Bolo Simples v2') // re-traduzida com sucesso

    const failed = await readTranslation(db, failId, 'en-US')
    expect(failed.titulo).toBe('Torta Impossível') // ORIGINAL — zero escrita na linha degradada
  })

  it('cap+retomável: limit=1 processa só 1 candidata; a 2ª chamada zera o remaining', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const idA = await seedOriginOnly('Receita A')
    const idB = await seedOriginOnly('Receita B')
    await ensureTranslation(db, idA, 'en-US')
    await ensureTranslation(db, idB, 'en-US')

    await editSource(db, idA, 'Receita A v2')
    await editSource(db, idB, 'Receita B v2')

    const first = await retranslateOutdated(db, 1)
    expect(first.retranslated).toBe(1)
    expect(first.degraded).toBe(0)
    expect(first.remaining).toBe(1)

    const second = await retranslateOutdated(db, 10)
    expect(second).toEqual({ retranslated: 1, degraded: 0, remaining: 0 })

    const a = await readTranslation(db, idA, 'en-US')
    const b = await readTranslation(db, idB, 'en-US')
    expect(a.titulo).toBe('Receita A v2')
    expect(b.titulo).toBe('Receita B v2')
  })

  it('TOCTOU: edição humana concorrente ENTRE o scan e a escrita (muda o jsonb, não o mt_fingerprint) ⇒ NÃO sobrescreve', async () => {
    // Simula a rota do companheiro (iii): o Curador edita o NOME de ingrediente traduzido (jsonb
    // `ingredientes`) SEM tocar o `mt_fingerprint` gravado. Sem a re-verificação em retranslateOne, o
    // worker acharia a linha "intocada" (o fingerprint gravado não mudou) e sobrescreveria a edição.
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    // 1 ingrediente nomeado, p/ o jsonb da linha derivada carregar nome traduzido.
    await seedRecipeIngredient({ recipeId, ordem: 0, rawText: 'farinha' })
    await ensureTranslation(db, recipeId, 'en-US')

    // A linha nasce intocada e com o jsonb {ordem:0, nome:'farinha' (identidade do Fake), nomeOrigem}.
    const created = await readTranslation(db, recipeId, 'en-US')
    expect(created.ingredientes).toEqual([{ ordem: 0, nome: 'farinha', nomeOrigem: 'farinha' }])

    // Fonte muda ⇒ a derivada fica DEFASADA. No scan ela ainda é intocada (o mt_fingerprint bate).
    await editSource(db, recipeId, 'Bolo Renovado')

    // EDIÇÃO CONCORRENTE do Curador: muda o NOME traduzido no jsonb, NÃO o mt_fingerprint gravado.
    await db
      .update(recipeTranslation)
      .set({ ingredientes: [{ ordem: 0, nome: 'wheat flour (curador)', nomeOrigem: 'farinha' }] })
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))

    const result = await retranslateOutdated(db, 10)
    // Pulada (não-intocada agora): zero re-tradução, zero degraded, e SAI de remaining (fila Curador).
    expect(result).toEqual({ retranslated: 0, degraded: 0, remaining: 0 })

    // A edição humana PERMANECE — o worker não a tocou.
    const after = await readTranslation(db, recipeId, 'en-US')
    expect(after.ingredientes).toEqual([{ ordem: 0, nome: 'wheat flour (curador)', nomeOrigem: 'farinha' }])
    expect(after.titulo).toBe('Bolo') // título en-US original, não re-traduzido para 'Bolo Renovado'
  })

  it('só considera traduções DERIVADAS: a tradução de ORIGEM nunca é candidata', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    await seedOriginOnly('Receita sem 2º locale')
    // Sem ensureTranslation: NENHUMA derivada existe ainda. A varredura não deve achar nada
    // (o original pt-BR nunca é candidato — locale === recipe.original_locale).
    const result = await retranslateOutdated(db, 10)
    expect(result).toEqual({ retranslated: 0, degraded: 0, remaining: 0 })
  })

  it('TOCTOU sob lock: edição humana DURANTE a chamada ao tradutor ⇒ commit-sob-lock pula, não sobrescreve', async () => {
    // Janela que o re-check PRÉ-LLM não fecha: a edição concorrente cai DEPOIS do re-check e ANTES do
    // commit (o LLM leva segundos). Só o SELECT ... FOR UPDATE + re-check dentro da transação a detecta.
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Pão', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId, ordem: 0, rawText: 'fermento' })
    setTranslator(new FakeTranslator())
    await ensureTranslation(db, recipeId, 'en-US')

    // Fonte muda ⇒ defasada; no scan E no re-check pré-LLM ainda é intocada.
    await editSource(db, recipeId, 'Pão Renovado')

    // Tradutor que aplica a edição concorrente do Curador DURANTE o translate() (auto-commit, visível
    // ao SELECT FOR UPDATE do commit) — muda o jsonb, NÃO o mt_fingerprint gravado.
    class EditDuringTranslate implements Translator {
      async translate(input: TranslateInput): Promise<TranslateOutput> {
        await db
          .update(recipeTranslation)
          .set({ ingredientes: [{ ordem: 0, nome: 'yeast (curador)', nomeOrigem: 'fermento' }] })
          .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
        return input.ingredientes ? { ...input.fields, ingredientes: input.ingredientes } : input.fields
      }
    }
    setTranslator(new EditDuringTranslate())

    const result = await retranslateOutdated(db, 10)
    expect(result).toEqual({ retranslated: 0, degraded: 0, remaining: 0 }) // pulada NO COMMIT

    const after = await readTranslation(db, recipeId, 'en-US')
    // A edição humana feita durante a tradução PERMANECE — o commit-sob-lock não a sobrescreveu.
    expect(after.ingredientes).toEqual([{ ordem: 0, nome: 'yeast (curador)', nomeOrigem: 'fermento' }])
    expect(after.titulo).toBe('Pão') // título en-US original, não re-traduzido
  })

  it('gate de moderação (#18): Receita removida do pool NÃO é re-traduzida (não reenvia conteúdo moderado)', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly('Receita Moderada')
    await ensureTranslation(db, recipeId, 'en-US')
    await editSource(db, recipeId, 'Receita Moderada v2') // defasada-e-intocada

    // Removida do pool pela moderação (visibility intocada, #18): sai do escopo do worker. Via helper
    // que seta as 3 colunas juntas (respeita recipe_moderation_consistency_chk).
    const curatorId = await seedUser({ email: `mod-${crypto.randomUUID()}@test.local` })
    await seedRemovedFromPool({ recipeId, curatorId })

    const result = await retranslateOutdated(db, 10)
    expect(result).toEqual({ retranslated: 0, degraded: 0, remaining: 0 }) // NÃO selecionada

    const after = await readTranslation(db, recipeId, 'en-US')
    expect(after.titulo).toBe('Receita Moderada') // original en-US, não re-traduzido
  })
})
