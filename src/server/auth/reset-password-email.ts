/**
 * E-mail de redefinição de senha (#469) — montagem PURA (sem rede, sem DB), testável em unit. O envio é do
 * `sendResetPassword` em `src/lib/auth.ts`, pelo seam `getMailer().sendAccountEmail`.
 *
 * Idioma = `users.locale` do destinatário (a preferência salva); ausente/não suportado ⇒ DEFAULT_LOCALE.
 * Corpo comum aos e-mails de conta em `account-email.ts` (escape do HTML, corte do `name`).
 */
import type { MailInput } from '@/server/mail/mailer'
import { buildAccountLinkEmail, type AccountEmailInput } from '@/server/auth/account-email'

export function buildResetPasswordEmail(input: AccountEmailInput): MailInput {
  return buildAccountLinkEmail(input, (m) => ({
    assunto: m.emailResetAssunto,
    saudacao: m.emailResetSaudacao,
    corpo: m.emailResetCorpo,
    botao: m.emailResetBotao,
    ignorar: m.emailResetIgnorar,
  }))
}
