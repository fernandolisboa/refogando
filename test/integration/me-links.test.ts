import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET, PATCH } from '@/app/api/me/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import type { ProfileLink } from '@/domain/links'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Links sociais do perfil (#127) — extensão do contrato `/api/me`. Cobre:
 *  - default: toda conta nasce com `links` = [] (coluna jsonb DEFAULT '[]');
 *  - GET expõe links; PATCH grava/atualiza/remove links e PERSISTE no banco;
 *  - validação na borda: >5 / tipo desconhecido / esquema perigoso (`javascript:`/`data:`/`//`)
 *    → 400 links_invalid, sem gravar;
 *  - não-regressão: PATCH sem `links` no corpo NÃO os altera; name/bio/handle seguem intactos.
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

/** Lê os links direto da linha de users (prova persistência). */
async function readLinks(id: string): Promise<ProfileLink[] | undefined> {
  const [row] = await getDb().select({ links: users.links }).from(users).where(eq(users.id, id))
  return row?.links
}

describe('/api/me — links do perfil (#127)', () => {
  it('conta nova nasce com links = [] e o GET os expõe', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'novo@me-links.test' })
    expect(await readLinks(userId)).toEqual([])

    const res = await get(headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ links: [] })
  })

  it('PATCH grava links válidos → 200, persiste, e um GET subsequente os relê', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'grava@me-links.test' })
    const links = [
      { tipo: 'instagram', url: 'https://instagram.com/ana' },
      { tipo: 'github', url: 'https://github.com/ana' },
    ]

    const res = await patch({ name: 'Ana', links }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ links })

    expect(await readLinks(userId)).toEqual(links)

    const after = await get(headers)
    await expect(after.json()).resolves.toMatchObject({ links })
  })

  it('PATCH normaliza (trima) a URL antes de gravar', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'trim@me-links.test' })
    const res = await patch(
      { name: 'Ana', links: [{ tipo: 'site', url: '  https://meu-site.com  ' }] },
      headers,
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      links: [{ tipo: 'site', url: 'https://meu-site.com' }],
    })
    expect(await readLinks(userId)).toEqual([{ tipo: 'site', url: 'https://meu-site.com' }])
  })

  it('PATCH com lista vazia remove todos os links → 200', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'vazia@me-links.test' })
    await patch({ name: 'Ana', links: [{ tipo: 'x', url: 'https://x.com/ana' }] }, headers)
    expect(await readLinks(userId)).toHaveLength(1)

    const res = await patch({ name: 'Ana', links: [] }, headers)
    expect(res.status).toBe(200)
    expect(await readLinks(userId)).toEqual([])
  })

  it('acima de 5 links → 400 links_invalid (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'demais@me-links.test' })
    const seis = Array.from({ length: 6 }, (_, i) => ({ tipo: 'site', url: `https://e${i}.com` }))

    const res = await patch({ name: 'Ana', links: seis }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'links_invalid' })
    expect(await readLinks(userId)).toEqual([]) // nada gravado
  })

  it('tipo desconhecido → 400 links_invalid (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'tipo@me-links.test' })
    const res = await patch(
      { name: 'Ana', links: [{ tipo: 'tiktok', url: 'https://tiktok.com/@ana' }] },
      headers,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'links_invalid' })
    expect(await readLinks(userId)).toEqual([])
  })

  it('SEGURANÇA: esquema perigoso é recusado → 400 links_invalid (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'xss@me-links.test' })

    for (const url of [
      'javascript:alert(document.cookie)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.com',
      'ftp://example.com',
    ]) {
      const res = await patch({ name: 'Ana', links: [{ tipo: 'site', url }] }, headers)
      expect(res.status, `esquema deveria ser recusado: ${url}`).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'links_invalid' })
    }
    expect(await readLinks(userId)).toEqual([]) // nada inseguro gravado
  })

  it('PATCH sem `links` no corpo NÃO os altera (só name/bio)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'semlinks@me-links.test' })
    const links = [{ tipo: 'youtube', url: 'https://youtube.com/@ana' }]
    await patch({ name: 'Ana', links }, headers)
    expect(await readLinks(userId)).toEqual(links)

    // Um PATCH só de name/bio não toca os links.
    const res = await patch({ name: 'Ana Maria', bio: 'oi' }, headers)
    expect(res.status).toBe(200)
    expect(await readLinks(userId)).toEqual(links)
  })

  it('só o DONO grava: a edição afeta apenas a própria linha', async () => {
    const a = await seedSessionHeaders({ email: 'donoA@me-links.test' })
    const b = await seedSessionHeaders({ email: 'donoB@me-links.test' })

    await patch({ name: 'A', links: [{ tipo: 'site', url: 'https://a.com' }] }, a.headers)

    // B continua sem links; só a linha de A foi tocada.
    expect(await readLinks(a.userId)).toEqual([{ tipo: 'site', url: 'https://a.com' }])
    expect(await readLinks(b.userId)).toEqual([])
  })
})
