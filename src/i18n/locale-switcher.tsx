'use client'
/**
 * Seletor de idioma (issue #4, #4.AC1). <select> simples que chama `setLocale`; trocar
 * o valor alterna TODA a chrome (provado no passo verify com browser MCP — E9, não em npm test).
 * Rótulos vêm de `messages.locale.*`.
 */
import { useLocale } from '@/i18n/provider'
import { SUPPORTED_LOCALES } from '@/i18n/locale'

export function LocaleSwitcher() {
  const { locale, setLocale, messages } = useLocale()
  return (
    <select
      aria-label={messages.locale.label}
      value={locale}
      onChange={(e) => setLocale(e.target.value as (typeof SUPPORTED_LOCALES)[number])}
    >
      <option value="pt-BR">{messages.locale.ptBR}</option>
      <option value="en-US">{messages.locale.enUS}</option>
    </select>
  )
}
