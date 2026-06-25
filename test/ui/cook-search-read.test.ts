import { describe, it, expect } from 'vitest'
import { projectPublicCook, type UserSearchRow } from '@/domain/user-search-read'

/** Projeção pública de Cozinheiro (#279) — allowlist PURA, sem DB. */
describe('projectPublicCook (#279)', () => {
  it('dropa id/role/email → só { name, handle, image }', () => {
    const row: UserSearchRow = {
      id: 'u-1',
      name: 'Ana',
      handle: 'ana',
      image: null,
      role: 'usuario',
      email: 'ana@x.com',
    }
    const out = projectPublicCook(row)
    expect(out).toEqual({ name: 'Ana', handle: 'ana', image: null })
    expect(Object.keys(out).sort()).toEqual(['handle', 'image', 'name'])
    expect('id' in out).toBe(false)
    expect('role' in out).toBe(false)
    expect('email' in out).toBe(false)
  })

  it('preserva a image quando presente', () => {
    const row: UserSearchRow = { id: 'u-2', name: 'Beto', handle: 'beto', image: 'https://x/y.webp', role: 'curador' }
    expect(projectPublicCook(row)).toEqual({ name: 'Beto', handle: 'beto', image: 'https://x/y.webp' })
  })
})
