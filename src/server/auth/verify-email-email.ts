/**
 * E-mail de confirmação de e-mail (#470) — montagem PURA (sem rede, sem DB), testável em unit. O envio é do
 * `emailVerification.sendVerificationEmail` em `src/lib/auth.ts`, pelo seam `getMailer().sendAccountEmail`.
 *
 * Idioma = o locale resolvido pelo chamador (`users.locale`, senão o cookie/Accept-Language do request do
 * cadastro — conta nova ainda não tem `locale` salvo). Corpo comum em `account-email.ts`.
 */
import type { MailInput } from '@/server/mail/mailer'
import { buildAccountLinkEmail, type AccountEmailInput } from '@/server/auth/account-email'

/**
 * "Conclua seu cadastro" (#470 B1) — o reenvio PÚBLICO para conta não confirmada manda um link de SENHA (token do
 * reset, 1h, uso único) em vez do de confirmação: quem concluir define a senha que passa a valer.
 */
export function buildFinishAccountEmail(input: AccountEmailInput): MailInput {
  return buildAccountLinkEmail(input, (m) => ({
    assunto: m.emailConcluirAssunto,
    saudacao: m.emailConcluirSaudacao,
    corpo: m.emailConcluirCorpo,
    botao: m.emailConcluirBotao,
    ignorar: m.emailConcluirIgnorar,
  }))
}

export function buildVerifyEmail(input: AccountEmailInput): MailInput {
  return buildAccountLinkEmail(input, (m) => ({
    assunto: m.emailVerificarAssunto,
    saudacao: m.emailVerificarSaudacao,
    corpo: m.emailVerificarCorpo,
    botao: m.emailVerificarBotao,
    ignorar: m.emailVerificarIgnorar,
  }))
}
