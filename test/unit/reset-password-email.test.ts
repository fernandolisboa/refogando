import { describe, it, expect } from 'vitest'
import { buildResetPasswordEmail } from '@/server/auth/reset-password-email'

/**
 * E-mail de redefinição de senha (#469) — montagem pura. Prova: idioma pelo `users.locale` (fallback
 * pt-BR), link presente no texto e no HTML, e o `name` (input do Usuário) escapado no HTML.
 */
const URL = 'https://refogando.example/api/auth/reset-password/tok123?callbackURL=%2Fpt-BR%2Freset-password'

describe('buildResetPasswordEmail (#469)', () => {
  it('pt-BR por padrão (locale nulo): assunto, saudação e link', () => {
    const mail = buildResetPasswordEmail({ to: 'ana@x.test', name: 'Ana', locale: null, url: URL })
    expect(mail.to).toBe('ana@x.test')
    expect(mail.subject).toBe('Redefina sua senha do Refogando')
    expect(mail.text).toContain('Olá, Ana!')
    expect(mail.text).toContain(URL)
    expect(mail.text).toContain('1 hora')
    expect(mail.html).toContain(`href="${URL.replace(/&/g, '&amp;')}"`)
  })

  it('en-US quando o Usuário salvou esse idioma (case-insensitive)', () => {
    const mail = buildResetPasswordEmail({ to: 'bo@x.test', name: 'Bo', locale: 'en-us', url: URL })
    expect(mail.subject).toBe('Reset your Refogando password')
    expect(mail.text).toContain('Hi Bo,')
  })

  it('locale não suportado cai no pt-BR', () => {
    const mail = buildResetPasswordEmail({ to: 'c@x.test', name: 'C', locale: 'fr-FR', url: URL })
    expect(mail.subject).toBe('Redefina sua senha do Refogando')
  })

  it('escapa o nome no HTML (sem injeção de markup) e usa o email sem nome', () => {
    const evil = buildResetPasswordEmail({ to: 'e@x.test', name: '<b>Eve</b>', locale: null, url: URL })
    expect(evil.html).not.toContain('<b>Eve</b>')
    expect(evil.html).toContain('&lt;b&gt;Eve&lt;/b&gt;')
    const anon = buildResetPasswordEmail({ to: 'n@x.test', name: '  ', locale: null, url: URL })
    expect(anon.text).toContain('Olá, n@x.test!')
  })
})
