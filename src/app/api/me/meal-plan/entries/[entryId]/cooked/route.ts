import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { applyCookedMealToPantry } from '@/server/pantry/pantry'

/**
 * "Cozinhei" numa Refeição planejada do próprio usuário (ADR-0042): tira da Despensa os itens que cobrem
 * algum Item da Receita daquela entrada (o mesmo casamento do "o que dá pra fazer"), nunca os básicos da
 * pessoa. O cliente só diz QUAL entrada; Receita e nomes saem do servidor. Sem estado gravado: tocar de novo
 * devolve `removed: []`. uuid malformado ⇒ o MESMO 404 de "não é sua".
 *
 * POST [?locale] → 200 `{ ok: true, removed: {id, nome}[], keptBasics: string[] }` (`removed` vazio = nada
 *   da Despensa bateu) | 404 not_found | 409 sem_receita (a entrada é uma Anotação).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

type Ctx = { params: Promise<{ entryId: string }> }

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const { entryId } = await params
  if (!isUuid(entryId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const requestLocale = parseRequestLocale(request)
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const res = await applyCookedMealToPantry({ db: getDb(), userId: g.session.user.id, entryId, locale })
  switch (res.kind) {
    case 'ok':
      return Response.json(
        {
          ok: true,
          removed: res.removed.map((r) => ({ id: r.id, nome: r.nome })),
          keptBasics: res.keptBasics,
        },
        { status: 200 },
      )
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'no_recipe':
      return Response.json({ error: 'sem_receita' }, { status: 409 })
  }
}
