import { describe, expect, it } from 'vitest'
import { dbRoleFromUrl, resolveRuntimeDatabaseUrl } from '@/db/runtime-url'

describe('resolveRuntimeDatabaseUrl (#644)', () => {
  const OWNER = 'postgres://neondb_owner:s@ep-x-pooler.sa-east-1.aws.neon.tech/neondb'
  const APP = 'postgres://app_rw:s@ep-x-pooler.sa-east-1.aws.neon.tech/neondb'

  it('APP_DATABASE_URL vence a DATABASE_URL', () => {
    expect(resolveRuntimeDatabaseUrl({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER })).toEqual({
      url: APP,
      source: 'APP_DATABASE_URL',
    })
  })

  it.each([undefined, '', '   '])('APP_DATABASE_URL %j ⇒ cai na DATABASE_URL', (app) => {
    expect(resolveRuntimeDatabaseUrl({ APP_DATABASE_URL: app, DATABASE_URL: OWNER })).toEqual({
      url: OWNER,
      source: 'DATABASE_URL',
    })
  })

  it('nenhuma das duas ⇒ null', () => {
    expect(resolveRuntimeDatabaseUrl({})).toBeNull()
    expect(resolveRuntimeDatabaseUrl({ APP_DATABASE_URL: ' ', DATABASE_URL: '' })).toBeNull()
  })

  it('apara espaços (valor colado com quebra de linha no painel)', () => {
    expect(resolveRuntimeDatabaseUrl({ APP_DATABASE_URL: `${APP}\n` })?.url).toBe(APP)
  })
})

describe('dbRoleFromUrl', () => {
  it('devolve só o usuário, nunca senha ou host', () => {
    const role = dbRoleFromUrl('postgres://app_rw:SENHA_SECRETA@ep-x.neon.tech/neondb')
    expect(role).toBe('app_rw')
  })

  it('decodifica e saneia caracteres fora de [A-Za-z0-9_-]', () => {
    expect(dbRoleFromUrl('postgres://us%20er:p@h/db')).toBe('us_er')
    expect(dbRoleFromUrl('postgres://a=b%0Ac:p@h/db')).toBe('a_b_c')
  })

  it('URL inválida ou sem usuário ⇒ desconhecido', () => {
    expect(dbRoleFromUrl('não é url')).toBe('desconhecido')
    expect(dbRoleFromUrl('postgres://h/db')).toBe('desconhecido')
  })

  it('corta em 63 caracteres (limite do Postgres)', () => {
    expect(dbRoleFromUrl(`postgres://${'a'.repeat(80)}:p@h/db`)).toHaveLength(63)
  })
})
