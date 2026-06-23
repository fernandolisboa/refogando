/**
 * Proxy de roteamento por locale-no-caminho (issue #228, ADR-0020).
 *
 * No Next.js 16 a convenção `middleware` foi renomeada para `proxy` (runtime nodejs-only,
 * sem edge) — daí `proxy.ts` + `export function proxy`. Aqui o proxy é DELIBERADAMENTE fino:
 * delega a decisão inteira ("dado pathname + headers, qual redirect?") ao núcleo PURO
 * `decideLocaleRedirect` (testado no projeto "ui", sem banco) e só a traduz em `NextResponse`.
 *
 * Comportamento:
 *  - raiz `/` e qualquer caminho NÃO-prefixado → 302 pro caminho com locale detectado
 *    (cookie → Accept-Language → DEFAULT_LOCALE), preservando a rota e a query.
 *  - prefixo de locale com case errado (`/pt-br/...`) → 302 normalizando o case.
 *  - caminho já corretamente prefixado → segue (`NextResponse.next()`), SEM loop.
 *  - o redirect é SEMPRE 302 (temporário), NUNCA 301 — 301 cacheável colaria o usuário no 1º
 *    idioma resolvido. A resposta da raiz/prefixação leva `Vary: Accept-Language` (o destino
 *    depende do header, então caches não devem servir uma variante por outra).
 *
 * O `matcher` exclui `api`, `_next/*`, arquivos de metadados e assets com extensão: essas
 * rotas NÃO são páginas de UI e não devem ser prefixadas (a API é versionada por `:id`/dados,
 * não por locale — ADR-0010).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { decideLocaleRedirect } from '@/i18n/locale-path'

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl

  const decision = decideLocaleRedirect({
    pathname,
    cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: request.headers.get('accept-language'),
  })

  if (!decision) {
    // Caminho já corretamente prefixado: segue. Ainda marca Vary porque a NEGOCIAÇÃO de
    // locale (na raiz/prefixação) depende do Accept-Language — caches intermediários não
    // devem servir uma variante de idioma por outra.
    const res = NextResponse.next()
    res.headers.set('Vary', 'Accept-Language')
    return res
  }

  // Preserva a query string no destino (a rota muda só o prefixo de locale).
  const url = new URL(decision.to + search, request.url)
  const res = NextResponse.redirect(url, decision.status)
  res.headers.set('Vary', 'Accept-Language')
  return res
}

export const config = {
  matcher: [
    /*
     * Casa todos os caminhos EXCETO:
     *  - api            (route handlers — dados, não páginas; não prefixar)
     *  - _next/static   (assets de build)
     *  - _next/image    (otimização de imagem)
     *  - arquivos de metadados (favicon/sitemap/robots/manifest)
     *  - qualquer caminho que contenha um ponto (`.*\\..*`) — assets com extensão de arquivo.
     *    Slugs de receita são normalizados sem ponto (ADR-0020), então não colidem com isto.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.webmanifest|.*\\..*).*)',
  ],
}
