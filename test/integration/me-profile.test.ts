import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { GET, PATCH } from '@/app/api/me/route'
import { getDb } from '@/server/deps'
import { recipe, users } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedFeijoadaCatalog } from '../helpers/recipes'

/**
 * Round-trip do perfil do logado — primeira fatia da frente Perfil (#124). Estabelece o
 * contrato `/api/me`: GET devolve { id, name, email, bio }; PATCH atualiza name + bio.
 *
 * Owner-only via requireSession (ADR-0011): Visitante (sem sessão) → 401; conta soft-deletada
 * (deletedAt != null) → 401. email é READ-ONLY (PATCH nunca o muda). bio tem cap de tamanho
 * no app (≈280); name é trimado e não pode ficar vazio.
 */

function get(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/me', { headers }))
}
function patch(body: unknown, headers?: Headers): Promise<Response> {
  return PATCH(
    new Request('http://localhost/api/me', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

/** Lê a linha de users diretamente (provar persistência). */
async function readUser(id: string) {
  const [row] = await getDb()
    .select({ name: users.name, email: users.email, bio: users.bio })
    .from(users)
    .where(eq(users.id, id))
  return row
}

/** Contagem total de Receitas (provar que editar perfil NÃO toca recipe). */
async function countRecipes(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(recipe)
  return row?.n ?? 0
}

describe('/api/me — round-trip do perfil do logado (#124)', () => {
  it('sem sessão (Visitante) → 401 nao_autenticado em GET e PATCH', async () => {
    const getRes = await get()
    expect(getRes.status).toBe(401)
    await expect(getRes.json()).resolves.toMatchObject({ error: 'nao_autenticado' })

    const patchRes = await patch({ name: 'Ana', bio: 'oi' })
    expect(patchRes.status).toBe(401)
    await expect(patchRes.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('conta soft-deletada (deletedAt != null) → 401 conta_desativada em GET e PATCH', async () => {
    const { headers } = await seedSessionHeaders({
      email: 'apagado@me-profile.test',
      deletedAt: new Date(),
    })

    const getRes = await get(headers)
    expect(getRes.status).toBe(401)
    await expect(getRes.json()).resolves.toMatchObject({ error: 'conta_desativada' })

    const patchRes = await patch({ name: 'Ana', bio: 'oi' }, headers)
    expect(patchRes.status).toBe(401)
    await expect(patchRes.json()).resolves.toMatchObject({ error: 'conta_desativada' })
  })

  it('GET devolve { id, name, email, bio } do usuário atual', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'eu@me-profile.test' })

    const res = await get(headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      id: userId,
      name: 'eu@me-profile.test', // o helper usa o email como name default
      email: 'eu@me-profile.test',
      bio: null,
    })
  })

  it('PATCH atualiza name + bio → 200, persiste, e um GET subsequente relê os novos valores', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'rw@me-profile.test' })

    const res = await patch({ name: 'Maria Silva', bio: 'Cozinheira amadora.' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      id: userId,
      name: 'Maria Silva',
      email: 'rw@me-profile.test',
      bio: 'Cozinheira amadora.',
    })

    // Persistiu no banco.
    expect(await readUser(userId)).toEqual({
      name: 'Maria Silva',
      email: 'rw@me-profile.test',
      bio: 'Cozinheira amadora.',
    })

    // Round-trip: nova Request de GET relê o valor persistido.
    const after = await get(headers)
    await expect(after.json()).resolves.toMatchObject({
      name: 'Maria Silva',
      bio: 'Cozinheira amadora.',
    })
  })

  it('PATCH trima o name e aceita bio vazia (vira null)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'trim@me-profile.test' })

    const res = await patch({ name: '  Ana  ', bio: '   ' }, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string; bio: string | null }
    expect(body.name).toBe('Ana')
    expect(body.bio).toBeNull()

    expect(await readUser(userId)).toMatchObject({ name: 'Ana', bio: null })
  })

  it('PATCH com name vazio (ou só espaços) → 400 nome_invalido (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'vazio@me-profile.test' })

    for (const bad of ['', '   ', undefined, 123, null]) {
      const res = await patch({ name: bad, bio: 'x' }, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'nome_invalido' })
    }

    // Nada gravado: o name continua o default do seed.
    expect(await readUser(userId)).toMatchObject({ name: 'vazio@me-profile.test' })
  })

  it('PATCH com bio acima do limite (281 chars) → 400 bio_invalida (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'longa@me-profile.test' })

    const res = await patch({ name: 'Ana', bio: 'a'.repeat(281) }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'bio_invalida' })

    // Nada gravado: bio continua null e name não mudou.
    expect(await readUser(userId)).toMatchObject({ name: 'longa@me-profile.test', bio: null })
  })

  it('PATCH aceita bio no limite exato (280 chars)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'limite@me-profile.test' })
    const bio = 'b'.repeat(280)

    const res = await patch({ name: 'Ana', bio }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ bio })
  })

  it('PATCH mede o cap APÓS o trim: 280 chars + whitespace de borda → 200 (grava só o trim)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'trimcap@me-profile.test' })
    const core = 'c'.repeat(280)

    // 282 chars no corpo cru, mas só 280 de conteúdo: o cap vale para o gravado, não a borda.
    const res = await patch({ name: 'Ana', bio: `  ${core}\n` }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ bio: core })
  })

  it('PATCH com bio não-string (e não-omitida) → 400 bio_invalida', async () => {
    const { headers } = await seedSessionHeaders({ email: 'tipobio@me-profile.test' })
    const res = await patch({ name: 'Ana', bio: 42 }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'bio_invalida' })
  })

  it('email é READ-ONLY: PATCH com email no corpo é ignorado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'fixo@me-profile.test' })

    const res = await patch({ name: 'Ana', bio: 'oi', email: 'novo@evil.test' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ email: 'fixo@me-profile.test' })

    expect(await readUser(userId)).toMatchObject({ email: 'fixo@me-profile.test' })
  })

  it('editar perfil NÃO cria/edita Receita (toca só users)', async () => {
    await seedFeijoadaCatalog()
    const before = await countRecipes()
    expect(before).toBeGreaterThan(0)

    const { headers } = await seedSessionHeaders({ email: 'isolamento@me-profile.test' })
    const res = await patch({ name: 'Ana', bio: 'oi' }, headers)
    expect(res.status).toBe(200)

    expect(await countRecipes()).toBe(before)
  })
})
