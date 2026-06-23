/**
 * Índice do feed `/{locale}/recipes` (#103) — FUNDIDO na home `/{locale}` (#236, ADR-0020: "a
 * Descoberta é a home"). O feed cronológico do pool agora é o ESTADO DE REPOUSO da home (server-rendered
 * e indexável), com a Busca refinando INLINE na mesma superfície — então este índice à parte deixou de
 * existir como tela própria.
 *
 * A página vira um `permanentRedirect('/{locale}')` (308 — canonicalização PERMANENTE, igual ao 301 do
 * detalhe #230): qualquer link/bookmark antigo pro feed cai na home. NÃO toca DB nem cookie — só a
 * decisão de rota (locale do path). O DETALHE `/{locale}/recipes/[id]` (rota IRMÃ) é INTOCADO: só o
 * ÍNDICE do feed funde.
 */
import { permanentRedirect } from 'next/navigation'
import { resolvePageLocale } from '@/server/http/page-locale'

export default async function RecipesIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: pathLocale } = await params
  const locale = resolvePageLocale({ urlLocale: pathLocale })
  // 308 permanente pra home do locale corrente — NÃO retorna (lança e encerra o render).
  permanentRedirect(`/${locale}`)
}
