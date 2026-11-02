import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setTranslator, setEmbedder } from '@/server/deps'
import {
  FakeTranslator,
  UnusableTranslationError,
  type Translator,
  type TranslateInput,
  type TranslateOutput,
} from '@/server/translation/translator'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { POST as translateRoute } from '@/app/api/recipes/[id]/translations/[locale]/route'
import { ensureTranslation } from '@/server/recipe/translation'
import { quotaHold, recipeTranslation, recipeTranslationAttempt } from '@/db/schema'
import { QUOTA_LOCK_CLASS } from '@/server/quota/atomic'
import {
  TRANSLATION_CAP_BY_ROLE,
  TRANSLATION_FAILURE_COOLDOWN_MS,
  TRANSLATION_INFRA_FAILURE_COOLDOWN_MS,
  TRANSLATION_MAX_INPUT_CHARS,
} from '@/domain/translation-flight'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Guardas de custo da tradução sob demanda (#642, ADR-0056) pela porta mais alta (`POST
 * /api/recipes/[id]/translations/[locale]`): single-flight por (receita, locale), cache negativo de falha, cota por
 * usuário (`quota_hold` kind `translation`) e teto da entrada. O "provedor" é o seam `Translator`: os dublês abaixo
 * contam as chamadas (cada uma seria uma chamada paga ao Claude no `RealTranslator`).
 */

const DIM = 1536

/** Conta as chamadas e responde por `mode`: identidade, falha da linha, ou falha de infraestrutura. */
class CountingTranslator implements Translator {
  calls = 0
  constructor(public mode: 'ok' | 'unusable' | 'infra' = 'ok') {}
  async translate(input: TranslateInput): Promise<TranslateOutput> {
    this.calls++
    return this.respond(input)
  }
  protected async respond(input: TranslateInput): Promise<TranslateOutput> {
    if (this.mode === 'unusable') throw new UnusableTranslationError('tradução truncada (max_tokens)')
    if (this.mode === 'infra') throw new Error('529 overloaded (dublê)')
    return new FakeTranslator().translate(input)
  }
}

/** Como o de cima, mas segura cada chamada até `open()`: deixa o 1º pedido "em voo" enquanto os outros chegam. */
class GatedTranslator extends CountingTranslator {
  private release!: () => void
  private readonly gate = new Promise<void>((r) => {
    this.release = r
  })
  open(): void {
    this.release()
  }
  protected override async respond(input: TranslateInput): Promise<TranslateOutput> {
    await this.gate
    return super.respond(input)
  }
}

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function post(id: string, locale: string, headers?: Headers): Promise<Response> {
  return translateRoute(
    new Request(`http://localhost/api/recipes/${id}/translations/${locale}`, { method: 'POST', headers }),
    { params: Promise.resolve({ id, locale }) },
  )
}

/** Receita PÚBLICA de `ownerId` só com a origem pt-BR: qualquer logado pode pedir a tradução. */
async function seedPublic(ownerId: string, descricao = 'Bolo simples de fubá.'): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Bolo de fubá', descricao, provenance: 'escrita_por_pessoa' })
  return recipeId
}

async function enRows(recipeId: string) {
  return getDb()
    .select({ id: recipeTranslation.id })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
}

async function attemptRow(recipeId: string) {
  const [row] = await getDb()
    .select({
      leaseId: recipeTranslationAttempt.leaseId,
      leaseUntil: recipeTranslationAttempt.leaseUntil,
      failedAt: recipeTranslationAttempt.failedAt,
      retryAt: recipeTranslationAttempt.retryAt,
      failKey: recipeTranslationAttempt.failKey,
    })
    .from(recipeTranslationAttempt)
    .where(and(eq(recipeTranslationAttempt.recipeId, recipeId), eq(recipeTranslationAttempt.locale, 'en-US')))
  return row
}

async function translationHolds(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: quotaHold.id })
    .from(quotaHold)
    .where(and(eq(quotaHold.userId, userId), eq(quotaHold.kind, 'translation')))
  return rows.length
}

