import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { GET, PATCH, POST } from '@/app/api/admin/vocabulary/route'
import { __clearVocabularyCache, loadVocabulary } from '@/server/vocabulary/load'
import { getDb } from '@/server/deps'
import { vocabularyTerm, recipe } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe } from '../helpers/recipes'

/**
 * CRUD admin da taxonomia de cozinhas (#321, ADR-0025: curadoria PROATIVA). Contra Postgres
 * real + sessões reais (prior art admin-config/roles). Prova:
 *  - gating: usuario/curador → 403, anon → 401, admin → 200.
 *  - add nasce 'active'; conflito → 409 limpo (não 500); slug/rótulos inválidos → 400.
 *  - editar rótulos NUNCA toca o slug; depreciar/reativar = flip de status.
 *  - FRONTEIRA proativa×reativa: uma linha 'suggested'/'merged'/'rejected' não é mutável por
 *    aqui (404 nao_encontrado) — o Admin não aprova UGC nem revive tombstone fora da fila.
 *  - depreciar não perde dados: a receita gravada ainda é selecionável + o rótulo segue no
 *    scope 'display'.
 *
 * CACHE: a rota NÃO busta o TTL de 30s de loadVocabulary; limpamos o Map à mão entre escrita
 * e leitura cacheada (o truncate global apaga LINHAS, não o Map).
 */

beforeEach(() => __clearVocabularyCache())
afterEach(() => __clearVocabularyCache())

function get(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/admin/vocabulary', { headers }))
}
function post(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/admin/vocabulary', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}
function patch(body: unknown, headers?: Headers): Promise<Response> {
  return PATCH(
    new Request('http://localhost/api/admin/vocabulary', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

async function adminHeaders(email: string): Promise<Headers> {
  const { headers } = await seedSessionHeaders({ email, role: 'admin' })
  return headers
}

/** Lê o status atual de um slug direto no DB (para asserir que NÃO mudou). */
async function statusOf(slug: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ status: vocabularyTerm.status })
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, slug)))
  return row?.status
}

describe('/api/admin/vocabulary — gating (admin-only)', () => {
  it('usuario → 403 em GET/POST/PATCH', async () => {
    const { headers } = await seedSessionHeaders({ email: 'u@vocab.test', role: 'usuario' })
    expect((await get(headers)).status).toBe(403)
    expect((await post({ slug: 'x', labelPtBr: 'X', labelEnUs: 'X' }, headers)).status).toBe(403)
    expect((await patch({ slug: 'italiana', status: 'deprecated' }, headers)).status).toBe(403)
  })

  it('curador → 403 (autoria proativa é só do Admin)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'c@vocab.test', role: 'curador' })
    expect((await get(headers)).status).toBe(403)
    expect((await post({ slug: 'x', labelPtBr: 'X', labelEnUs: 'X' }, headers)).status).toBe(403)
    expect((await patch({ slug: 'italiana', status: 'deprecated' }, headers)).status).toBe(403)
  })

  it('anon → 401 em GET/POST/PATCH', async () => {
    expect((await get()).status).toBe(401)
    expect((await post({ slug: 'x', labelPtBr: 'X', labelEnUs: 'X' })).status).toBe(401)
    expect((await patch({ slug: 'italiana', status: 'deprecated' })).status).toBe(401)
  })

  it('admin → 200 no GET, lista as cozinhas-baseline (com status)', async () => {
    const headers = await adminHeaders('a@vocab.test')
    const res = await get(headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cozinhas: Array<{ slug: string; status: string }> }
    expect(body.cozinhas.find((c) => c.slug === 'italiana')).toMatchObject({ status: 'active' })
  })
})

describe('/api/admin/vocabulary — adicionar', () => {
  it('add nasce active e aparece em loadVocabulary("active") após limpar o cache', async () => {
    const headers = await adminHeaders('add@vocab.test')
    const res = await post({ slug: 'coreana', labelPtBr: 'Coreana', labelEnUs: 'Korean' }, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cozinha: { slug: string; status: string } }
    expect(body.cozinha).toMatchObject({ slug: 'coreana', status: 'active' })

    __clearVocabularyCache()
    const active = await loadVocabulary(getDb(), 'cozinha', 'active')
    expect(active.map((r) => r.slug)).toContain('coreana')
  })

  it('slug duplicado → 409 slug_em_uso (limpo, não 500)', async () => {
    const headers = await adminHeaders('dup@vocab.test')
    const res = await post({ slug: 'italiana', labelPtBr: 'X', labelEnUs: 'X' }, headers)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'slug_em_uso' })
  })

  it('slug não-canônico ou vazio → 400 slug_invalido', async () => {
    const headers = await adminHeaders('badslug@vocab.test')
    expect((await post({ slug: 'Não Slug', labelPtBr: 'X', labelEnUs: 'X' }, headers)).status).toBe(
      400,
    )
    const res = await post({ slug: '', labelPtBr: 'X', labelEnUs: 'X' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'slug_invalido' })
  })

  it('rótulo em branco → 400 rotulos_invalidos', async () => {
    const headers = await adminHeaders('badlabel@vocab.test')
    const res = await post({ slug: 'nova', labelPtBr: '   ', labelEnUs: 'New' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'rotulos_invalidos' })
  })
})

