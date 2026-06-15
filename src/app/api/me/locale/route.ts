import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { isSupportedLocale } from '@/i18n/locale'

/**
 * Round-trip de `users.locale` — o seam de servidor de #4.AC5 == #5.AC4 (ADR-0014).
 * Gated a logado (qualquer papel >= usuario; basta `requireSession`): 401 = Visitante
 * ou conta soft-deletada (D4/D8).
 *
 * GET lê `users.locale` (string | null). PUT grava após validar `isSupportedLocale`.
 *
 * E10 — a validação da ESCRITA restringir a SUPPORTED_LOCALES (pt-BR/en-US) é DE
 * PROPÓSITO, não um bug: só persistimos locales que a chrome sabe renderizar. NÃO
 * contradiz D1 — o "text livre" de D1 governa o TIPO da coluna (`users.locale` é text
 * nullable) e a leitura/futuro (ampliar o array, sem migração); a escrita do chrome é
 * a fronteira intencional. Toca SÓ `users` — nunca `recipe` (#4.AC4).
 */

export async function GET(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const [row] = await getDb()
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, g.session.user.id))
  return Response.json({ locale: row?.locale ?? null })
}

export async function PUT(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => ({}))) as { locale?: unknown }
  if (typeof body.locale !== 'string' || !isSupportedLocale(body.locale)) {
    return Response.json({ error: 'locale_invalido' }, { status: 400 })
  }
  await getDb()
    .update(users)
    .set({ locale: body.locale, updatedAt: new Date() })
    .where(eq(users.id, g.session.user.id))
  return Response.json({ locale: body.locale })
}