/** Espera `cond` (polling curto) — para o teste de concorrência saber quando os outros pedidos já voltaram. */
async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: tempo esgotado')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** Vence o cache negativo do par (como se a janela de cooldown tivesse passado). */
async function expireCooldown(recipeId: string): Promise<void> {
  await getDb()
    .update(recipeTranslationAttempt)
    .set({ retryAt: dsql`now() - interval '1 second'` })
    .where(eq(recipeTranslationAttempt.recipeId, recipeId))
}

describe('#642 single-flight: POSTs simultâneos na mesma (receita, locale)', () => {
  it('N POSTs de usuários diferentes com o 1º em voo ⇒ 1 chamada ao tradutor, 1 linha en-US, 1 reserva', async () => {
    const translator = new GatedTranslator()
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId: ownerId } = await seedSessionHeaders({ email: 'sf-owner@ex.com' })
    const id = await seedPublic(ownerId)
    const N = 6
    const users = await Promise.all(
      Array.from({ length: N }, (_, i) => seedSessionHeaders({ email: `sf-reader-${i}@ex.com` })),
    )

    let done = 0
    const pending = users.map((u) =>
      post(id, 'en-US', u.headers).then((r) => {
        done++
        return r
      }),
    )
    // Os N-1 que perderam a corrida voltam SEM esperar o tradutor (em voo ⇒ view no original).
    await waitFor(() => done === N - 1 && translator.calls === 1)
    translator.open()
    const responses = await Promise.all(pending)

    expect(responses.map((r) => r.status)).toEqual(Array(N).fill(200))
    expect(translator.calls).toBe(1)
    expect(await enRows(id)).toHaveLength(1)
    // Só quem chamou o modelo gastou slot; o estado do par sumiu com o sucesso.
    const holds = await Promise.all(users.map((u) => translationHolds(u.userId)))
    expect(holds.reduce((a, b) => a + b, 0)).toBe(1)
    expect(await attemptRow(id)).toBeUndefined()
  })

  it('Promise.all de N POSTs numa tradução que falha ⇒ 1 chamada, nada gravado, cache negativo ligado', async () => {
    const translator = new GatedTranslator('unusable')
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'sf-fail@ex.com' })
    const id = await seedPublic(userId)
    const N = 5

    let done = 0
    const pending = Array.from({ length: N }, () =>
      post(id, 'en-US', headers).then((r) => {
        done++
        return r
      }),
    )
    await waitFor(() => done === N - 1 && translator.calls === 1)
    translator.open()
    const responses = await Promise.all(pending)

    expect(responses.map((r) => r.status)).toEqual(Array(N).fill(200))
    expect(translator.calls).toBe(1)
    expect(await enRows(id)).toHaveLength(0)
    const row = await attemptRow(id)
    expect(row?.leaseId).toBeNull()
    expect(row?.retryAt).not.toBeNull()
    expect(await translationHolds(userId)).toBe(1)
  })
})

