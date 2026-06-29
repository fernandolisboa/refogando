import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/search/cooks/route'
import { COOK_SEARCH_LIMIT } from '@/server/user/search'
import { seedUser } from '../helpers/users'
import { seedRecipe } from '../helpers/recipes'

/**
 * Busca PÚBLICA de Cozinheiros (#279, ADR-0024) — rota GET /api/search/cooks contra Postgres real.
 * Reusa o seam `searchUsers` (#269) via `searchCooks` com `includeEmail=false`. Cobre: casa/não-casa por
 * nome/@handle (força-de-match exato>prefixo>substring), allowlist (sem id/role/email), gates de
 * segurança (NUL→200 não-500, UUID→[], email→[], termo<2→[]), soft-delete, limite server-controlled.
 * Cookie-free (viewer-independente): nenhuma sessão é semeada — anon SEMPRE 200.
 */

function cooksReq(query: string) {
  return GET(new Request(`http://localhost/api/search/cooks${query}`))
}

async function cooksOf(query: string): Promise<{ name: string; handle: string; image: string | null }[]> {
  const res = await cooksReq(query)
  expect(res.status).toBe(200) // cookie-free: NUNCA 401
  const body = (await res.json()) as { cooks: { name: string; handle: string; image: string | null }[] }
  return body.cooks
}

async function cooksPageOf(
  query: string,
): Promise<{ cooks: { handle: string }[]; nextCursor: string | null }> {
  const res = await cooksReq(query)
  expect(res.status).toBe(200)
  return (await res.json()) as { cooks: { handle: string }[]; nextCursor: string | null }
}

describe('GET /api/search/cooks (#279) — casa por nome/@handle', () => {
  it('casa por NOME; termo sem ninguém → cluster vazio', async () => {
    await seedUser({ email: 'alf@cs.test', name: 'Alfredo', handle: 'alfredo' })
    const casou = await cooksOf('?q=alfredo')
    expect(casou.map((c) => c.handle)).toContain('alfredo')
    // "pasta" não casa NENHUM cook semeado → cluster vazio (gate data-driven, não semântico).
    expect(await cooksOf('?q=pasta')).toEqual([])
  })

  it('cook LITERALMENTE chamado como o termo aparece (semântica data-driven)', async () => {
    await seedUser({ email: 'p@cs.test', name: 'Pasta Master', handle: 'pasta-master' })
    expect((await cooksOf('?q=pasta')).map((c) => c.handle)).toEqual(['pasta-master'])
  })

  it('casa por @handle, por prefixo e por substring', async () => {
    await seedUser({ email: 'ch@cs.test', name: 'Chico', handle: 'chef-alfredo' })
    expect((await cooksOf('?q=%40chef-alfredo')).map((c) => c.handle)).toContain('chef-alfredo') // @handle
    await seedUser({ email: 'a2@cs.test', name: 'Alfredo Silva', handle: 'alfredo-silva' })
    expect((await cooksOf('?q=alf')).map((c) => c.handle)).toContain('alfredo-silva') // prefixo
    expect((await cooksOf('?q=fred')).map((c) => c.handle)).toContain('alfredo-silva') // substring
  })

  it('ordena exato > prefixo > substring', async () => {
    await seedUser({ email: 'ex@cs.test', name: 'Ana', handle: 'ana-exata' }) // exato
    await seedUser({ email: 'pf@cs.test', name: 'Anabela', handle: 'anabela-pref' }) // prefixo
    await seedUser({ email: 'sb@cs.test', name: 'Mariana', handle: 'mariana-sub' }) // substring
    const ordered = (await cooksOf('?q=ana')).map((c) => c.handle)
    expect(ordered.indexOf('ana-exata')).toBeLessThan(ordered.indexOf('anabela-pref'))
    expect(ordered.indexOf('anabela-pref')).toBeLessThan(ordered.indexOf('mariana-sub'))
  })
})

