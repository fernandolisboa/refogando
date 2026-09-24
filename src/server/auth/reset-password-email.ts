/**
 * E-mail de redefinição de senha (#469) — montagem PURA (sem rede, sem DB), testável em unit. O envio é do
 * `sendResetPassword` em `src/lib/auth.ts`, pelo seam `getMailer().sendAccountEmail`.
 *
 * Idioma = `users.locale` do destinatário (a preferência salva); ausente/não suportado ⇒ DEFAULT_LOCALE.
 * Copy vem dos catálogos (`messages.auth.emailReset*`), com paridade pt-BR/en-US garantida pelo teste de i18n.
 * `name` é input do Usuário (sem verificação de e-mail no cadastro): escapado no HTML e CORTADO em
 * `MAX_NAME` caracteres, para não virar canal de texto arbitrário num e-mail com a marca Refogando.
 */
import { canonicalLocale, DEFAULT_LOCALE } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import type { MailInput } from '@/server/mail/mailer'

const MAX_NAME = 40

export function buildResetPasswordEmail(input: {
  to: string
  name: string | null | undefined
  locale: string | null | undefined
  url: string
}): MailInput {
  const locale = (input.locale && canonicalLocale(input.locale)) || DEFAULT_LOCALE
  const m = MESSAGES[locale].auth
  const trimmed = input.name?.trim() ?? ''
  const name = trimmed ? (trimmed.length > MAX_NAME ? `${trimmed.slice(0, MAX_NAME)}…` : trimmed) : input.to
  const greeting = m.emailResetSaudacao.replace('{nome}', name)
  const greetingHtml = m.emailResetSaudacao.replace('{nome}', escapeHtml(name))
  const url = escapeHtml(input.url)

  const text = [greeting, '', m.emailResetCorpo, '', input.url, '', m.emailResetIgnorar].join('\n')
  const html = [
    `<p>${greetingHtml}</p>`,
    `<p>${escapeHtml(m.emailResetCorpo)}</p>`,
    `<p><a href="${url}">${escapeHtml(m.emailResetBotao)}</a></p>`,
    `<p style="color:#666;font-size:13px">${url}</p>`,
    `<p>${escapeHtml(m.emailResetIgnorar)}</p>`,
  ].join('\n')

  return { to: input.to, subject: m.emailResetAssunto, text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