describe('#642 cache negativo: laço de POSTs numa tradução que falha', () => {
  it('falha da LINHA: 10 POSTs ⇒ 1 chamada; cooldown de 24 h; só 1 slot gasto', async () => {
    const translator = new CountingTranslator('unusable')
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'loop-row@ex.com' })
    const id = await seedPublic(userId)

    for (let i = 0; i < 10; i++) {
      const res = await post(id, 'en-US', headers)
      expect(res.status).toBe(200)
      const view = (await res.json()) as { translations: { locale: string }[] }
      expect(view.translations.map((t) => t.locale)).toEqual(['pt-BR'])
    }
    expect(translator.calls).toBe(1)
    expect(await translationHolds(userId)).toBe(1)

    const row = await attemptRow(id)
    expect(row?.failedAt).toBeInstanceOf(Date)
    expect(row!.retryAt!.getTime() - row!.failedAt!.getTime()).toBe(TRANSLATION_FAILURE_COOLDOWN_MS)
    expect(row?.failKey).toMatch(/:v\d+$/)
  })

  it('falha de INFRAESTRUTURA: laço ⇒ 1 chamada, com cooldown curto (10 min)', async () => {
    const translator = new CountingTranslator('infra')
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'loop-infra@ex.com' })
    const id = await seedPublic(userId)

    for (let i = 0; i < 5; i++) expect((await post(id, 'en-US', headers)).status).toBe(200)
    expect(translator.calls).toBe(1)
    const row = await attemptRow(id)
    expect(row!.retryAt!.getTime() - row!.failedAt!.getTime()).toBe(TRANSLATION_INFRA_FAILURE_COOLDOWN_MS)
  })

  it('cooldown vencido ⇒ o próximo POST tenta de novo; o sucesso grava a tradução e apaga o estado do par', async () => {
    const translator = new CountingTranslator('unusable')
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'loop-expire@ex.com' })
    const id = await seedPublic(userId)

    await post(id, 'en-US', headers)
    await post(id, 'en-US', headers)
    expect(translator.calls).toBe(1)

    await expireCooldown(id)
    translator.mode = 'ok'
    expect((await post(id, 'en-US', headers)).status).toBe(200)
    expect(translator.calls).toBe(2)
    expect(await enRows(id)).toHaveLength(1)
    expect(await attemptRow(id)).toBeUndefined()
    expect(await translationHolds(userId)).toBe(2)
  })

  it('cooldown vencido e nova falha ⇒ mais 1 chamada só, e o cooldown recomeça', async () => {
    const translator = new CountingTranslator('unusable')
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'loop-again@ex.com' })
    const id = await seedPublic(userId)

    await post(id, 'en-US', headers)
    await expireCooldown(id)
    for (let i = 0; i < 5; i++) await post(id, 'en-US', headers)
    expect(translator.calls).toBe(2)
    const row = await attemptRow(id)
    expect(row!.retryAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('fonte editada (chave nova, a mesma do circuit-breaker #520) ⇒ tenta de novo dentro do cooldown', async () => {
    const translator = new CountingTranslator('unusable')
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'loop-edit@ex.com' })
    const id = await seedPublic(userId)

    await post(id, 'en-US', headers)
    await post(id, 'en-US', headers)
    expect(translator.calls).toBe(1)

    await getDb()
      .update(recipeTranslation)
      .set({ descricao: 'Bolo de fubá cremoso, revisado.' })
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'pt-BR')))
    await post(id, 'en-US', headers)
    expect(translator.calls).toBe(2)
    await post(id, 'en-US', headers)
    expect(translator.calls).toBe(2)
  })

  it('caminho interno (sem cota) também respeita o cache negativo e não reserva slot', async () => {
    const translator = new CountingTranslator('unusable')
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId } = await seedSessionHeaders({ email: 'internal@ex.com' })
    const id = await seedPublic(userId)

    expect(await ensureTranslation(getDb(), id, 'en-US')).toEqual({ kind: 'degraded' })
    expect(await ensureTranslation(getDb(), id, 'en-US')).toEqual({ kind: 'cooling_down' })
    expect(translator.calls).toBe(1)
    const [{ n }] = await getDb().select({ n: dsql<number>`count(*)::int` }).from(quotaHold)
    expect(n).toBe(0)
  })
})

