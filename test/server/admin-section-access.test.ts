import { describe, expect, it } from 'vitest'
import { decideSectionAccess } from '@/server/auth/admin-access'

/**
 * Veredito PURO de acesso a uma SEÇÃO do Console por rota aninhada (#125). Generaliza
 * `decideAdminAccess` (que é o caso `min='curador'`): cada rota filha revalida o papel
 * server-side com o seu mínimo — `/admin/config` e `/admin/users` exigem 'admin',
 * `/admin/moderation|translations|catalog` exigem 'curador'. É a MESMA seam fail-closed
 * que o jsdom não alcança (`headers()`/`getSession` só no servidor).
 *
 * O ponto sensível (lição da #51): um Curador batendo direto em `/admin/config` (min='admin')
 * tem de cair em `denied` — gate, não só link escondido. E papel `null`/desconhecido NUNCA
 * passa, em qualquer mínimo.
 */
describe('decideSectionAccess (gate por rota aninhada, fail-closed)', () => {
  it('sem sessão (undefined/null) → redirect ao login, em qualquer mínimo', () => {
    expect(decideSectionAccess(undefined, 'curador')).toBe('redirect')
    expect(decideSectionAccess(null, 'curador')).toBe('redirect')
    expect(decideSectionAccess(undefined, 'admin')).toBe('redirect')
    expect(decideSectionAccess(null, 'admin')).toBe('redirect')
  })

  it('conta soft-deletada (deletedAt != null), qualquer papel/mínimo → redirect', () => {
    expect(decideSectionAccess({ role: 'admin', deletedAt: new Date() }, 'admin')).toBe('redirect')
    expect(decideSectionAccess({ role: 'curador', deletedAt: new Date() }, 'curador')).toBe(
      'redirect',
    )
  })

  it('Curador batendo numa seção admin-only (min=admin) → denied (gate, não link escondido)', () => {
    expect(decideSectionAccess({ role: 'curador' }, 'admin')).toBe('denied')
    expect(decideSectionAccess({ role: 'curador', deletedAt: null }, 'admin')).toBe('denied')
  })

  it('Curador numa seção de Curadoria (min=curador) → { role: "curador" }', () => {
    expect(decideSectionAccess({ role: 'curador' }, 'curador')).toEqual({ role: 'curador' })
  })

  it('Admin passa em qualquer seção (curador+ e admin-only)', () => {
    expect(decideSectionAccess({ role: 'admin' }, 'curador')).toEqual({ role: 'admin' })
    expect(decideSectionAccess({ role: 'admin' }, 'admin')).toEqual({ role: 'admin' })
  })

  it('autenticado com papel insuficiente (usuario) → denied, em qualquer mínimo', () => {
    expect(decideSectionAccess({ role: 'usuario' }, 'curador')).toBe('denied')
    expect(decideSectionAccess({ role: 'usuario' }, 'admin')).toBe('denied')
  })

  it('FAIL-CLOSED — papel null/ausente/desconhecido → denied, nunca acesso', () => {
    expect(decideSectionAccess({ role: null }, 'curador')).toBe('denied')
    expect(decideSectionAccess({}, 'admin')).toBe('denied')
    expect(decideSectionAccess({ role: 'superusuario' }, 'curador')).toBe('denied')
    expect(decideSectionAccess({ role: '' }, 'admin')).toBe('denied')
  })

  it('decideAdminAccess permanece o caso min="curador" (sem regressão)', async () => {
    const { decideAdminAccess } = await import('@/server/auth/admin-access')
    expect(decideAdminAccess({ role: 'curador' })).toEqual(decideSectionAccess({ role: 'curador' }, 'curador'))
    expect(decideAdminAccess({ role: 'usuario' })).toBe(decideSectionAccess({ role: 'usuario' }, 'curador'))
    expect(decideAdminAccess(null)).toBe(decideSectionAccess(null, 'curador'))
  })
})
