import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { PostgresError } from 'postgres'
import { makeSql } from '@/db/client'
import { seedUser } from '../helpers/users'

/**
 * Invariantes do banco da fatia de Usuário/auth (T6, issues #4+#5). Constraint-violations
 * são dirigidas por um cliente RAW postgres-js — só assim o PostgresError carrega `.code`
 * no TOPO (sob Drizzle viria em `(err.cause as PostgresError).code`). Modelo:
 * recipe-constraints.test.ts / foundation-db.test.ts. PKs são uuid não-determinístico —
 * sempre asserir por id RETORNADO.
 *
 * Cobre #5.AC4 (users.id é uuid estável; email único) e #5.AC3 (Owner vs Autoria: a FK
 * recipe.owner_id → users.id é RESTRICT, mas owner_id NULL = catálogo continua válido).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('Usuário: invariantes de banco', () => {
  it('#5.AC4: users.id é uuid (regex) e estável (mesmo id na releitura)', async () => {
    const id = await seedUser({ email: 'uuid@inv.test' })
    expect(id).toMatch(UUID_RE)

    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'uuid@inv.test'`
    expect(rows).toHaveLength(1)
    // O id RETORNADO no insert é o MESMO persistido (uuid gerado pelo Postgres, estável).
    expect(rows[0].id).toBe(id)
  })

  it('#5.AC4: email duplicado ⇒ SQLSTATE 23505 (unique users_email_uq)', async () => {
    await seedUser({ email: 'dup@inv.test' })

    let err: unknown
    try {
      // Insert RAW de uma 2ª linha com o MESMO email viola o unique index. `handle` é NOT NULL
      // (#128) e precisa de valor próprio (≠ do seed) — senão o INSERT bate 23502 (not-null)
      // ANTES do 23505 que este teste prova; usamos um handle distinto pra isolar o email_uq.
      await sql`
        INSERT INTO users (name, email, handle)
        VALUES ('Outro', 'dup@inv.test', 'outro-dup-inv')
      `
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('23505')
  })

  it('#5.AC3: recipe com owner_id = uuid inexistente ⇒ SQLSTATE 23503 (FK RESTRICT)', async () => {
    // uuid bem-formado mas sem linha correspondente em users ⇒ viola a FK.
    const ghost = crypto.randomUUID()

    let err: unknown
    try {
      await sql`
        INSERT INTO recipe (origin, original_locale, owner_id)
        VALUES ('ai_chat', 'pt-BR', ${ghost})
      `
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('23503')
  })

  it('#5.AC3: recipe com owner_id NULL insere OK (catálogo/sistema)', async () => {
    // owner_id NULLABLE preservado: o catálogo não tem dono e continua válido.
    const rows = await sql<{ id: string; owner_id: string | null }[]>`
      INSERT INTO recipe (origin, original_locale, owner_id)
      VALUES ('catalog', 'pt-BR', NULL)
      RETURNING id, owner_id
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toMatch(UUID_RE)
    expect(rows[0].owner_id).toBeNull()
  })

  it('#5.AC3: recipe com owner_id = users.id válido insere OK (Owner)', async () => {
    const ownerId = await seedUser({ email: 'owner@inv.test' })

    const rows = await sql<{ id: string; owner_id: string | null }[]>`
      INSERT INTO recipe (origin, original_locale, owner_id)
      VALUES ('ai_chat', 'pt-BR', ${ownerId})
      RETURNING id, owner_id
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toMatch(UUID_RE)
    expect(rows[0].owner_id).toBe(ownerId)
  })
})
