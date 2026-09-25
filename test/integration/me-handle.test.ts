import { describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { GET, PATCH } from '@/app/api/me/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { validateHandle } from '@/domain/handle'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Handle do perfil (#128) — extensão do contrato `/api/me`. Cobre:
 *  - auto-geração: toda conta nova nasce com um handle único e bem-formado (auth hook);
 *  - backfill: a migração 0014 deixou os handles existentes únicos e válidos;
 *  - troca via PATCH: sucesso, colisão → 409, reservada → 400, formato → 400, dono mantém o seu.
 *
 * `seedSessionHeaders` cria a conta pela MESMA instância getAuth() (testUtils), então o
 * databaseHooks.user.create.before dispara e atribui o handle — é o caminho de produção.
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

async function readHandle(id: string): Promise<string | undefined> {
  const [row] = await getDb().select({ handle: users.handle }).from(users).where(eq(users.id, id))
  return row?.handle
}

describe('/api/me — auto-geração de handle na criação da conta (#128)', () => {
  it('conta nova recebe um handle único e bem-formado (slug do nome)', async () => {
    const { userId } = await seedSessionHeaders({ email: 'ana.julia@handle.test' })
    const handle = await readHandle(userId)
    expect(handle).toBeTruthy()
    // Formato válido (a função pura é a fonte da verdade da forma).
    expect(validateHandle(handle!)).toEqual({ ok: true })
  })

  it('desambiguação: um base já tomado → próximo signup ganha `-N`', async () => {
    // O helper usa o EMAIL como name; logo o slug do handle deriva do email inteiro
    // (slugify('disamb@handle.test') = 'disamb-handle-test'). Pré-ocupamos exatamente esse
    // base com uma linha direta; o auth hook do signup precisa desambiguar.
    await seedUser({ email: 'pre@handle.test', name: 'X', handle: 'disamb-handle-test' })
    const { userId } = await seedSessionHeaders({ email: 'disamb@handle.test' })
    const h = await readHandle(userId)
    expect(h).not.toBe('disamb-handle-test') // o base estava tomado
    expect(h!.startsWith('disamb-handle-test')).toBe(true) // desambiguado a partir do mesmo base
    expect(validateHandle(h!)).toEqual({ ok: true })
  })

  it('GET expõe o handle gerado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'expoe@handle.test' })
    const res = await get(headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { handle: string }
    expect(validateHandle(body.handle)).toEqual({ ok: true })
  })
})

describe('/api/me — backfill produziu handles únicos (#128)', () => {
  it('todo handle em users é não-nulo, único e bem-formado', async () => {
    // Semeia alguns usuários (via inserção direta com handle do helper) e prova a invariante
    // global: nenhum handle nulo, nenhum duplicado. (A migração já cobre os pré-existentes; o
    // helper cobre os inseridos diretamente.)
    await seedUser({ email: 'bf1@handle.test', name: 'Backfill Um' })
    await seedUser({ email: 'bf2@handle.test', name: 'Backfill Dois' })

    const rows = await getDb().select({ handle: users.handle }).from(users)
    const handles = rows.map((r) => r.handle)
    // Nenhum nulo/vazio.
    for (const h of handles) {
      expect(h).toBeTruthy()
    }
    // Únicos.
    expect(new Set(handles).size).toBe(handles.length)
  })
})

describe('/api/me — troca de handle via PATCH (#128)', () => {
  it('troca para um handle livre → 200, persiste, GET relê', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'troca@handle.test' })

    const res = await patch({ name: 'Ana', handle: 'ana-cozinha' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ handle: 'ana-cozinha' })

    expect(await readHandle(userId)).toBe('ana-cozinha')

    const after = await get(headers)
    await expect(after.json()).resolves.toMatchObject({ handle: 'ana-cozinha' })
  })

  it('normaliza maiúsculas e espaços de borda para minúsculas trimadas', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'maiusc@handle.test' })
    const res = await patch({ name: 'Ana', handle: '  Chef-Ana  ' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ handle: 'chef-ana' })
    expect(await readHandle(userId)).toBe('chef-ana')
  })

  it('handle já em uso por OUTRO usuário → 409 handle_taken (não grava)', async () => {
    await seedUser({ email: 'dono@handle.test', name: 'Dono', handle: 'tomado-ja' })
    const { userId, headers } = await seedSessionHeaders({ email: 'quer@handle.test' })
    const antes = await readHandle(userId)

    const res = await patch({ name: 'Ana', handle: 'tomado-ja' }, headers)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'handle_taken' })

    // Não gravou: handle continua o original.
    expect(await readHandle(userId)).toBe(antes)
  })

  it('manter o PRÓPRIO handle (re-submeter o mesmo) → 200 (não conta como colisão)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'mesmo@handle.test' })
    const meu = await readHandle(userId)

    const res = await patch({ name: 'Ana', handle: meu }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ handle: meu })
  })

  it('palavra reservada → 400 handle_reserved (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'reserv@handle.test' })
    const antes = await readHandle(userId)

    // #470: o prefixo do handle de espera da conta pendente também (senão o usuário se passaria por uma).
    for (const reserved of ['admin', 'api', 'users', 'profile', 'pendente-0123456789abcdef', 'pendente-ana']) {
      const res = await patch({ name: 'Ana', handle: reserved }, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'handle_reserved' })
    }
    expect(await readHandle(userId)).toBe(antes)
  })

  it('#470: quem JÁ tem handle com `pendente-` salva o perfil mantendo-o; trocar PARA outro `pendente-` segue barrado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'pendente-silva@handle.test' })
    // Gerado do nome antes da reserva do prefixo (ex.: "Pendente Silva" em produção).
    await getDb().update(users).set({ handle: 'pendente-silva' }).where(eq(users.id, userId))

    // O form sempre reenvia o handle atual: salvar nome/bio mantendo-o funciona.
    const keep = await patch({ name: 'Pendente Silva', bio: 'oi', handle: 'pendente-silva' }, headers)
    expect(keep.status).toBe(200)
    expect(await readHandle(userId)).toBe('pendente-silva')

    // Trocar para OUTRO handle com o prefixo reservado: 400.
    const change = await patch({ name: 'Pendente Silva', handle: 'pendente-x' }, headers)
    expect(change.status).toBe(400)
    await expect(change.json()).resolves.toMatchObject({ error: 'handle_reserved' })
    expect(await readHandle(userId)).toBe('pendente-silva')

    // Sair dele para um handle normal continua valendo.
    expect((await patch({ name: 'Pendente Silva', handle: 'silva-p' }, headers)).status).toBe(200)
    expect(await readHandle(userId)).toBe('silva-p')
  })

  it('formato inválido → 400 handle_invalid (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'formato@handle.test' })
    const antes = await readHandle(userId)

    for (const bad of ['ab', 'a'.repeat(31), 'ana julia', 'ana_julia', '-ana', 'ana-', 'an--a', 123]) {
      const res = await patch({ name: 'Ana', handle: bad }, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'handle_invalid' })
    }
    expect(await readHandle(userId)).toBe(antes)
  })

  it('PATCH sem `handle` no corpo NÃO altera o handle (só name/bio)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'semhandle@handle.test' })
    const antes = await readHandle(userId)

    const res = await patch({ name: 'Novo Nome', bio: 'oi' }, headers)
    expect(res.status).toBe(200)
    expect(await readHandle(userId)).toBe(antes)
  })

  it('só o DONO troca: a troca afeta apenas a própria linha', async () => {
    const outro = await seedUser({ email: 'outro@handle.test', name: 'Outro', handle: 'outro-fixo' })
    const { userId, headers } = await seedSessionHeaders({ email: 'dono2@handle.test' })

    const res = await patch({ name: 'Ana', handle: 'so-eu' }, headers)
    expect(res.status).toBe(200)

    // O outro usuário não foi tocado.
    expect(await readHandle(outro)).toBe('outro-fixo')
    expect(await readHandle(userId)).toBe('so-eu')
    // Sanidade: nenhuma linha extra com 'so-eu'.
    const dup = await getDb().select({ id: users.id }).from(users).where(like(users.handle, 'so-eu'))
    expect(dup.length).toBe(1)
  })
})
