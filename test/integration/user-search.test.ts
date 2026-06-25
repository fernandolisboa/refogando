import { describe, expect, it, beforeEach } from 'vitest'
import { getDb } from '@/server/deps'
import { searchUsers } from '@/server/user/search'
import { GET as searchHandler } from '@/app/api/admin/users/search/route'
import { seedUser, seedSessionHeaders } from '../helpers/users'

/**
 * Seam de busca de usuários (#269) contra Postgres real. Prova as propriedades de DADOS que o issue
 * exige — e que a busca pública de Cozinheiros (#279) vai herdar: cada eixo (nome/@handle/email/id),
 * o GATE DE EMAIL na camada de dados (não só na UI), exclusão de soft-deleted em TODOS os ramos
 * (incl. id exato), e o ranking exato>prefixo>substring. Tokens únicos ('Quokka'/'Zorp'/domínio
 * @usearch.test) isolam os seeds de outros testes que compartilham o banco.
 */

// IDs preenchidos no seed. SEED POR TESTE (beforeEach): `test/setup.ts` faz `truncateAll` num
// beforeEach global ANTES do nosso — semear em beforeAll seria apagado. Os ids mudam a cada teste.
let u1 = '' // Quokka Silva (usuario)
let u2 = '' // Quetzal Souza (curador)
let uDel = '' // Quokka Deleted (soft-deleted)
let uLit = '' // Mc_Lit (underscore literal — teste de escape de curinga)

beforeEach(async () => {
  u1 = await seedUser({
    email: 'quokka@usearch.test',
    name: 'Quokka Silva',
    handle: 'quokka-silva',
    role: 'usuario',
  })
  u2 = await seedUser({
    email: 'quetzal@usearch.test',
    name: 'Quetzal Souza',
    handle: 'quetzal',
    role: 'curador',
  })
  uDel = await seedUser({
    email: 'quokkadel@usearch.test',
    name: 'Quokka Deleted',
    handle: 'quokka-del',
    role: 'usuario',
    deletedAt: new Date(),
  })
  // Ranking: nomes Zorp (exato) / Zorptastic (prefixo) / Azorp (substring); handles SEM "zorp"
  // pra isolar o ranking pela coluna NOME (least(nameRank, handleRank=2)).
  await seedUser({ email: 'r1@usearch.test', name: 'Zorp', handle: 'hx-rank-1' })
  await seedUser({ email: 'r2@usearch.test', name: 'Zorptastic', handle: 'hx-rank-2' })
  await seedUser({ email: 'r3@usearch.test', name: 'Azorp', handle: 'hx-rank-3' })
  // Escape de curinga: 'Mc_Lit' tem um '_' LITERAL; 'McZLit' tem outro char. Buscar 'Mc_' deve casar
  // SÓ o literal (escapeLike) — sem escape, '_' seria "qualquer caractere" e casaria os dois.
  uLit = await seedUser({ email: 'lit@usearch.test', name: 'Mc_Lit', handle: 'hx-esc-1' })
  await seedUser({ email: 'litz@usearch.test', name: 'McZLit', handle: 'hx-esc-2' })
})

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('searchUsers (#269) — eixos de busca', () => {
  it('nome (prefixo) acha o usuário; soft-deleted homônimo NÃO aparece', async () => {
    const rows = await searchUsers(getDb(), { q: 'Quokka', includeEmail: true })
    expect(ids(rows)).toContain(u1)
    expect(ids(rows)).not.toContain(uDel) // mesmo "Quokka" no nome, mas soft-deleted
  })

  it('nome (substring no meio) acha o usuário', async () => {
    const rows = await searchUsers(getDb(), { q: 'uokka', includeEmail: true })
    expect(ids(rows)).toContain(u1)
  })

  it('@handle acha pelo handle', async () => {
    const rows = await searchUsers(getDb(), { q: '@quetzal', includeEmail: true })
    expect(ids(rows)).toContain(u2)
  })

  it('id exato acha o usuário', async () => {
    const rows = await searchUsers(getDb(), { q: u1, includeEmail: true })
    expect(ids(rows)).toEqual([u1])
  })

  it('id exato de conta SOFT-DELETED → [] (gate em TODOS os ramos, incl. id)', async () => {
    const rows = await searchUsers(getDb(), { q: uDel, includeEmail: true })
    expect(rows).toEqual([])
  })

  it('query vazia / só espaços → [] (sem ida ao banco)', async () => {
    expect(await searchUsers(getDb(), { q: '', includeEmail: true })).toEqual([])
    expect(await searchUsers(getDb(), { q: '   ', includeEmail: true })).toEqual([])
  })

  it('curinga LITERAL: "Mc_" casa só o nome com "_" de verdade (escapeLike), não "_" como wildcard', async () => {
    const rows = await searchUsers(getDb(), { q: 'Mc_', includeEmail: true })
    const got = ids(rows)
    expect(got).toContain(uLit) // Mc_Lit (tem o '_' literal)
    expect(got).toHaveLength(1) // McZLit NÃO casa — '_' não é curinga
  })
})

