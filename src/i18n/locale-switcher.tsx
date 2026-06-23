'use client'
/**
 * Seletor de idioma (issue #4, #4.AC1; revisto p/ locale-no-caminho #228/ADR-0020). <select>
 * NATIVO: acessível por teclado de graça e testável por getByRole('combobox')/selectOptions
 * (seam de teste de UI, #54). Vive no FOOTER (ao lado do ThemeToggle, #162).
 *
 * Locale-no-caminho (ADR-0020 Consequências): a URL é a FONTE DA VERDADE do idioma exibido, então
 * trocar de idioma NAVEGA pra URL irmã (`/{novoLocale}{resto}`) — não basta setar o cookie e
 * mutar `<html lang>`. Sem navegar, ficaríamos com `<html lang>` e a chrome em EN mas o path e o
 * corpo renderizado pelo servidor em PT (lang ≠ conteúdo — defeito de a11y/SEO; um leitor de tela
 * anunciaria conteúdo PT como EN). `setLocale` ainda roda (persiste o cookie, que decide o redirect
 * da RAIZ `/` no proxy); o `router.push` é o que faz lang/URL/corpo concordarem. A navegação
 * sibling-por-slug do detalhe é #231 — aqui trocamos só o PREFIXO de locale, preservando o resto
 * do path e a query (um link bare→canônico que o proxy resolveria de qualquer forma).
 */
import { useRouter, usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { SUPPORTED_LOCALES } from '@/i18n/locale'
import { splitLocalePrefix, localePrefixedPath } from '@/i18n/locale-path'

export function LocaleSwitcher() {
  const { locale, setLocale, messages } = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  function onChange(next: (typeof SUPPORTED_LOCALES)[number]) {
    if (next === locale) return
    // Persiste o cookie + sincroniza a chrome (mesmos efeitos de antes). O cookie ainda importa:
    // decide o redirect da raiz `/` no proxy.
    setLocale(next)
    // Troca SÓ o prefixo de locale do path corrente, preservando o resto (`rest`). `usePathname`
    // já vem prefixado (`/pt-BR/...`); um path sem prefixo (não deveria ocorrer sob `[locale]`)
    // cai no `rest` inteiro, então prefixamos do zero — nunca duplica.
    const { rest } = splitLocalePrefix(pathname || '/')
    router.push(localePrefixedPath(next, rest))
  }

  return (
    <select
      aria-label={messages.locale.label}
      value={locale}
      onChange={(e) => onChange(e.target.value as (typeof SUPPORTED_LOCALES)[number])}
      className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg transition-colors hover:border-brand-strong"
    >
      <option value="pt-BR">PT-BR</option>
      <option value="en-US">EN-US</option>
    </select>
  )
}
