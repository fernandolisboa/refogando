'use client'
/**
 * `Link` do app (ADR-0061): o `next/link` com o `href` interno PREFIXADO pelo locale da página
 * (`localizeHref`). Use este em vez de `next/link` (o ESLint barra o import direto): `<Link href="/cooks">`
 * numa página `/en-US/...` sai como `/en-US/cooks` no HTML, sem passar pelo 302 do proxy.
 *
 * Por que no `Link` e não em cada `href`: eram ~60 links nus espalhados (header, perfis, cards, rodapé), e o
 * próximo também nasceria nu. O locale vem do `LocaleProvider` (o mesmo segmento da URL que o layout leu), então
 * o HTML do servidor e o 1º render do cliente batem. Fora do provider (seams de teste) o `href` passa intacto.
 */
import NextLink from 'next/link'
import type { ComponentProps } from 'react'
import { useOptionalLocale } from '@/i18n/provider'
import { localizeHref, type Locale } from '@/i18n/locale-path'

type LinkProps = ComponentProps<typeof NextLink>

/** `href` do `next/link` (string ou UrlObject) com o pathname interno prefixado. */
export function localizeLinkHref(locale: Locale, href: LinkProps['href']): LinkProps['href'] {
  if (typeof href === 'string') return localizeHref(locale, href)
  if (href.pathname) return { ...href, pathname: localizeHref(locale, href.pathname) }
  return href
}

export default function Link({ href, ...rest }: LinkProps) {
  const locale = useOptionalLocale()
  return <NextLink href={locale ? localizeLinkHref(locale, href) : href} {...rest} />
}