describe('searchUsers (#269) — gate de EMAIL na camada de dados', () => {
  it('admin (includeEmail=true): acha por email e a linha CARREGA o email', async () => {
    const rows = await searchUsers(getDb(), { q: 'quetzal@usearch.test', includeEmail: true })
    expect(ids(rows)).toContain(u2)
    const hit = rows.find((r) => r.id === u2)!
    expect(hit.email).toBe('quetzal@usearch.test')
  })

  it('NÃO-admin (includeEmail=false): query com cara de email → [] (sem fall-through pra texto)', async () => {
    const rows = await searchUsers(getDb(), { q: 'quetzal@usearch.test', includeEmail: false })
    expect(rows).toEqual([])
  })

  it('NÃO-admin: acha por nome, mas a coluna email NEM É SELECIONADA (a chave não existe na linha)', async () => {
    const rows = await searchUsers(getDb(), { q: 'Quetzal', includeEmail: false })
    expect(ids(rows)).toContain(u2)
    const hit = rows.find((r) => r.id === u2)!
    // Gate de DADOS: não basta email==null — a chave não pode estar presente.
    expect('email' in hit).toBe(false)
  })
})

describe('searchUsers (#269) — ranking força-de-match (exato > prefixo > substring)', () => {
  it('ordena exato, depois prefixo, depois substring (por nome)', async () => {
    const rows = await searchUsers(getDb(), { q: 'Zorp', includeEmail: true })
    const names = rows.map((r) => r.name)
    // Zorp (exato) antes de Zorptastic (prefixo) antes de Azorp (substring).
    expect(names.indexOf('Zorp')).toBeLessThan(names.indexOf('Zorptastic'))
    expect(names.indexOf('Zorptastic')).toBeLessThan(names.indexOf('Azorp'))
  })
})

describe('GET /api/admin/users/search (#269) — guarda + projeção', () => {
  function searchGet(q: string, headers: Headers): Promise<Response> {
    return searchHandler(
      new Request(`http://localhost/api/admin/users/search?q=${encodeURIComponent(q)}`, { headers }),
    )
  }

  it('não-admin (usuario) → 403', async () => {
    const u = await seedSessionHeaders({ email: 'naoadmin@usearch.test', role: 'usuario' })
    const res = await searchGet('Quokka', u.headers)
    expect(res.status).toBe(403)
  })

  it('admin → 200 e cada resultado tem EXATAMENTE as chaves de AdminUserResult (allowlist)', async () => {
    const adm = await seedSessionHeaders({ email: 'admin@usearch.test', role: 'admin' })
    const res = await searchGet('Quetzal', adm.headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: Record<string, unknown>[] }
    const hit = body.results.find((r) => r.id === u2)!
    expect(hit).toBeDefined()
    expect(Object.keys(hit).sort()).toEqual(['email', 'handle', 'id', 'image', 'name', 'role'])
    expect(hit.email).toBe('quetzal@usearch.test') // admin vê o email
  })

  it('admin, q vazio → { results: [] } (sem erro, sem ida ao banco)', async () => {
    const adm = await seedSessionHeaders({ email: 'admin2@usearch.test', role: 'admin' })
    const res = await searchGet('', adm.headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ results: [] })
  })
})
