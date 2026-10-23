import { describe, expect, it } from 'vitest'
import { avatarPathKind, avatarPathPrefix } from '@/server/images/avatar-blob'

/**
 * #604 — a forma do caminho que deixa o servidor apagar um avatar (`avatar-blob.ts`). Só a forma canônica que o
 * store grava passa; qualquer variante cai em `null` (não apaga). O banco e o `store.owns` estão nos testes de
 * integração (`me-avatar.test.ts`, `account-erasure-private-content.test.ts`).
 */

const ID = '0b6d6c3e-6a1f-4c55-9a43-2f5e0f6d1a10'
const OUTRO = '7f0c2d9a-1b2c-4d3e-8f90-123456789abc'
const HOST = 'https://loja.public.blob.vercel-storage.com'
const FILE = 'b2a1c3d4-0000-4000-8000-000000000001.webp'

describe('avatarPathPrefix', () => {
  it('é estável, opaco (sem o id cru) e diferente por conta', () => {
    expect(avatarPathPrefix(ID)).toBe(avatarPathPrefix(ID))
    expect(avatarPathPrefix(ID)).toMatch(/^avatars\/[A-Za-z0-9_-]{22}$/)
    expect(avatarPathPrefix(ID)).not.toContain(ID)
    expect(avatarPathPrefix(ID)).not.toBe(avatarPathPrefix(OUTRO))
  })
})

describe('avatarPathKind', () => {
  const mine = `${HOST}/${avatarPathPrefix(ID)}/${FILE}`

  it('reconhece o avatar da conta; o antigo e o de outra chave ficam sem dono conhecido (o banco decide)', () => {
    expect(avatarPathKind(mine, ID)?.kind).toBe('conta')
    expect(avatarPathKind(`${HOST}/avatars/${FILE}`, ID)).toEqual({ kind: 'sem-dono', path: `/avatars/${FILE}` })
    expect(avatarPathKind(mine, OUTRO)?.kind).toBe('sem-dono')
  })

  it('recusa outros diretórios e caminho aninhado ou fora do formato', () => {
    expect(avatarPathKind(`${HOST}/reviews/${FILE}`, ID)).toBeNull()
    expect(avatarPathKind(`${HOST}/recipes/${FILE}`, ID)).toBeNull()
    expect(avatarPathKind(`${HOST}/${avatarPathPrefix(ID)}/a/${FILE}`, ID)).toBeNull()
    expect(avatarPathKind(`${HOST}/${avatarPathPrefix(ID)}x/${FILE}`, ID)).toBeNull()
    expect(avatarPathKind(`${HOST}/${avatarPathPrefix(ID)}/`, ID)).toBeNull()
  })

  it('recusa variantes não canônicas (query, hash, %, porta, http, caixa alta, não-URL)', () => {
    for (const url of [
      `${mine}?x=1`,
      `${mine}#f`,
      `${HOST}/${avatarPathPrefix(ID)}/..%2F..%2Freviews%2F${FILE}`,
      `${HOST}/avatars/${FILE.replace('-', '%2D')}`,
      mine.replace('.com/', '.com:443/').replace(':443', ':8443'),
      mine.replace('https:', 'http:'),
      mine.replace('loja', 'LOJA'),
      `${HOST}/avatars/${FILE.replace('.webp', '.svg')}`,
      'não é url',
    ]) {
      expect(avatarPathKind(url, ID), url).toBeNull()
    }
  })
})