describe('GET /api/search/cooks (#279) — gates de segurança/privacidade', () => {
  it('allowlist: cada cook = exatamente { name, handle, image } (sem id/role/email)', async () => {
    await seedUser({ email: 'dto@cs.test', name: 'Dto Cook', handle: 'dto-cook' })
    const cooks = await cooksOf('?q=dto')
    expect(cooks.length).toBeGreaterThan(0)
    for (const c of cooks) {
      expect(Object.keys(c).sort()).toEqual(['handle', 'image', 'name'])
      expect('id' in c).toBe(false)
      expect('role' in c).toBe(false)
      expect('email' in c).toBe(false)
    }
  })

  it('query com cara de EMAIL → [] (PII: includeEmail=false corta)', async () => {
    await seedUser({ email: 'secret@cs.test', name: 'Secret', handle: 'secret-cook' })
    expect(await cooksOf('?q=secret%40cs.test')).toEqual([]) // "secret@cs.test"
  })

  it('query com cara de UUID → [] (não vaza o oráculo uuid→perfil)', async () => {
    const id = await seedUser({ email: 'uuid@cs.test', name: 'UuidCook', handle: 'uuid-cook' })
    expect(await cooksOf(`?q=${id}`)).toEqual([]) // o uuid REAL não resolve no caminho público
  })

  it('NUL/C0 no termo → 200 {cooks} (nunca 500 do postgres-js)', async () => {
    const res = await cooksReq('?q=%00ab') // stripControlChars remove o NUL → "ab"
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toHaveProperty('cooks')
  })

  it('termo classificado < 3 chars → [] (alinha com trigrama; sem ruído); inclui @ab', async () => {
    await seedUser({ email: 'ab@cs.test', name: 'Abelardo', handle: 'abelardo' })
    expect(await cooksOf('?q=a')).toEqual([]) // 1 char
    expect(await cooksOf('?q=ab')).toEqual([]) // 2 chars (casaria 'Abelardo' por substring, mas é barrado)
    expect(await cooksOf('?q=%40ab')).toEqual([]) // "@ab" → handle term "ab" (2 chars) → barrado
    expect(await cooksOf('?q=')).toEqual([]) // vazio
    // 3 chars JÁ aciona — prova que o gate é em 3 (não ausência de dado):
    expect((await cooksOf('?q=abe')).map((c) => c.handle)).toContain('abelardo')
  })

  it('Cozinheiro soft-deletado NUNCA aparece (mesmo nome exato)', async () => {
    await seedUser({ email: 'dead@cs.test', name: 'Zelda', handle: 'zelda-morta', deletedAt: new Date() })
    expect(await cooksOf('?q=zelda')).toEqual([])
  })

  it('limite é SERVER-controlled: ?limit gigante do cliente é ignorado (≤ COOK_SEARCH_LIMIT)', async () => {
    for (let i = 0; i < COOK_SEARCH_LIMIT + 4; i++) {
      await seedUser({ email: `multi-${i}@cs.test`, name: `Mariana ${i}`, handle: `mariana-${i}` })
    }
    const cooks = await cooksOf('?q=mariana&limit=99999')
    expect(cooks.length).toBeLessThanOrEqual(COOK_SEARCH_LIMIT)
  })
})

describe('GET /api/search/cooks (#308) — filtro de cozinha', () => {
  it('com ?cozinha=: só quem tem receita pública elegível na cozinha; SEM cozinha: casa por nome mesmo sem receita (cluster #279 intacto)', async () => {
    const aIta = await seedUser({ email: 'ai@cs.test', name: 'Ana Italiana', handle: 'ana-ita' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: aIta, cozinha: 'italiana' as never })
    const aJap = await seedUser({ email: 'aj@cs.test', name: 'Ana Japonesa', handle: 'ana-jap' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: aJap, cozinha: 'japonesa' as never })
    await seedUser({ email: 'as@cs.test', name: 'Ana Sem Receita', handle: 'ana-sem' })

    // SEM cozinha: casa os três por "ana" — NÃO exige receita (comportamento herdado do cluster #279).
    expect((await cooksPageOf('?q=ana')).cooks.map((c) => c.handle).sort()).toEqual(['ana-ita', 'ana-jap', 'ana-sem'])
    // cozinha=italiana: só ana-ita.
    expect((await cooksPageOf('?q=ana&cozinha=italiana')).cooks.map((c) => c.handle)).toEqual(['ana-ita'])
    // multi italiana,japonesa: ana-ita + ana-jap (ana-sem cai fora — sem receita elegível).
    expect((await cooksPageOf('?q=ana&cozinha=italiana,japonesa')).cooks.map((c) => c.handle).sort()).toEqual(['ana-ita', 'ana-jap'])
    // cozinha forjada/sem receita ⇒ vazio (bound-param, nunca 500).
    expect((await cooksPageOf('?q=ana&cozinha=NAO%00EXISTE')).cooks).toEqual([])
  })
})

describe('GET /api/search/cooks (#308) — paginação keyset', () => {
  it('pagina TODOS sem dup/skip; nextCursor null no fim', async () => {
    for (let i = 0; i < COOK_SEARCH_LIMIT + 2; i++) {
      await seedUser({ email: `pg${i}@cs.test`, name: `Cook Pag ${i}`, handle: `cook-pag-${String(i).padStart(2, '0')}` })
    }
    const seen: string[] = []
    let cursor: string | null = null
    for (let p = 0; p < 6; p++) {
      const page = await cooksPageOf(`?q=cook-pag${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      seen.push(...page.cooks.map((c) => c.handle))
      cursor = page.nextCursor
      if (!cursor) break
    }
    expect(seen.length).toBe(COOK_SEARCH_LIMIT + 2)
    expect(new Set(seen).size).toBe(COOK_SEARCH_LIMIT + 2) // sem duplicar
    expect(seen).toContain('cook-pag-00')
    expect(seen).toContain(`cook-pag-${String(COOK_SEARCH_LIMIT + 1).padStart(2, '0')}`)
  })

  it('cursor forjado → primeira página (nunca 500)', async () => {
    await seedUser({ email: 'cf@cs.test', name: 'Cursor Forjado', handle: 'cursor-forjado' })
    const res = await cooksReq('?q=cursor-forjado&cursor=!!!lixo!!!')
    expect(res.status).toBe(200)
    expect((await res.json() as { cooks: { handle: string }[] }).cooks.map((c) => c.handle)).toEqual(['cursor-forjado'])
  })
})
