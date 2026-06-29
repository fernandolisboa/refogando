import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/cooks/route'
import { seedUser } from '../helpers/users'
import { seedRecipe } from '../helpers/recipes'

/**
 * Diretório da Descoberta de Cozinheiros (#308) — rota GET /api/cooks contra Postgres real. A query de
 * ranking/keyset/cozinha é exaustivamente coberta em `recommended-cooks.test.ts`; AQUI provamos o
 * CONTRATO DA ROTA: anon (sem sessão) NÃO 401 → ramo GLOBAL; `Cache-Control: no-store` SEMPRE; cozinha
 * filtra; cursor forjado → primeira página (nunca 500); allowlist do DTO (sem id/email/role).
 */

async function seedCook(email: string, handle: string, cozinha?: string): Promise<string> {
  const id = await seedUser({ email, handle })
  await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: id, cozinha: cozinha as never })
  return id
}
function req(query = '') {
  return GET(new Request(`http://localhost/api/cooks${query}`))
}

describe('GET /api/cooks (#308)', () => {
  it('anon: 200 (NÃO 401) + Cache-Control no-store + recomendações globais', async () => {
    await seedCook('a@d.test', 'aa-cook')
    await seedCook('b@d.test', 'bb-cook')
    const res = await req()
    expect(res.status).toBe(200) // sessão OPCIONAL: anon nunca 401
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { cooks: { handle: string }[]; nextCursor: string | null }
    expect(body.cooks.map((c) => c.handle).sort()).toEqual(['aa-cook', 'bb-cook'])
  })

  it('filtra por cozinha (multi)', async () => {
    await seedCook('i@d.test', 'ita-cook', 'italiana')
    await seedCook('j@d.test', 'jap-cook', 'japonesa')
    await seedCook('b@d.test', 'bra-cook', 'brasileira')
    const res = await req('?cozinha=italiana,japonesa')
    const body = (await res.json()) as { cooks: { handle: string }[] }
    expect(body.cooks.map((c) => c.handle).sort()).toEqual(['ita-cook', 'jap-cook'])
  })

  it('cursor forjado → primeira página (200, nunca 500)', async () => {
    await seedCook('p@d.test', 'pag-cook')
    const res = await req('?cursor=!!!lixo!!!')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cooks: { handle: string }[] }
    expect(body.cooks.map((c) => c.handle)).toContain('pag-cook')
  })

  it('allowlist do DTO: sem id/email/role na resposta', async () => {
    await seedCook('al@d.test', 'allow-cook')
    const body = (await (await req()).json()) as { cooks: Record<string, unknown>[] }
    const c = body.cooks.find((x) => x.handle === 'allow-cook')!
    expect('id' in c).toBe(false)
    expect('email' in c).toBe(false)
    expect('role' in c).toBe(false)
    expect(Object.keys(c).sort()).toEqual(['handle', 'image', 'name', 'recipeCount', 'recipes'])
  })
})
