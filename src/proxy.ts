/**
 * Proxy de roteamento por locale-no-caminho (issue #228, ADR-0020).
 *
 * No Next.js 16 a convenção `middleware` foi renomeada para `proxy` (runtime nodejs-only,
 * sem edge) — daí `proxy.ts` + `export function proxy`. Aqui o proxy é DELIBERADAMENTE fino:
 * delega a decisão inteira ("dado pathname + headers, qual redirect?") ao núcleo PURO
 * `decideLocaleRedirect` (testado no projeto "ui", sem banco) e só a traduz em `NextResponse`.
 *
 * Comportamento (ADR-0020 decisão 1+4 — redirects PERMANENTES emitidos como 301 LITERAL aqui,
 * porque o proxy roda em nodejs e pode escolher o status — diferente de um `permanentRedirect`
 * de Server Component, que serve 308):
 *  - raiz `/` e qualquer caminho NÃO-prefixado → **302** pro caminho com locale DETECTADO
 *    (cookie → Accept-Language → DEFAULT_LOCALE), preservando a rota e a query. Temporário e
 *    NUNCA 301 — o destino depende do `Accept-Language`; um 301 cacheável colaria o usuário no 1º
 *    idioma resolvido. Leva `Vary: Accept-Language` (caches não devem servir uma variante por outra).
 *  - prefixo de locale com case errado (`/pt-br/...`) → **301** normalizando o case. O idioma vem
 *    do PATH (não da detecção): canonicalização permanente, Accept-Language-independente — então
 *    NÃO leva `Vary` (o destino não depende do header).
 *  - link LEGADO `/{locale}/recipes/<uuid>` → **301** pro slug canônico `/{locale}/recipes/<slug>`
 *    (ADR-0020 decisão 4) — SÓ quando a Receita é leitura PÚBLICA (gate de índice) e tem slug
 *    naquele locale. Lookup no DB DIRETO (o proxy é nodejs, igual ao 301 de case). Se a Receita
 *    NÃO é pública (privada/playful/removida) ou não tem slug, NÃO redireciona: deixa a página
 *    tratar o UUID pelo caminho do DONO (cookie, 404 leak-safe) — não vaza slug/existência.
 *  - caminho já corretamente prefixado → segue (`NextResponse.next()`), SEM loop, com `Vary`.
 *
 * O `matcher` exclui `api`, `_next/*`, arquivos de metadados e assets com extensão: essas
 * rotas NÃO são páginas de UI e não devem ser prefixadas (a API é versionada por `:id`/dados,
 * não por locale — ADR-0010).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { decideLocaleRedirect, LOCALE_DETECT_REDIRECT_STATUS } from '@/i18n/locale-path'
import {
  parseLegacyUuidDetailPath,
  recipeDetailPath,
  LEGACY_UUID_REDIRECT_STATUS,
} from '@/domain/recipe-detail-route'
import { getDb } from '@/server/deps'
import { resolvePublicSlugForLocale } from '@/server/recipe/load'

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl

  const decision = decideLocaleRedirect({
    pathname,
    cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: request.headers.get('accept-language'),
  })

  if (!decision) {
    // Caminho já prefixado corretamente. ANTES de seguir, checa o link LEGADO por UUID:
    // `/{locale}/recipes/<uuid>` → 301 pro slug canônico (ADR-0020 decisão 4), SÓ quando público.
    const legacy = parseLegacyUuidDetailPath(pathname)
    if (legacy) {
      const slug = await resolvePublicSlugForLocale(getDb(), legacy.uuid, legacy.locale)
      if (slug != null) {
        // 301 LITERAL — canonicalização permanente (igual ao 301 de case). Preserva a query.
        const to = new URL(recipeDetailPath(legacy.locale, slug) + search, request.url)
        return NextResponse.redirect(to, LEGACY_UUID_REDIRECT_STATUS)
      }
      // Não-público (privado/playful/removido) ou sem slug: NÃO redireciona — segue pra página,
      // que trata o UUID pelo caminho do dono (cookie, leak-safe). Cai no `next()` abaixo.
    }

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
  // `Vary: Accept-Language` SÓ quando o destino depende do header — i.e. na DETECÇÃO (302). A
  // normalização de case (301) é canonicalização independente do header: emitir Vary ali seria
  // inócuo mas desnecessário (não há variação por idioma a proteger).
  if (decision.status === LOCALE_DETECT_REDIRECT_STATUS) {
    res.headers.set('Vary', 'Accept-Language')
  }
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
