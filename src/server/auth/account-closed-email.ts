/**
 * E-mail de ENCERRAMENTO da conta por violação grave dos Termos (#606, Termos item 8, ADR-0051 P3) — montagem PURA
 * (sem rede, sem DB), testável em unit. O envio é do `closeAccountByAdmin` (`src/server/admin/account-closure.ts`),
 * depois do commit da eliminação, pelo seam `getMailer().sendAccountEmail`.
 *
 * Idioma = `users.locale` lido ANTES da eliminação (ela o zera); ausente/não suportado ⇒ DEFAULT_LOCALE. O link é a
 * página dos Termos no mesmo idioma. Corpo comum aos e-mails de conta em `account-email.ts` (escape do HTML, corte
 * do `name`). Sem nome de Curador, sem texto livre do caso: só o fato, os Termos e como pedir nova análise.
 */
import { canonicalLocale, DEFAULT_LOCALE } from '@/i18n/locale'
import type { MailInput } from '@/server/mail/mailer'
import { buildAccountLinkEmail } from '@/server/auth/account-email'

export type AccountClosedEmailInput = {
  to: string
  name: string | null | undefined
  locale: string | null | undefined
  /** Origem confiável do app (ENV), sem barra no fim; o link vira `<origem>/<locale>/termos`. */
  origin: string
}

export function buildAccountClosedEmail(input: AccountClosedEmailInput): MailInput {
  // Mesma regra de idioma do `buildAccountLinkEmail`, resolvida aqui para o link dos Termos casar com o texto.
  const locale = (input.locale && canonicalLocale(input.locale)) || DEFAULT_LOCALE
  return buildAccountLinkEmail(
    { to: input.to, name: input.name, locale, url: new URL(`/${locale}/termos`, input.origin).toString() },
    (m) => ({
      assunto: m.emailEncerradaAssunto,
      saudacao: m.emailEncerradaSaudacao,
      corpo: m.emailEncerradaCorpo,
      botao: m.emailEncerradaBotao,
      ignorar: m.emailEncerradaRevisao,
    }),
  )
}
