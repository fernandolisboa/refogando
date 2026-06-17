'use client'
/**
 * Seletor de idioma (issue #4, #4.AC1). <select> NATIVO que chama `setLocale`; trocar
 * o valor alterna TODA a chrome. Mantido nativo de propósito: acessível por teclado de
 * graça e testável por getByRole('combobox')/selectOptions (seam de teste de UI, #54).
 * Rótulos vêm de `messages.locale.*`. Contrato (useLocale/setLocale/options) inalterado;
 * só ganhou estilo tokenizado.
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
      className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg transition-colors hover:border-brand-strong"
    >
      <option value="pt-BR">{messages.locale.ptBR}</option>
      <option value="en-US">{messages.locale.enUS}</option>
    </select>
  )
}
