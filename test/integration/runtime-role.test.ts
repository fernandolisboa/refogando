import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { randSuffix } from '../helpers/throwaway-db'

/**
 * O papel de runtime da app (#644, ADR-0058). Roda o MESMO `scripts/sql/papel-app-rw.sql` que o Fernando cola no
 * SQL Editor do Neon (trocando o nome do papel, do dono e do banco pelos deste banco descartável) e prova que o
 * papel faz tudo o que a app faz em runtime (DML em todas as tabelas e sequências, inclusive as criadas DEPOIS por
 * uma migração) e nada do que o incidente de 2026-09-09 fez (DROP, TRUNCATE, ALTER, CREATE).
 */

const ROLE = `app_rw_t${randSuffix()}`
const PASSWORD = `p${randSuffix()}${randSuffix()}`
const PROBE = `zz_runtime_role_probe_${randSuffix()}`

let owner: Sql
let app: Sql

async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
  } catch (e) {
    return (e as { code?: string }).code
  }
  return undefined
}

beforeAll(async () => {
  const url = inject('databaseUrl')
  owner = makeSql(url, { max: 1 })
  const [{ me, db }] = await owner<{ me: string; db: string }[]>`select current_user as me, current_database() as db`
  const script = readFileSync('scripts/sql/papel-app-rw.sql', 'utf8')
    .replaceAll('neondb_owner', me)
    .replace(/\bneondb\b/g, db)
    .replace(/\bapp_rw\b/g, ROLE)
    .replaceAll('COLE_A_SENHA', PASSWORD)
  await owner.unsafe(script)
  const u = new URL(url)
  u.username = ROLE
  u.password = PASSWORD
  app = makeSql(u.toString(), { max: 1 })
})

afterAll(async () => {
  await app?.end({ timeout: 5 })
  if (owner) {
    await owner.unsafe(`drop table if exists public."${PROBE}"`)
    await owner.unsafe(`drop owned by "${ROLE}"`)
    await owner.unsafe(`drop role if exists "${ROLE}"`)
    await owner.end({ timeout: 5 })
  }
})

describe('papel app_rw (scripts/sql/papel-app-rw.sql)', () => {
  it('conecta como o papel, sem superusuário nem herança de neon_superuser', async () => {
    const [row] = await app<{ me: string; su: boolean; createrole: boolean }[]>`
      select current_user as me, rolsuper as su, rolcreaterole as createrole from pg_roles where rolname = current_user`
    expect(row).toEqual({ me: ROLE, su: false, createrole: false })
    const memberships = await app`select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = current_user`
    expect(memberships).toHaveLength(0)
  })

  it('tem SELECT, INSERT, UPDATE e DELETE em toda tabela de public, e USAGE em toda sequência', async () => {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const missing = await owner<{ relname: string }[]>`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and case when c.relkind in ('r', 'p') then not has_table_privilege(${ROLE}, c.oid, ${priv}) else false end`
      expect(missing.map((r) => r.relname), priv).toEqual([])
    }
    const seqs = await owner<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'
        -- CASE: o Postgres não garante a ordem do AND, e has_sequence_privilege lança em não-sequência.
        and case when c.relkind = 'S' then not has_sequence_privilege(${ROLE}, c.oid, 'USAGE') else false end`
    expect(seqs.map((r) => r.relname)).toEqual([])
  })

  it('faz DML de verdade (o upsert do limitador, ADR-0057) e advisory lock', async () => {
    const key = `k${randSuffix()}`
    await app`insert into rate_limit_window (bucket, key, window_start, expires_at)
      values ('teste_papel', ${key}, now(), now() + interval '1 minute')
      on conflict (bucket, key, window_start) do update set count = rate_limit_window.count + 1`
    await app`update rate_limit_window set count = count + 1 where bucket = 'teste_papel' and key = ${key}`
    const [row] = await app<{ count: number }[]>`select count from rate_limit_window where bucket = 'teste_papel' and key = ${key}`
    expect(row.count).toBe(2)
    await app`delete from rate_limit_window where bucket = 'teste_papel' and key = ${key}`
    await app.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(4675, 1)`
    })
  })

  it('tabela e sequência criadas DEPOIS pelo dono (uma migração) já nascem acessíveis', async () => {
    await owner.unsafe(`create table public."${PROBE}" (id serial primary key, v text)`)
    const [row] = await app.unsafe<{ id: number }[]>(`insert into public."${PROBE}" (v) values ('x') returning id`)
    expect(row.id).toBe(1)
    await app.unsafe(`delete from public."${PROBE}"`)
  })

  it('não faz DDL nem TRUNCATE: DROP, TRUNCATE, ALTER e CREATE dão 42501', async () => {
    expect(await pgCode(() => app`drop table rate_limit_window`)).toBe('42501')
    expect(await pgCode(() => app`truncate rate_limit_window`)).toBe('42501')
    expect(await pgCode(() => app`alter table users add column zz_probe int`)).toBe('42501')
    expect(await pgCode(() => app`create table public.zz_probe_create (id int)`)).toBe('42501')
    expect(await pgCode(() => app`drop schema public cascade`)).toBe('42501')
  })
})
