import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST } from '@/app/api/recipes/[id]/clear-attribution/route'
import { getDb } from '@/server/deps'
import { recipe, dsarAuditEvent } from '@/db/schema'
import type { RecipeView } from '@/domain/recipe-read'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Remover o nome da fonte (#272 LGPD, ADR-0019) pela porta MAIS ALTA (POST /api/recipes/[id]/
 * clear-attribution). Owner-gated 404-leak-safe (ADR-0011, NUNCA 403): zera SÓ `source_name` (a
 * atribuição cai pro host; `source_url` + `origin` ficam), idempotente (no-op não bumpa updatedAt).
 */

const SRC = 'https://exemplo.com/receitas/bolo'

function clearPost(id: string, headers?: Headers): Promise<Response> {
  return POST(new Request(`http://localhost/api/recipes/${id}/clear-attribution`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}

/** Semeia uma importada do `owner` com atribuição (sourceUrl/sourceName) — seedRecipe não tem esses campos. */
async function seedImported(input: { ownerId: string; sourceName: string | null; sourceUrl: string | null }): Promise<string> {
  const id = await seedRecipe({ origin: 'web_imported', originalLocale: 'pt-BR', visibility: 'private', ownerId: input.ownerId })
  await getDb().update(recipe).set({ sourceUrl: input.sourceUrl, sourceName: input.sourceName }).where(eq(recipe.id, id))
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo Importado', provenance: 'automatica_nao_revisada', slug: 'bolo-importado' })
  return id
}

async function loadSource(id: string) {
  const [row] = await getDb()
    .select({ origin: recipe.origin, sourceName: recipe.sourceName, sourceUrl: recipe.sourceUrl, updatedAt: recipe.updatedAt })
    .from(recipe)
    .where(eq(recipe.id, id))
  return row
}

/** Eventos de auditoria DSAR (#395, GAP-5) gravados por um ator — cada teste usa um usuário fresco. */
async function loadDsarEventsByActor(actorId: string) {
  return getDb()
    .select({
      eventType: dsarAuditEvent.eventType,
      channel: dsarAuditEvent.channel,
      requestType: dsarAuditEvent.requestType,
      payloadHash: dsarAuditEvent.payloadHash,
      reason: dsarAuditEvent.reason,
      verificationMethod: dsarAuditEvent.verificationMethod,
      details: dsarAuditEvent.details,
    })
    .from(dsarAuditEvent)
    .where(eq(dsarAuditEvent.actorId, actorId))
}

describe('POST /api/recipes/[id]/clear-attribution (#272 LGPD)', () => {
  it('dono de web_imported com nome humano → 200; zera sourceName (url + origin preservados); view.source sem name', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'clear-ok@ex.com' })
    const id = await seedImported({ ownerId: userId, sourceName: 'Cozinha da Vovó', sourceUrl: SRC })

    const res = await clearPost(id, headers)
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view.origin).toBe('web_imported')
    expect(view.source).toEqual({ url: SRC }) // name removido ⇒ atribuição cai pro host

    const row = await loadSource(id)
    expect(row.sourceName).toBeNull()
    expect(row.sourceUrl).toBe(SRC) // URL PRESERVADA
    expect(row.origin).toBe('web_imported') // NUNCA toca origin
  })

  it('remoção EFETIVA grava exatamente 1 DSAR_FULFILLED com hash — e NUNCA o nome em claro (#395)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'clear-audit@ex.com' })
    const NAME = 'Cozinha da Vovó'
    const id = await seedImported({ ownerId: userId, sourceName: NAME, sourceUrl: SRC })

    expect((await clearPost(id, headers)).status).toBe(200)

    const events = await loadDsarEventsByActor(userId)
    expect(events).toHaveLength(1) // exatamente 1 evento pela remoção efetiva
    const [ev] = events
    expect(ev.eventType).toBe('DSAR_FULFILLED')
    expect(ev.channel).toBe('self_service')
    expect(ev.requestType).toBe('name_removal')
    expect(ev.reason).toBeNull()
    expect(ev.verificationMethod).toBeNull()
    expect(ev.payloadHash).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex
    expect(ev.details).toEqual({ recipeIds: [id] }) // só ids internos (não-sensíveis)

    // MINIMIZAÇÃO: o nome removido não aparece em NENHUM campo do registro (nem no hash literal).
    expect(JSON.stringify(ev)).not.toContain(NAME)
  })

  it('não-dono → 404 leak-safe; sourceName INALTERADO', async () => {
    const { userId } = await seedSessionHeaders({ email: 'clear-owner@ex.com' })
    const id = await seedImported({ ownerId: userId, sourceName: 'Cozinha da Vovó', sourceUrl: SRC })
    const { headers: intruso } = await seedSessionHeaders({ email: 'clear-intruso@ex.com' })

    const res = await clearPost(id, intruso)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('not_found')
    expect((await loadSource(id)).sourceName).toBe('Cozinha da Vovó') // nem vaza nem muta
  })

  it('catálogo (ownerId NULL) → 404 (ninguém é dono)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'clear-catalog@ex.com' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', visibility: 'public', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Catálogo', provenance: 'automatica_nao_revisada', slug: 'catalogo-x' })

    expect((await clearPost(id, headers)).status).toBe(404)
  })

  it('id inexistente (uuid válido sem linha) → 404; id malformado → 404 (antes do DB)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'clear-404@ex.com' })
    expect((await clearPost('00000000-0000-4000-8000-000000000000', headers)).status).toBe(404)
    expect((await clearPost('nao-uuid', headers)).status).toBe(404)
  })

  it('anon (sem sessão) → 401, zero efeito', async () => {
    const { userId } = await seedSessionHeaders({ email: 'clear-anon@ex.com' })
    const id = await seedImported({ ownerId: userId, sourceName: 'Cozinha da Vovó', sourceUrl: SRC })

    const res = await clearPost(id) // sem headers de sessão
    expect(res.status).toBe(401)
    expect((await loadSource(id)).sourceName).toBe('Cozinha da Vovó') // intacto
  })

  it('idempotente: 2ª remoção (sourceName já null) → 200 no-op, SEM bump de updatedAt', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'clear-idem@ex.com' })
    const id = await seedImported({ ownerId: userId, sourceName: 'Cozinha da Vovó', sourceUrl: SRC })

    expect((await clearPost(id, headers)).status).toBe(200) // 1ª: limpa
    const afterFirst = await loadSource(id)
    expect(afterFirst.sourceName).toBeNull()

    expect((await clearPost(id, headers)).status).toBe(200) // 2ª: no-op
    const afterSecond = await loadSource(id)
    expect(afterSecond.sourceName).toBeNull()
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt) // no-op NÃO bumpa updatedAt

    // #395: só a 1ª remoção (efetiva) audita; o no-op idempotente NÃO gera evento espúrio.
    expect(await loadDsarEventsByActor(userId)).toHaveLength(1)
  })

  it('importada cujo sourceName JÁ é o host (fallback www) → 200 no-op, sourceName e updatedAt INALTERADOS', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'clear-hostname@ex.com' })
    // O parser de import grava `new URL(url).host` (com www) como sourceName quando não há publisher.
    const id = await seedImported({ ownerId: userId, sourceName: 'www.exemplo.com', sourceUrl: 'https://www.exemplo.com/r' })

    const res = await clearPost(id, headers)
    expect(res.status).toBe(200) // dono ⇒ ok, mas nada humano a remover (nome == host)
    const row = await loadSource(id)
    expect(row.sourceName).toBe('www.exemplo.com') // INALTERADO (no-op)

    expect(await loadDsarEventsByActor(userId)).toHaveLength(0) // #395: no-op não audita
  })

  it('dono de receita NÃO importada (ai_structured) → 200 no-op; origin intacto', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'clear-ai@ex.com' })
    const id = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: userId })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'IA', provenance: 'automatica_nao_revisada', slug: 'ia-x' })

    const res = await clearPost(id, headers)
    expect(res.status).toBe(200) // dono ⇒ ok, mas nada a limpar (não é web_imported)
    expect((await loadSource(id)).origin).toBe('ai_structured')

    expect(await loadDsarEventsByActor(userId)).toHaveLength(0) // #395: não-importada não audita
  })
})
