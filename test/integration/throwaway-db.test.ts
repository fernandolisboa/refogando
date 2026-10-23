import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { createThrowawayDb, randSuffix } from '../helpers/throwaway-db'

/**
 * Helper do banco descartável (#593), o mesmo do `test/global-setup.ts` e do harness do E2E. Exercita o
 * caminho com `adminUrl` contra o Postgres da própria suíte (o papel precisa de CREATEDB, como o do
 * container ou o do Neon de teste): cria e apaga, a varredura só derruba órfão de nome seguro que o
 * chamador libera, e nome inseguro nem chega ao CREATE.
 *
 * Os bancos daqui levam um prefixo próprio POR EXECUÇÃO (`refogando_tdb<run>_*`, longe dos `refogando_test_*`
 * da suíte), e o `safeName` só casa com esse prefixo: outra execução no mesmo Postgres nunca entra na varredura
 * nem no `afterAll`, que apaga só os nomes criados aqui.
 */

const RUN = randSuffix()
const PREFIX = `refogando_tdb${RUN}_`
const SAFE = new RegExp(`^${PREFIX}[a-z0-9]+$`)
const created = new Set<string>()

let admin: Sql
let adminUrl: string

function name(suffix: string): string {
  const n = `${PREFIX}${suffix}`
  created.add(n)
  return n
}

async function exists(dbName: string): Promise<boolean> {
  const rows = await admin`select 1 from pg_database where datname = ${dbName}`
  return rows.length > 0
}

beforeAll(() => {
  adminUrl = inject('databaseUrl')
  admin = makeSql(adminUrl, { max: 1 })
})

afterAll(async () => {
  for (const dbName of created) await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
  await admin.end({ timeout: 5 })
})

describe('createThrowawayDb (#593)', () => {
  it('cria o banco no Postgres de adminUrl, devolve a URL dele e o apaga no drop', async () => {
    const db = await createThrowawayDb({ dbName: name('cria'), safeName: SAFE, adminUrl, sweepOrphan: () => false })
    expect(await exists(db.dbName)).toBe(true)
    const sql = makeSql(db.url, { max: 1 })
    const [{ current_database }] = await sql<{ current_database: string }[]>`select current_database()`
    await sql.end({ timeout: 5 })
    expect(current_database).toBe(db.dbName)

    await db.drop()
    expect(await exists(db.dbName)).toBe(false)
  })

  it('a varredura apaga só o órfão de nome seguro que sweepOrphan libera', async () => {
    const velho = name('velho')
    const novo = name('novo')
    // Mesmo prefixo, fora do padrão (caixa alta): a varredura nunca o toca.
    const foraDoPadrao = name('Fora')
    for (const n of [velho, novo, foraDoPadrao]) await admin.unsafe(`CREATE DATABASE "${n}"`)

    const logs: string[] = []
    const db = await createThrowawayDb({
      dbName: name('varre'),
      safeName: SAFE,
      adminUrl,
      sweepOrphan: (n) => n === velho,
      log: (msg) => logs.push(msg),
    })
    expect(await exists(velho)).toBe(false)
    expect(await exists(novo)).toBe(true)
    expect(await exists(foraDoPadrao)).toBe(true)
    expect(logs).toContain(`órfão ${velho} apagado`)
    await db.drop()
  })

  it('órfão ainda conectado não cai (DROP sem FORCE) e não impede a criação', async () => {
    const emUso = name('emuso')
    await admin.unsafe(`CREATE DATABASE "${emUso}"`)
    const url = new URL(adminUrl)
    url.pathname = `/${emUso}`
    const conn = makeSql(url.toString(), { max: 1 })
    await conn`select 1`
    try {
      const db = await createThrowawayDb({ dbName: name('aolado'), safeName: SAFE, adminUrl })
      expect(await exists(emUso)).toBe(true)
      await db.drop()
    } finally {
      await conn.end({ timeout: 5 })
    }
  })

  it('nome fora de safeName (ou safeName com flag g/m, ou sem âncora) é recusado antes de qualquer SQL', async () => {
    await expect(createThrowawayDb({ dbName: 'neondb', safeName: SAFE, adminUrl })).rejects.toThrow(/inseguro/)
    await expect(createThrowawayDb({ dbName: `${PREFIX}x"; drop`, safeName: SAFE, adminUrl })).rejects.toThrow(
      /inseguro/,
    )
    await expect(
      createThrowawayDb({ dbName: `${PREFIX}g`, safeName: new RegExp(SAFE.source, 'g'), adminUrl }),
    ).rejects.toThrow(/flags/)
    await expect(
      createThrowawayDb({ dbName: `${PREFIX}m`, safeName: new RegExp(SAFE.source, 'm'), adminUrl }),
    ).rejects.toThrow(/flags/)
    await expect(
      createThrowawayDb({ dbName: `${PREFIX}a`, safeName: new RegExp(`^${PREFIX}`), adminUrl }),
    ).rejects.toThrow(/ancorado/)
  })

  it('requireLoopback recusa um Postgres fora de loopback, nomeando a variável', async () => {
    await expect(
      createThrowawayDb({
        dbName: `${PREFIX}remoto`,
        safeName: SAFE,
        adminUrl: 'postgres://u:p@db.example.com:5432/postgres',
        requireLoopback: true,
        adminUrlEnv: 'E2E_DATABASE_URL',
      }),
    ).rejects.toThrow(/E2E_DATABASE_URL precisa ser postgres:\/\/ em loopback/)
  })
})
