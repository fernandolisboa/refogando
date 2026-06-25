import { describe, it, expect } from 'vitest'
import { classifyUserQuery, MAX_USER_QUERY_LEN } from '@/domain/user-search-read'

/**
 * Dispatch PURO da busca de usuários (#269). A ORDEM e os limites do classificador são a fundação
 * do seam (reusado pela busca pública #279), então cada ramo é travado aqui — incl. o `@` sozinho,
 * o trim-antes-de-tudo e o UUID parcial que NÃO pode virar id.
 */
describe('classifyUserQuery (#269)', () => {
  const UUID = '123e4567-e89b-12d3-a456-426614174000'

  it('vazio / só espaços → null (sem ida ao banco)', () => {
    expect(classifyUserQuery('')).toBeNull()
    expect(classifyUserQuery('   ')).toBeNull()
  })

  it('trim ANTES de tudo: UUID com espaços ao redor → id (termo trimado)', () => {
    expect(classifyUserQuery(`  ${UUID}  `)).toEqual({ kind: 'id', term: UUID })
  })

  it('forma de UUID (case-insensitive) → id', () => {
    expect(classifyUserQuery(UUID)).toEqual({ kind: 'id', term: UUID })
    expect(classifyUserQuery(UUID.toUpperCase())).toEqual({ kind: 'id', term: UUID.toUpperCase() })
  })

  it('UUID PARCIAL ou nome "admin" → text (NUNCA id)', () => {
    expect(classifyUserQuery('admin')).toEqual({ kind: 'text', term: 'admin' })
    expect(classifyUserQuery('123e4567-e89b')).toEqual({ kind: 'text', term: '123e4567-e89b' })
  })

  it('@handle → handle (sem o @)', () => {
    expect(classifyUserQuery('@ana')).toEqual({ kind: 'handle', term: 'ana' })
    expect(classifyUserQuery('  @ana-maria ')).toEqual({ kind: 'handle', term: 'ana-maria' })
  })

  it('@ sozinho (mesmo com espaços) → null (não vira busca de prefixo vazio)', () => {
    expect(classifyUserQuery('@')).toBeNull()
    expect(classifyUserQuery('  @  ')).toBeNull()
  })

  it('email (@ no meio) → email', () => {
    expect(classifyUserQuery('ana@example.com')).toEqual({ kind: 'email', term: 'ana@example.com' })
  })

  it('nome simples → text', () => {
    expect(classifyUserQuery('Ana Maria')).toEqual({ kind: 'text', term: 'Ana Maria' })
  })

  it('acima do teto de tamanho → null (corte de abuso herdado pela busca pública #279)', () => {
    const ok = 'a'.repeat(MAX_USER_QUERY_LEN)
    expect(classifyUserQuery(ok)).toEqual({ kind: 'text', term: ok })
    expect(classifyUserQuery('a'.repeat(MAX_USER_QUERY_LEN + 1))).toBeNull()
  })
})