describe('#642 lease', () => {
  it('lease valendo (outro pedido em voo) ⇒ 200 sem chamar o modelo nem gastar slot', async () => {
    const translator = new CountingTranslator()
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'lease-busy@ex.com' })
    const id = await seedPublic(userId)
    await getDb()
      .insert(recipeTranslationAttempt)
      .values({ recipeId: id, locale: 'en-US', leaseId: crypto.randomUUID(), leaseUntil: dsql`now() + interval '1 minute'` })

    expect((await post(id, 'en-US', headers)).status).toBe(200)
    expect(translator.calls).toBe(0)
    expect(await translationHolds(userId)).toBe(0)
  })

  it('lease vencido (função morta no meio) ⇒ o próximo POST toma o voo e traduz', async () => {
    const translator = new CountingTranslator()
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'lease-dead@ex.com' })
    const id = await seedPublic(userId)
    await getDb()
      .insert(recipeTranslationAttempt)
      .values({ recipeId: id, locale: 'en-US', leaseId: crypto.randomUUID(), leaseUntil: dsql`now() - interval '1 second'` })

    expect((await post(id, 'en-US', headers)).status).toBe(200)
    expect(translator.calls).toBe(1)
    expect(await enRows(id)).toHaveLength(1)
  })

  it('fila da lock do par cheia (lock_timeout) ⇒ 429 limite_traducao, nunca 500', async () => {
    const translator = new CountingTranslator()
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'lease-lock@ex.com' })
    const id = await seedPublic(userId)

    // Uma 2ª conexão segura a lock do par enquanto o POST espera (até o lock_timeout de 5 s).
    let releaseLock!: () => void
    const held = new Promise<void>((r) => {
      releaseLock = r
    })
    let locked!: () => void
    const isLocked = new Promise<void>((r) => {
      locked = r
    })
    const holder = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${QUOTA_LOCK_CLASS.translationFlight}::int, hashtext(${`${id}:en-US`}))`
      locked()
      await held
    })
    await isLocked
    try {
      const res = await post(id, 'en-US', headers)
      expect(res.status).toBe(429)
      expect(await res.json()).toMatchObject({ error: 'limite_traducao' })
    } finally {
      releaseLock()
      await holder
    }
    expect(translator.calls).toBe(0)
  })
})

describe('#642 cota por usuário', () => {
  async function fillTranslationQuota(userId: string, n: number): Promise<void> {
    await getDb()
      .insert(quotaHold)
      .values(
        Array.from({ length: n }, () => ({
          userId,
          kind: 'translation',
          expiresAt: dsql`now() + interval '23 hours'`,
        })),
      )
  }

  it('cota cheia ⇒ 429 limite_traducao com retryAfterMs; sem chamada, sem lease, sem reserva nova', async () => {
    const translator = new CountingTranslator()
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId: ownerId } = await seedSessionHeaders({ email: 'cap-owner@ex.com' })
    const id = await seedPublic(ownerId)
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-reader@ex.com' })
    const cap = TRANSLATION_CAP_BY_ROLE.usuario!
    await fillTranslationQuota(userId, cap)

    const res = await post(id, 'en-US', headers)
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_traducao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
    expect(translator.calls).toBe(0)
    expect(await attemptRow(id)).toBeUndefined() // a tx do claim reverteu: nem lease
    expect(await translationHolds(userId)).toBe(cap)

    // Outro usuário (com cota) traduz normalmente: a cota é por usuário.
    const { headers: other } = await seedSessionHeaders({ email: 'cap-other@ex.com' })
    expect((await post(id, 'en-US', other)).status).toBe(200)
    expect(translator.calls).toBe(1)
  })

  it('cota no último slot: traduz uma vez e a próxima receita dá 429', async () => {
    const translator = new CountingTranslator()
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId: ownerId } = await seedSessionHeaders({ email: 'cap-last-owner@ex.com' })
    const a = await seedPublic(ownerId)
    const b = await seedPublic(ownerId)
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-last@ex.com' })
    await fillTranslationQuota(userId, TRANSLATION_CAP_BY_ROLE.usuario! - 1)

    expect((await post(a, 'en-US', headers)).status).toBe(200)
    expect((await post(b, 'en-US', headers)).status).toBe(429)
    expect(translator.calls).toBe(1)
    // A tradução já gravada não gasta slot nem esbarra na cota.
    expect((await post(a, 'en-US', headers)).status).toBe(200)
  })

  it('admin (∞) traduz sem reserva; single-flight e cache valem igual', async () => {
    const translator = new CountingTranslator('unusable')
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId: ownerId } = await seedSessionHeaders({ email: 'cap-admin-owner@ex.com' })
    const id = await seedPublic(ownerId)
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-admin@ex.com', role: 'admin' })

    await post(id, 'en-US', headers)
    await post(id, 'en-US', headers)
    expect(translator.calls).toBe(1)
    expect(await translationHolds(userId)).toBe(0)
  })
})

describe('#642 teto da entrada', () => {
  it('fonte acima de TRANSLATION_MAX_INPUT_CHARS ⇒ 200 no original, sem chamada, sem lease, sem slot', async () => {
    const translator = new CountingTranslator()
    setTranslator(translator)
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'big@ex.com' })
    const id = await seedPublic(userId, 'x'.repeat(TRANSLATION_MAX_INPUT_CHARS + 1))

    const res = await post(id, 'en-US', headers)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { translations: { locale: string }[] }
    expect(view.translations.map((t) => t.locale)).toEqual(['pt-BR'])
    expect(translator.calls).toBe(0)
    expect(await attemptRow(id)).toBeUndefined()
    expect(await translationHolds(userId)).toBe(0)
    expect(await ensureTranslation(getDb(), id, 'en-US')).toEqual({ kind: 'too_large' })
  })
})
