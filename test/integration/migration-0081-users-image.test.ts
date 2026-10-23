import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { seedUser } from '../helpers/users'

/**
 * Migração 0081, a parte do #604 (ADR-0016): limpa os `users.image` plantados enquanto o Better Auth aceitava
 * `image` vindo do cliente. Roda só os UPDATEs (os ALTER TABLE já vieram com o schema do teste) sobre contas
 * semeadas com cada forma, e confere o que fica e o que vira NULL.
 */
const migration = readFileSync(new URL('../../drizzle/0081_restricoes_consentimento.sql', import.meta.url), 'utf8')
const updates = migration
  .split('--> statement-breakpoint')
  .map((stmt) =>
    stmt
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((stmt) => stmt.startsWith('UPDATE'))

const STORE = 'https://ye2pksugovlrhxoq.public.blob.vercel-storage.com'

async function seedWithImage(email: string, image: string | null): Promise<string> {
  const id = await seedUser({ email })
  await getDb().update(users).set({ image }).where(eq(users.id, id))
  return id
}

async function imageOf(id: string): Promise<string | null> {
  const [row] = await getDb().select({ image: users.image }).from(users).where(eq(users.id, id))
  return row.image
}

describe('migração 0081 — limpeza de users.image plantado (#604)', () => {
  it('tem os dois UPDATEs', () => {
    expect(updates).toHaveLength(2)
  })

  it('mantém avatar nosso (antigo e com chave) e a foto do Google; zera blob alheio, outro store, URL externa e variante', async () => {
    const casos: [string, string | null, boolean][] = [
      ['antigo@m81.test', `${STORE}/avatars/3f2a-uuid.webp`, true],
      ['jpg@m81.test', `${STORE}/avatars/3f2a-uuid.jpg`, true],
      ['chave@m81.test', `${STORE}/avatars/AbCdEfGhIjKlMnOpQrStUv/1b2c.webp`, true],
      ['google@m81.test', 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c', true],
      ['sem@m81.test', null, true],
      ['receita@m81.test', `${STORE}/recipes/foto-de-outra.webp`, false],
      ['avaliacao@m81.test', `${STORE}/reviews/foto.webp`, false],
      ['pixel@m81.test', 'https://rastreio.example/pixel.gif', false],
      ['query@m81.test', `${STORE}/avatars/x.webp?1`, false],
      ['http@m81.test', 'http://abc123.public.blob.vercel-storage.com/avatars/x.webp', false],
      ['pct@m81.test', `${STORE}/avatars/x%2F.webp`, false],
      ['ponto@m81.test', `${STORE}/avatars/../recipes/foto-de-outra.webp`, false],
      ['barra@m81.test', `${STORE}/avatars//x.webp`, false],
      ['fundo@m81.test', `${STORE}/avatars/AbCdEfGhIjKlMnOpQrStUv/a/x.webp`, false],
      ['ext@m81.test', `${STORE}/avatars/x.svg`, false],
      ['nl@m81.test', `${STORE}/avatars/x.webp\n`, false],
      ['outro-store@m81.test', 'https://outro999.public.blob.vercel-storage.com/avatars/x.webp', false],
    ]
    const ids = await Promise.all(casos.map(([email, image]) => seedWithImage(email, image)))
    for (const u of updates) await getDb().execute(sql.raw(u))
    for (const [i, [email, image, fica]] of casos.entries()) {
      expect(await imageOf(ids[i]), email).toBe(fica ? image : null)
    }
  })

  it('o mesmo avatar em duas contas: as duas perdem; o de uma só fica', async () => {
    const a = await seedWithImage('a@m81.test', `${STORE}/avatars/compartilhado.webp`)
    const b = await seedWithImage('b@m81.test', `${STORE}/avatars/compartilhado.webp`)
    const c = await seedWithImage('c@m81.test', `${STORE}/avatars/so-meu.webp`)
    const d = await seedWithImage('d@m81.test', `${STORE}/avatars/AbCdEfGhIjKlMnOpQrStUv/x.webp`)
    const e = await seedWithImage('e@m81.test', `${STORE}/avatars/AbCdEfGhIjKlMnOpQrStUv/x.webp`)
    for (const u of updates) await getDb().execute(sql.raw(u))
    expect(await imageOf(a)).toBeNull()
    expect(await imageOf(b)).toBeNull()
    expect(await imageOf(c)).toBe(`${STORE}/avatars/so-meu.webp`)
    expect(await imageOf(d)).toBeNull()
    expect(await imageOf(e)).toBeNull()
    // Re-rodar é no-op.
    for (const u of updates) await getDb().execute(sql.raw(u))
    expect(await imageOf(c)).toBe(`${STORE}/avatars/so-meu.webp`)
  })
})
