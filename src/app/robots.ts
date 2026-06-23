/**
 * `robots.txt` (#235, ADR-0020) — gerado pelo Metadata File do Next (`app/robots.ts`).
 *
 * Política: LIBERA o índice (`allow: '/'`) e aponta o sitemap absoluto. O gate `noindex` é POR
 * PÁGINA (`buildRecipeMetadata` emite `robots: noindex` no caminho do dono/não-elegível, #233) — o
 * robots.txt NÃO replica esse gate por-receita; ele só não pode BLOQUEAR o que é indexável. Por isso
 * NÃO desautorizamos `/{locale}/recipes/*` aqui — o sitemap lista só o indexável e cada página
 * não-elegível se auto-protege com `noindex`.
 *
 * Bloqueamos as superfícies NÃO-públicas óbvias: a API (`/api/`, JSON server-only, caminho REAL sem
 * locale) e o painel admin. ATENÇÃO ao casamento de `disallow` (RFC 9309): é prefixo ANCORADO no início
 * do path, então `/admin` casa só o caminho nu — o admin REAL é locale-prefixado (`/pt-BR/admin`,
 * `/en-US/admin`). Por isso adicionamos também a entrada curinga de locale (`/` + `*` + `/admin`,
 * curinga suportado por Google/Bing) que cobre qualquer prefixo de locale. Mesmo assim, a proteção
 * DE VERDADE do admin é o gate de papel
 * (`admin/gate.tsx` + `requireRole`); o robots é só cortesia (nada ali é indexável de qualquer forma).
 *
 * `sitemap` é URL ABSOLUTA via `getBaseUrlFromEnv` (env-only, sem `headers()`) — BUILD-SAFE: este
 * arquivo de metadados pode ser avaliado em build/estaticamente, então NUNCA derivamos o host do
 * request. Função SÍNCRONA (sem I/O) — espelha a casca fina dos demais Metadata Files.
 */
import type { MetadataRoute } from 'next'
import { getBaseUrlFromEnv } from '@/server/http/base-url'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrlFromEnv()
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Superfícies não-públicas: API JSON (`/api/`) e painel admin nu (`/admin`) + locale-prefixado
        // (`/*/admin`, que é o caminho REAL — o admin vive sob `[locale]`).
        disallow: ['/api/', '/admin', '/*/admin'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
