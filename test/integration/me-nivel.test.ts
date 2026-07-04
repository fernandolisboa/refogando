import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET, PATCH } from '@/app/api/me/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Nível de habilidade PADRÃO do perfil (#421, ADR-0029 dec.2) — extensão do contrato `/api/me`.
 * Cobre: conta nova nasce com nivelPadrao NULL (eixo neutro); GET expõe o campo; PATCH grava um
 * NivelChef válido, LIMPA com null/'' e RECUSA valor fora do enum (400 nivel_invalido); ausente →
 * inalterado. O default alimenta o eixo de composição do prompt nas bordas de geração.
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

async function readNivel(id: string): Promise<string | null | undefined> {
  const [row] = await getDb().select({ nivelPadrao: users.nivelPadrao }).from(users).where(eq(users.id, id))
  return row?.nivelPadrao
}

describe('/api/me — nível de habilidade padrão (#421)', () => {
  it('conta nova nasce com nivelPadrao NULL; GET expõe o campo', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'novo@nivel.test' })
    expect(await readNivel(userId)).toBeNull()

    const res = await get(headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nivelPadrao: string | null }
    expect(body.nivelPadrao).toBeNull()
  })

  it('PATCH grava um NivelChef válido → 200, persiste, GET relê', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'grava@nivel.test' })

    const res = await patch({ name: 'Ana', nivelPadrao: 'avancado' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ nivelPadrao: 'avancado' })
    expect(await readNivel(userId)).toBe('avancado')

    const after = await get(headers)
    await expect(after.json()).resolves.toMatchObject({ nivelPadrao: 'avancado' })
  })

  it('PATCH com null LIMPA o default (volta a NULL = eixo neutro)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'limpa@nivel.test' })
    await patch({ name: 'Ana', nivelPadrao: 'iniciante' }, headers)
    expect(await readNivel(userId)).toBe('iniciante')

    const res = await patch({ name: 'Ana', nivelPadrao: null }, headers)
    expect(res.status).toBe(200)
    expect(await readNivel(userId)).toBeNull()
  })

  it("PATCH com '' (string vazia) também LIMPA o default", async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'vazia@nivel.test' })
    await patch({ name: 'Ana', nivelPadrao: 'intermediario' }, headers)
    expect(await readNivel(userId)).toBe('intermediario')

    const res = await patch({ name: 'Ana', nivelPadrao: '' }, headers)
    expect(res.status).toBe(200)
    expect(await readNivel(userId)).toBeNull()
  })

  it('valor fora do enum → 400 nivel_invalido (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'invalido@nivel.test' })
    const antes = await readNivel(userId)

    for (const bad of ['expert', 'avançado', 'INICIANTE', 42]) {
      const res = await patch({ name: 'Ana', nivelPadrao: bad }, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'nivel_invalido' })
    }
    expect(await readNivel(userId)).toBe(antes)
  })

  it('PATCH sem `nivelPadrao` no corpo NÃO altera o campo (só name/bio)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'ausente@nivel.test' })
    await patch({ name: 'Ana', nivelPadrao: 'avancado' }, headers)
    expect(await readNivel(userId)).toBe('avancado')

    const res = await patch({ name: 'Novo Nome', bio: 'oi' }, headers)
    expect(res.status).toBe(200)
    expect(await readNivel(userId)).toBe('avancado')
  })
})
