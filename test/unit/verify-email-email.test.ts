import { describe, it, expect } from 'vitest'
import { buildFinishAccountEmail, buildVerifyEmail } from '@/server/auth/verify-email-email'

/**
 * E-mail de confirmação de e-mail (#470) — montagem pura, mesmo corpo dos e-mails de conta (#469). Prova: idioma
 * pelo locale resolvido (fallback pt-BR), link no texto e no HTML, validade de 24h na copy, nome escapado.
 */
const URL =
  'https://refogando.example/api/auth/verify-email?token=jwt.abc&callbackURL=%2Fpt-BR%2Fverify-email%3FreturnTo%3D%252F'

describe('buildVerifyEmail (#470)', () => {
  it('pt-BR por padrão (locale nulo): assunto, saudação, validade e link', () => {
    const mail = buildVerifyEmail({ to: 'ana@x.test', name: 'Ana', locale: null, url: URL })
    expect(mail.to).toBe('ana@x.test')
    expect(mail.subject).toBe('Confirme seu email no Refogando')
    expect(mail.text).toContain('Olá, Ana!')
    expect(mail.text).toContain('24 horas')
    expect(mail.text).toContain(URL)
    expect(mail.html).toContain(`href="${URL.replace(/&/g, '&amp;')}"`)
    expect(mail.html).toContain('Confirmar email')
  })

  it('en-US', () => {
    const mail = buildVerifyEmail({ to: 'bo@x.test', name: 'Bo', locale: 'en-US', url: URL })
    expect(mail.subject).toBe('Confirm your email for Refogando')
    expect(mail.text).toContain('Hi Bo,')
    expect(mail.text).toContain('24 hours')
  })

  it('escapa o nome no HTML', () => {
    const mail = buildVerifyEmail({ to: 'e@x.test', name: '<img src=x>', locale: null, url: URL })
    expect(mail.html).not.toContain('<img src=x>')
    expect(mail.html).toContain('&lt;img src=x&gt;')
  })
})

describe('buildFinishAccountEmail (#470 B1)', () => {
  const RESET = 'https://refogando.example/api/auth/reset-password/tok?callbackURL=%2Fpt-BR%2Freset-password'
  it('"conclua seu cadastro": pede para CRIAR a senha, 1h, nos dois idiomas', () => {
    const pt = buildFinishAccountEmail({ to: 'a@x.test', name: 'Ana', locale: null, url: RESET })
    expect(pt.subject).toBe('Conclua seu cadastro no Refogando')
    expect(pt.text).toContain('crie sua senha')
    expect(pt.text).toContain('1 hora')
    expect(pt.text).toContain(RESET)
    const en = buildFinishAccountEmail({ to: 'a@x.test', name: 'Ana', locale: 'en-US', url: RESET })
    expect(en.subject).toBe('Finish creating your Refogando account')
    expect(en.html).toContain('Create password and activate account')
  })
})
