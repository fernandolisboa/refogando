/**
 * Montagem PURA (sem rede, sem DB) dos e-mails de CONTA com link (#469 redefinição de senha, #470 confirmação
 * de e-mail). O envio é dos callbacks do Better Auth em `src/lib/auth.ts`, pelo seam
 * `getMailer().sendAccountEmail`.
 *
 * Idioma = o locale já resolvido pelo chamador; ausente/não suportado ⇒ DEFAULT_LOCALE. Copy vem dos
 * catálogos (`messages.auth.*`), com paridade pt-BR/en-US garantida pelo teste de i18n.
 * `name` é input do Usuário: escapado no HTML e CORTADO em `MAX_NAME` caracteres, para não virar canal de
 * texto arbitrário num e-mail com a marca Refogando.
 */
import { canonicalLocale, DEFAULT_LOCALE } from '@/i18n/locale'
import { MESSAGES, type Messages } from '@/i18n/messages'
import type { MailInput } from '@/server/mail/mailer'

const MAX_NAME = 40

/** As cinco peças de copy de um e-mail de conta com link. `saudacao` interpola `{nome}`. */
export type AccountEmailCopy = {
  assunto: string
  saudacao: string
  corpo: string
  botao: string
  ignorar: string
}

export type AccountEmailInput = {
  to: string
  name: string | null | undefined
  locale: string | null | undefined
  url: string
}

export function buildAccountLinkEmail(
  input: AccountEmailInput,
  pickCopy: (m: Messages['auth']) => AccountEmailCopy,
): MailInput {
  const locale = (input.locale && canonicalLocale(input.locale)) || DEFAULT_LOCALE
  const c = pickCopy(MESSAGES[locale].auth)
  const trimmed = input.name?.trim() ?? ''
  const name = trimmed ? (trimmed.length > MAX_NAME ? `${trimmed.slice(0, MAX_NAME)}…` : trimmed) : input.to
  const greeting = c.saudacao.replace('{nome}', name)
  const greetingHtml = c.saudacao.replace('{nome}', escapeHtml(name))
  const url = escapeHtml(input.url)

  const text = [greeting, '', c.corpo, '', input.url, '', c.ignorar].join('\n')
  const html = [
    `<p>${greetingHtml}</p>`,
    `<p>${escapeHtml(c.corpo)}</p>`,
    `<p><a href="${url}">${escapeHtml(c.botao)}</a></p>`,
    `<p style="color:#666;font-size:13px">${url}</p>`,
    `<p>${escapeHtml(c.ignorar)}</p>`,
  ].join('\n')

  return { to: input.to, subject: c.assunto, text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
