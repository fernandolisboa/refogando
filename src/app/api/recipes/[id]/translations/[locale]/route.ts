import { eq } from 'drizzle-orm'
import { requireSession, requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { canonicalLocale } from '@/i18n/locale'
import { recipe } from '@/db/schema'
import { ensureTranslation } from '@/server/recipe/translation'
import { loadRecipeRows } from '@/server/recipe/load'
import { resolveRecipeView } from '@/domain/recipe-read'
import { isCommunityVisible } from '@/domain/recipe-visibility-check'
import { editTranslatedIngredientNames } from '@/server/curate/translation-ingredient-names'

/**
 * Tradução on-demand do 2º locale (issue #23, AC1). POST dedicado (decisão congelada —
 * o GET fica read-only, ADR-0011); o 1º POST num 2º locale gera a tradução automática
 * sinalizada + embedding e devolve a view localizada. Espelha `publish/route.ts` (forma
 * de rota de write) + o gate de leitura de `recipes/[id]/route.ts`.
 *
 * Ordem dos guards (load-bearing): `isUuid` antes do DB (404 leak-safe p/ id malformado,
 * sem 22P02/500); `canonicalLocale` valida E canoniza ('EN-US'→'en-US', null⇒404); a
 * sessão ANTES de tocar o DB; o gate de acesso devolve 404 (NUNCA 401/403 por existência).
 * O `targetLocale` e o `requestLocale` da view são SEMPRE o canônico (nunca o path cru).
 *
 * #18 (moderação): uma Receita removida do pool pelo Curador deixa de ser conteúdo de
 * comunidade — um não-dono não a lê NEM dispara `ensureTranslation` (que geraria/embedaria
 * conteúdo moderado em outro locale, vazando a Receita em AMBOS os locales — viola AC4). O
 * dono mantém acesso à própria linha privada (AC3), mas SEM gerar tradução de conteúdo
 * moderado. Remover-do-pool NÃO toca `visibility` (ver recipe-pool.ts).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
// A tradução sob demanda chama o LLM com o modelo/thinking do admin (ADR-0034): folga além dos 10s default.
export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; locale: string }> },
): Promise<Response> {
  const { id, locale: rawLocale } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  // Valida E canoniza: locale não suportado ⇒ 404 (leak-safe consistente, §5.7).
  const locale = canonicalLocale(rawLocale)
  if (locale === null) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const db = getDb()

  // Gate de acesso (ADR-0011 + #18): catálogo (owner NULL) OU pública OU dono — MAS uma
  // Receita removida do pool pela moderação (#18) NÃO é comunidade para não-donos (o dono
  // mantém acesso à própria linha privada, AC3). Senão 404 leak-safe.
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      moderationRemovedAt: recipe.moderationRemovedAt,
      curationStatus: recipe.curationStatus,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return Response.json({ error: 'not_found' }, { status: 404 })
  const removed = gate.moderationRemovedAt != null
  // #238: rascunho de catálogo (não-aprovado) não é comunidade ⇒ não serve/gera tradução pública.
  const canAccess =
    (!removed && isCommunityVisible(gate.ownerId, gate.visibility, gate.curationStatus)) ||
    gate.ownerId === g.session.user.id
  if (!canAccess) return Response.json({ error: 'not_found' }, { status: 404 })

  // Gera a tradução on-demand (idempotente; degrada graciosamente se o translator falhar).
  // #18: PULA quando a Receita está removida do pool — não gerar/embedar conteúdo moderado
  // (o dono que ainda lê recebe a view com o que já existe, sem efeito de tradução).
  if (!removed) await ensureTranslation(db, id, locale)

  // Devolve a view localizada no locale CANÔNICO (mesma máquina de leitura da #3).
  const rows = await loadRecipeRows(db, id)
  if (!rows) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json(
    resolveRecipeView({ ...rows, requestLocale: locale }),
    { status: 200 },
  )
}

type PatchIngredientEdit = { ordem?: unknown; nome?: unknown }
type PatchBody = { edits?: unknown }

function badRequest(): Response {
  return Response.json({ error: 'dados_invalidos' }, { status: 400 })
}
function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}

/**
 * Curador edita o NOME de ingrediente traduzido na fila (issue #498, ADR-0031 companheiro
 * (iii)) — grava no `ingredientes jsonb` de `recipe_translation` por `ordem`. Age por PAPEL
 * (curador), NÃO por ownership — espelha `review/route.ts` (mesma ação de curadoria de
 * tradução): `requireRole('curador')` + MESMO gate de comunidade/moderação (`isCommunityVisible`
 * + `moderationRemovedAt IS NULL`), 404 leak-safe para conteúdo privado ou removido do pool.
 * DELIBERADAMENTE mais amplo que `/api/curate/recipes/[id]` (que só cobre Catálogo): aqui
 * cobre Catálogo E receita PÚBLICA de usuário comum — mas mais ESTREITO no que edita (só
 * nomes de ingrediente, nunca titulo/descricao/passos/notas/categorização).
 *
 * NÃO re-sluga (não toca `slug`), NÃO re-localiza a medida (não toca `recipe_ingredient`).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; locale: string }> },
): Promise<Response> {
  const { id, locale: rawLocale } = await params
  if (!isUuid(id)) return notFound()

  const locale = canonicalLocale(rawLocale)
  if (locale === null) return notFound()

  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const db = getDb()

  // Gate de comunidade (espelha review/route.ts): curador NÃO toca receita privada nem
  // removida do pool pela moderação (#18) — 404 leak-safe.
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      moderationRemovedAt: recipe.moderationRemovedAt,
      curationStatus: recipe.curationStatus,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return notFound()
  const isCommunity =
    isCommunityVisible(gate.ownerId, gate.visibility, gate.curationStatus) &&
    gate.moderationRemovedAt == null
  if (!isCommunity) return notFound()

  const body = (await request.json().catch(() => ({}))) as PatchBody
  if (!Array.isArray(body.edits)) return badRequest()

  const edits: { ordem: number; nome: string }[] = []
  for (const raw of body.edits as PatchIngredientEdit[]) {
    if (typeof raw !== 'object' || raw === null) return badRequest()
    if (typeof raw.ordem !== 'number' || !Number.isInteger(raw.ordem)) return badRequest()
    if (typeof raw.nome !== 'string') return badRequest()
    const nome = raw.nome.trim()
    if (nome.length === 0) return badRequest()
    edits.push({ ordem: raw.ordem, nome })
  }

  const result = await editTranslatedIngredientNames(db, { recipeId: id, locale, edits })
  if (result.kind === 'translation_not_found') return notFound()
  if (result.kind === 'invalid_ordem') return badRequest()

  return Response.json({ ok: true }, { status: 200 })
}
