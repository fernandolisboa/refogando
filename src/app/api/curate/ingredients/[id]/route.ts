import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { canonicalLocale } from '@/i18n/locale'
import { updateIngredient, type IngredientTranslationInput } from '@/server/curate/ingredient'

/**
 * PATCH /api/curate/ingredients/[id] — ajusta nome/aliases por locale + alérgeno de um
 * Ingrediente canônico (issue #19, AC3/AC4).
 *
 * Ordem de guards: isUuid→404, requireRole→401/403, validação de borda, depois o efeito.
 * `translations` é OPCIONAL no update (editar só alérgeno é válido). 404 se inexistente.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

type RawTranslation = { locale?: unknown; nome?: unknown; aliases?: unknown }
type UpdateIngredientBody = { alergenos?: unknown; translations?: unknown }

function badRequest(): Response {
  return Response.json({ error: 'dados_invalidos' }, { status: 400 })
}
function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}

/** Valida + canonicaliza translations (opcional no update). `null` ⇒ inválido. */
function parseTranslations(raw: unknown): IngredientTranslationInput[] | null {
  if (!Array.isArray(raw)) return null
  const out: IngredientTranslationInput[] = []
  const seen = new Set<string>()
  for (const t of raw as RawTranslation[]) {
    if (typeof t !== 'object' || t === null) return null
    if (typeof t.locale !== 'string') return null
    const locale = canonicalLocale(t.locale)
    if (locale === null) return null
    if (seen.has(locale)) return null
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return notFound()

  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as UpdateIngredientBody

  let alergenos: string[] | undefined
  if (body.alergenos !== undefined && body.alergenos !== null) {
    if (!Array.isArray(body.alergenos) || body.alergenos.some((a) => typeof a !== 'string')) {
      return badRequest()
    }
    alergenos = body.alergenos as string[]
  }

  let translations: IngredientTranslationInput[] | undefined
  if (body.translations !== undefined && body.translations !== null) {
    const parsed = parseTranslations(body.translations)
    if (parsed === null) return badRequest()
    translations = parsed
  }

  const ok = await updateIngredient(getDb(), { id, alergenos, translations })
  if (!ok) return notFound()

  return Response.json({ ok: true }, { status: 200 })
}
