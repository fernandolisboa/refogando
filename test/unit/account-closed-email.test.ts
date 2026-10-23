import { describe, it, expect } from 'vitest'
import { buildAccountClosedEmail } from '@/server/auth/account-closed-email'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'

/**
 * E-mail de encerramento da conta por violação grave (#606) — montagem pura. Prova: idioma pelo `users.locale`
 * (fallback pt-BR), o link dos Termos no MESMO idioma, a nova análise pelo canal de privacidade e o `name` (input
 * do Usuário) escapado no HTML. Nada do caso vai no e-mail além do fato.
 */
const ORIGIN = 'https://refogando.example'

describe('buildAccountClosedEmail (#606)', () => {
  it('pt-BR por padrão (locale nulo): assunto, saudação, Termos em pt-BR e o canal de nova análise', () => {
    const mail = buildAccountClosedEmail({ to: 'ana@x.test', name: 'Ana', locale: null, origin: ORIGIN })
    expect(mail.to).toBe('ana@x.test')
    expect(mail.subject).toBe(ptBR.auth.emailEncerradaAssunto)
    expect(mail.text).toContain('Olá, Ana.')
    expect(mail.text).toContain('violação grave dos Termos de Uso')
    expect(mail.text).toContain(`${ORIGIN}/pt-BR/termos`)
    expect(mail.text).toContain('privacidade@refogando.com')
    expect(mail.html).toContain(`href="${ORIGIN}/pt-BR/termos"`)
    expect(mail.html).toContain(ptBR.auth.emailEncerradaBotao)
  })

  it('en-US quando a conta salvou esse idioma (case-insensitive), com os Termos em en-US', () => {
    const mail = buildAccountClosedEmail({ to: 'bo@x.test', name: 'Bo', locale: 'en-us', origin: ORIGIN })
    expect(mail.subject).toBe(enUS.auth.emailEncerradaAssunto)
    expect(mail.text).toContain('Hi Bo,')
    expect(mail.text).toContain(`${ORIGIN}/en-US/termos`)
    expect(mail.text).toContain(enUS.auth.emailEncerradaRevisao)
  })

  it('locale não suportado cai no pt-BR, texto e link', () => {
    const mail = buildAccountClosedEmail({ to: 'c@x.test', name: 'C', locale: 'fr-FR', origin: ORIGIN })
    expect(mail.subject).toBe(ptBR.auth.emailEncerradaAssunto)
    expect(mail.text).toContain('/pt-BR/termos')
  })

  it('escapa o nome no HTML, corta nome longo e usa o e-mail quando não há nome', () => {
    const evil = buildAccountClosedEmail({ to: 'e@x.test', name: '<b>Eve</b>', locale: null, origin: ORIGIN })
    expect(evil.html).not.toContain('<b>Eve</b>')
    expect(evil.html).toContain('&lt;b&gt;Eve&lt;/b&gt;')
    const long = buildAccountClosedEmail({ to: 'l@x.test', name: 'x'.repeat(200), locale: null, origin: ORIGIN })
    expect(long.text).not.toContain('x'.repeat(41))
    const anon = buildAccountClosedEmail({ to: 'n@x.test', name: '  ', locale: null, origin: ORIGIN })
    expect(anon.text).toContain('Olá, n@x.test.')
  })
})