describe('/api/admin/vocabulary — editar rótulos', () => {
  it('PATCH muda rótulos; slug inalterado; loadVocabulary("display") reflete', async () => {
    const headers = await adminHeaders('edit@vocab.test')
    const res = await patch({ slug: 'italiana', labelPtBr: 'Italianíssima' }, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cozinha: { slug: string; labelPtBr: string } }
    expect(body.cozinha).toMatchObject({ slug: 'italiana', labelPtBr: 'Italianíssima' })

    __clearVocabularyCache()
    const display = await loadVocabulary(getDb(), 'cozinha', 'display')
    expect(display.find((r) => r.slug === 'italiana')?.labelPtBr).toBe('Italianíssima')
  })

  it('PATCH com rótulo em branco numa cozinha que existe → 400 rotulos_invalidos (não 404)', async () => {
    const headers = await adminHeaders('blanklabel@vocab.test')
    const res = await patch({ slug: 'italiana', labelPtBr: '   ' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'rotulos_invalidos' })
    // O rótulo NÃO foi sobrescrito (a função retorna antes do UPDATE).
    __clearVocabularyCache()
    const display = await loadVocabulary(getDb(), 'cozinha', 'display')
    expect(display.find((r) => r.slug === 'italiana')?.labelPtBr).toBe('Italiana')
  })

  it('PATCH sem campo mutante → 400 dados_invalidos', async () => {
    const headers = await adminHeaders('nodata@vocab.test')
    const res = await patch({ slug: 'italiana' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
  })

  it('PATCH status fora de {active,deprecated} → 400 status_invalido', async () => {
    const headers = await adminHeaders('badstatus@vocab.test')
    const res = await patch({ slug: 'italiana', status: 'suggested' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'status_invalido' })
  })
})

describe('/api/admin/vocabulary — FRONTEIRA proativa×reativa (#319/#320 protegidas)', () => {
  async function insertSuggested(slug: string, status: 'suggested' | 'merged' | 'rejected') {
    await getDb()
      .insert(vocabularyTerm)
      .values({ kind: 'cozinha', slug, status, labelPtBr: slug, labelEnUs: slug })
  }

  it('PATCH status="active" numa sugestão → 404 e a linha PERMANECE suggested (não aprovada)', async () => {
    const headers = await adminHeaders('sug1@vocab.test')
    await insertSuggested('proposta-a', 'suggested')
    const res = await patch({ slug: 'proposta-a', status: 'active' }, headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_encontrado' })
    expect(await statusOf('proposta-a')).toBe('suggested')
  })

  it('PATCH labelPtBr numa sugestão → 404 e os rótulos NÃO mudam', async () => {
    const headers = await adminHeaders('sug2@vocab.test')
    await insertSuggested('proposta-b', 'suggested')
    const res = await patch({ slug: 'proposta-b', labelPtBr: 'Roubada' }, headers)
    expect(res.status).toBe(404)
    const [row] = await getDb()
      .select({ labelPtBr: vocabularyTerm.labelPtBr })
      .from(vocabularyTerm)
      .where(eq(vocabularyTerm.slug, 'proposta-b'))
    expect(row?.labelPtBr).toBe('proposta-b')
  })

  it('PATCH status numa linha merged/rejected → 404 (não revive tombstone)', async () => {
    const headers = await adminHeaders('tomb@vocab.test')
    await insertSuggested('fundida', 'merged')
    await insertSuggested('recusada', 'rejected')
    expect((await patch({ slug: 'fundida', status: 'active' }, headers)).status).toBe(404)
    expect((await patch({ slug: 'recusada', status: 'active' }, headers)).status).toBe(404)
    expect(await statusOf('fundida')).toBe('merged')
    expect(await statusOf('recusada')).toBe('rejected')
  })
})

describe('/api/admin/vocabulary — depreciar não perde dados', () => {
  it('depreciar tira do scope active mas mantém no display; a receita gravada segue selecionável', async () => {
    const headers = await adminHeaders('depr@vocab.test')

    // Receita usando 'mexicana' ANTES de depreciar (FK ON DELETE restrict; depreciar não a quebra).
    await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', cozinha: 'mexicana' })

    const res = await patch({ slug: 'mexicana', status: 'deprecated' }, headers)
    expect(res.status).toBe(200)

    __clearVocabularyCache()
    const active = await loadVocabulary(getDb(), 'cozinha', 'active')
    const display = await loadVocabulary(getDb(), 'cozinha', 'display')
    expect(active.map((r) => r.slug)).not.toContain('mexicana')
    expect(display.map((r) => r.slug)).toContain('mexicana')
    // Rótulo ainda renderiza no acervo (display carrega a depreciada).
    expect(display.find((r) => r.slug === 'mexicana')?.labelPtBr).toBe('Mexicana')

    // Filtro DATA-LEVEL: a receita gravada segue selecionável pela coluna cozinha (FK intacta).
    const rows = await getDb()
      .select({ id: recipe.id })
      .from(recipe)
      .where(eq(recipe.cozinha, 'mexicana'))
    expect(rows.length).toBe(1)

    // Reativar restaura ao scope active.
    expect((await patch({ slug: 'mexicana', status: 'active' }, headers)).status).toBe(200)
    __clearVocabularyCache()
    const active2 = await loadVocabulary(getDb(), 'cozinha', 'active')
    expect(active2.map((r) => r.slug)).toContain('mexicana')
  })
})
