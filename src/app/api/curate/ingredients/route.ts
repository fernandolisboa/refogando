import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { canonicalLocale } from '@/i18n/locale'
import { createIngredient, type IngredientTranslationInput } from '@/server/curate/ingredient'

/**
 * POST /api/curate/ingredients — cria Ingrediente canônico (issue #19, AC3).
 *
 * Rota fina: gating por papel (Curador), validação de borda (≥1 tradução com locale
 * canonicalizável + nome não-vazio; sem locale duplicado; slug/alergenos opcionais),
 * depois delega a `createIngredient`. 23505 do slug ⇒ 409 slug_em_uso.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

type RawTranslation = { locale?: unknown; nome?: unknown; aliases?: unknown }
type CreateIngredientBody = { slug?: unknown; alergenos?: unknown; translations?: unknown }

function badRequest(): Response {
  return Response.json({ error: 'dados_invalidos' }, { status: 400 })
}

/** Valida + canonicaliza as translations. `null` ⇒ inválido. */
function parseTranslations(raw: unknown): IngredientTranslationInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: IngredientTranslationInput[] = []
  const seen = new Set<string>()
  for (const t of raw as RawTranslation[]) {
    if (typeof t !== 'object' || t === null) return null
    if (typeof t.locale !== 'string') return null
    const locale = canonicalLocale(t.locale)
    if (locale === null) return null
    if (seen.has(locale)) return null // duplicado colidiria com a UNIQUE (ingredientId,locale)
    seen.add(locale)
    if (typeof t.nome !== 'string' || t.nome.length === 0) return null
    let aliases: string[] | null = null
    if (t.aliases !== undefined && t.aliases !== null) {
      if (!Array.isArray(t.aliases) || t.aliases.some((a) => typeof a !== 'string')) return null
      aliases = t.aliases as string[]
    }
    out.push({ locale, nome: t.nome, aliases })
  }
  return out
}

/** Valida alergenos (array de string, opcional). `false` ⇒ inválido; undefined ⇒ ausente. */
function parseAlergenos(raw: unknown): string[] | undefined | false {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.some((a) => typeof a !== 'string')) return false
  return raw as string[]
}

export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as CreateIngredientBody

  const translations = parseTranslations(body.translations)
  if (translations === null) return badRequest()

  const alergenos = parseAlergenos(body.alergenos)
  if (alergenos === false) return badRequest()

  let slug: string | null = null
  if (body.slug !== undefined && body.slug !== null) {
    if (typeof body.slug !== 'string' || body.slug.length === 0) return badRequest()
    slug = body.slug
  }

  const result = await createIngredient(getDb(), { slug, alergenos, translations })
  if (result === 'slug_em_uso') return Response.json({ error: 'slug_em_uso' }, { status: 409 })

  return Response.json({ id: result.id }, { status: 200 })
}
