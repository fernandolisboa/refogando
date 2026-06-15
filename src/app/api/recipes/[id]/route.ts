import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { recipe, recipeTranslation, recipeIngredient, recipeTag, tag } from '@/db/schema'
import { resolveRecipeView } from '@/domain/recipe-read'

/**
 * Leitura localizada da Receita (issue #3). Route fino: lê a espinha + traduções +
 * ingredientes + tags do Postgres e delega a montagem da view ao módulo PURO
 * `resolveRecipeView` (sem DB). `?locale` escolhe o idioma pedido (padrão pt-BR).
 *
 * Usa `db.select()` explícito (NÃO a relational query API): joins enxutos, sem
 * acoplar o route ao grafo de relações. SOMENTE leitura — sem write/edit aqui.
 */

const DEFAULT_LOCALE = 'pt-BR'

// `id` cai numa coluna uuid: um valor malformado faz o Postgres lançar 22P02 (e o
// route 500ar, vazando SQL). Curto-circuitamos para o MESMO not_found — malformado é
// indistinguível de ausente na superfície da API.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const requestLocale = new URL(request.url).searchParams.get('locale') ?? DEFAULT_LOCALE

  const db = getDb()

  const [row] = await db.select().from(recipe).where(eq(recipe.id, id))
  if (!row) return Response.json({ error: 'not_found' }, { status: 404 })

  // As três leituras seguintes são independentes entre si: em paralelo.
  const [translations, ingredients, tags] = await Promise.all([
    db.select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, id)),
    db
      .select({
        ordem: recipeIngredient.ordem,
        quantidade: recipeIngredient.quantidade,
        unidade: recipeIngredient.unidade,
        rawText: recipeIngredient.rawText,
      })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, id))
      .orderBy(recipeIngredient.ordem, recipeIngredient.id),
    db
      .select({ nome: tag.nome })
      .from(recipeTag)
      .innerJoin(tag, eq(recipeTag.tagId, tag.id))
      .where(eq(recipeTag.recipeId, id))
      .orderBy(tag.nome),
  ])

  const view = resolveRecipeView({
    recipe: row,
    translations,
    ingredients,
    tags: tags.map((t) => t.nome),
    requestLocale,
  })

  return Response.json(view)
}
