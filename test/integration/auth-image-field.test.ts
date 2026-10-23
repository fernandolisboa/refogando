import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as authCatchAll } from '@/app/api/auth/[...all]/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'

/**
 * #604 — `image` nunca vem do cliente. O Better Auth aceita qualquer string nesse campo em `/update-user` e
 * `/sign-up/email`; o hook `before` de `src/lib/auth.ts` recusa com 400 `FIELD_NOT_ALLOWED` (mesmo contrato do
 * `role`, `signup-role.test.ts`). O avatar só muda por `/api/me/avatar` (`me-avatar.test.ts`). Exercita o
 * catch-all real (porta HTTP).
 */

const BLOB_ALHEIO = 'https://loja.public.blob.vercel-storage.com/reviews/foto-de-outra-pessoa.webp'

function post(path: string, body: unknown, headers?: Headers): Promise<Response> {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return authCatchAll(new Request(`http://localhost/api/auth${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) }))
}

async function imageOf(where: { id?: string; email?: string }): Promise<string | null | undefined> {
  const cond = where.id ? eq(users.id, where.id) : eq(users.email, where.email!)
  const [row] = await getDb().select({ image: users.image }).from(users).where(cond)
  return row === undefined ? undefined : row.image
}

describe('#604 — campo image do Better Auth', () => {
  it('/sign-up/email com image ⇒ 400 FIELD_NOT_ALLOWED e nenhuma conta criada', async () => {
    const email = 'com-imagem@auth-image.test'
    const res = await post('/sign-up/email', { email, password: 'senha-super-secreta-123', name: 'Ana', image: BLOB_ALHEIO })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'FIELD_NOT_ALLOWED' })
    expect(await imageOf({ email })).toBeUndefined()
  })

  it('/sign-up/email sem image segue funcionando', async () => {
    const email = 'sem-imagem@auth-image.test'
    const res = await post('/sign-up/email', { email, password: 'senha-super-secreta-123', name: 'Ana' })
    expect(res.status).toBe(200)
    expect(await imageOf({ email })).toBeNull()
  })

  it('/update-user com image (URL de blob alheio, URL externa ou null) ⇒ 400 e users.image intacto', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'troca@auth-image.test' })
    for (const image of [BLOB_ALHEIO, 'https://rastreio.example/pixel.gif', null]) {
      const res = await post('/update-user', { image }, headers)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'FIELD_NOT_ALLOWED' })
      expect(await imageOf({ id: userId })).toBeNull()
    }
  })

  it('/update-user sem image (só o nome) não é afetado pelo hook', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'nome@auth-image.test' })
    const res = await post('/update-user', { name: 'Nome Novo' }, headers)
    expect(res.status).toBe(200)
    const [row] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, userId))
    expect(row.name).toBe('Nome Novo')
  })
})
