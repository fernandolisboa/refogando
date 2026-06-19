import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { loadRecipeRows, loadSocialState } from '@/server/recipe/load'
import { resolveRecipeView } from '@/domain/recipe-read'
import {
  isCozinha,
  isCategoria,
  isRestricao,
  isUnidade,
  isPorcoesValidas,
  isDificuldadeValida,
  type Cozinha,
  type Categoria,
  type Restricao,
  type Unidade,
} from '@/domain/vocabulary'
import { canonicalLocale } from '@/i18n/locale'
import { editOwnRecipe, deleteOwnRecipe, type OwnRecipePatch } from '@/server/recipe/owner-edit'

/**
 * Leitura localizada da Receita (issue #3). Route fino: carrega a espinha +
 * traduções + ingredientes + tags via `loadRecipeRows` (loader de servidor
 * compartilhado — DRY com a retomada da #8) e delega a montagem da view ao módulo
 * PURO `resolveRecipeView` (sem DB). `?locale` escolhe o idioma pedido (padrão
 * DEFAULT_LOCALE). SOMENTE leitura — sem write/edit aqui.
 *
 * Gating de leitura (ADR-0011): catálogo/sistema (owner_id NULL) e Receitas `public`
 * são legíveis por qualquer um (sem auth — preserva os testes da #3). Receita com
 * dono + `private` (cobre toda geração da #8 e as playful) só é legível pelo próprio
 * dono; sem sessão OU dono diferente → 404 not_found (NÃO 401/403 — não vaza
 * existência).
 *
 * #18 (moderação): uma Receita removida do pool pelo Curador (moderation_removed_at) sai
 * da leitura pública (anônimo/não-dono → 404), SEM tocar `visibility` — o Owner CONTINUA
 * dono da linha privada (lê/gerencia a própria, sem voteCount). Remover-do-pool ≠
 * despublicar; as duas dimensões são ortogonais (ver recipe-pool.ts).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const db = getDb()

  // Gating barato ANTES de carregar a view: lê só owner_id + visibility. Receita
  // ausente cai no mesmo not_found (malformado/ausente/sem-acesso indistinguíveis).
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      // #18: removida do pool pela moderação sai da leitura pública (não-dono → 404).
      moderationRemovedAt: recipe.moderationRemovedAt,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return Response.json({ error: 'not_found' }, { status: 404 })

  // Pública/catálogo (owner_id NULL = sistema, ADR-0011) → legível por qualquer um.
  // Caso contrário (com dono + private) exige ser o próprio dono; senão 404 (não vaza
  // existência — mesma forma da rota de retomada em creation-sessions/[id]).
  //
  // #18: uma Receita removida do pool NÃO é leitura pública (isPublicRead=false) — anônimo/
  // não-dono cai no ramo privado → 404 (não vaza). O Owner da própria removida cai no ramo
  // privado, confirma ownership e lê a linha privada (200, SEM voteCount — fora do pool).
  // Remover-do-pool NÃO toca `visibility` (≠ despublicar, AC3).
  //
  // `viewerId` (#59) habilita os campos de gestão (`canManage`/`visibility`/`resultKind`)
  // quando o requester é o dono — NUNCA altera corpo/gate de leitura. Resolvido com
  // parcimônia: nunca lemos a sessão no tráfego anônimo quente (a Busca linka direto pra cá).
  const isPublicRead =
    (gate.ownerId == null || gate.visibility === 'public') && gate.moderationRemovedAt == null
  const requestLocale = parseRequestLocale(request)

  let viewerId: string | undefined
  let rows: Awaited<ReturnType<typeof loadRecipeRows>>
  if (!isPublicRead) {
    // Ramo privado: a sessão GATEIA se vale carregar — só pagamos `loadRecipeRows` depois
    // de confirmar que o requester é o dono (sequencial de propósito: não carregar sem acesso).
    const g = await requireSession(request)
    if (!g.ok || g.session.user.id !== gate.ownerId) {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    viewerId = g.session.user.id
    rows = await loadRecipeRows(db, id)
  } else if (request.headers.get('cookie') != null) {
    // Ramo público COM cookie (com OU sem dono — #16): só vale descobrir o requester quando
    // há cookie (pula o anônimo puro — perf). Antes (#59) este ramo exigia `ownerId != null`,
    // o que NUNCA resolvia o viewerId no Catálogo (ownerId NULL); mas Catálogo É
    // votável/favoritável (#16), então um logado que favoritou no Catálogo precisa ver
    // `viewerFavorited` no detalhe. Resolver a sessão sempre que houver cookie corrige isso.
    // Lê só `g.ok`/`g.session`; JAMAIS `g.response` (leitura pública permanece
    // anônima-friendly, nunca vira 401/404 aqui). A sessão NÃO gateia a carga ⇒ sobrepomos
    // `requireSession` e `loadRecipeRows` (colapsa o round-trip serial do logado quente).
    const [g, loaded] = await Promise.all([requireSession(request), loadRecipeRows(db, id)])
    if (g.ok) viewerId = g.session.user.id
    rows = loaded
  } else {
    // Ramo público anônimo (sem cookie) ou catálogo anônimo: nenhuma sessão a resolver.
    rows = await loadRecipeRows(db, id)
  }
  if (!rows) return Response.json({ error: 'not_found' }, { status: 404 })

  // Estado social (#16): `voteCount` SÓ no pool (isPublicRead) — omitido em owned-private;
  // `viewerVoted`/`viewerFavorited` SÓ quando há viewerId. Junto ao caminho já paralelo.
  const social = await loadSocialState(db, { id, viewerId, includeVoteCount: isPublicRead })

  const view = resolveRecipeView({
    ...rows,
    requestLocale,
    viewerId,
    voteCount: social.voteCount,
    viewerVoted: social.viewerVoted,
    viewerFavorited: social.viewerFavorited,
  })

  return Response.json(view)
}

/**
 * PATCH /api/recipes/[id] — edita a PRÓPRIA Receita IN-PLACE (issue #21). Editar a sua
 * receita (privada OU pública, inclusive a sua derivada) atualiza a MESMA linha — NUNCA forka
 * (o fork da receita NÃO-própria é #17, rota /derive). Confirmação de editar pública é trabalho
 * da UI (história #277) — devolvemos `was_public` para a UI decidir.
 *
 * Ordem dos guards é LOAD-BEARING (espelha visibility.ts / derive / o GET):
 *   1. isUuid → 404 (sem DB; malformado indistinguível de ausente).
 *   2. requireSession → 401 (ANTES do DB; Visitante = zero efeito colateral).
 *   3. SELECT barato (owner_id, visibility) ⇒ ausente / catálogo (ownerId NULL) / não-dono → 404
 *      leak-safe (NUNCA 403; não vaza existência).
 *   4. valida body → 400 dados_invalidos em forma ruim (enums/faixas na borda, evita 22P02→500).
 *   5. editOwnRecipe → 'translation_not_found' (locale inexistente) → 404; senão {ok, was_public}.
 */

type RawIngrediente = { rawText?: unknown; quantidade?: unknown; unidade?: unknown }

type EditOwnBody = {
  locale?: unknown
  titulo?: unknown
  descricao?: unknown
  passos?: unknown
  notas?: unknown
  cozinha?: unknown
  categoria?: unknown
  restricoes?: unknown
  porcoes?: unknown
  dificuldade?: unknown
  ingredientes?: unknown
}

function badRequest(): Response {
  return Response.json({ error: 'dados_invalidos' }, { status: 400 })
}
function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}

/** integer-em-faixa: null ⇒ null; integer na faixa canônica ⇒ valor; senão undefined (inválido). */
function optionalIntInRange(v: unknown, isFaixa: (n: number) => boolean): number | null | undefined {
  if (v === null) return null
  if (typeof v === 'number' && Number.isInteger(v) && isFaixa(v)) return v
  return undefined
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return notFound()

  // Sessão ANTES do DB: Visitante ⇒ 401, zero efeito colateral.
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const viewerId = g.session.user.id

  const db = getDb()

  // Gate barato de ownership: catálogo (ownerId NULL) e dono diferente ⇒ 404 leak-safe.
  const [gate] = await db
    .select({ ownerId: recipe.ownerId, visibility: recipe.visibility })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return notFound()
  if (gate.ownerId == null || gate.ownerId !== viewerId) return notFound()

  // Valida o corpo SÓ depois de autorizar (não revela a forma do contrato a quem não pode editar).
  const body = (await request.json().catch(() => ({}))) as EditOwnBody

  const patch: OwnRecipePatch = {}

  if (body.titulo !== undefined) {
    if (typeof body.titulo !== 'string' || body.titulo.length === 0) return badRequest()
    patch.titulo = body.titulo
  }
  if (body.descricao !== undefined) {
    if (body.descricao !== null && typeof body.descricao !== 'string') return badRequest()
    patch.descricao = body.descricao as string | null
  }
  if (body.passos !== undefined) {
    if (
      body.passos !== null &&
      (!Array.isArray(body.passos) || body.passos.some((p) => typeof p !== 'string'))
    ) {
      return badRequest()
    }
    patch.passos = body.passos as string[] | null
  }
  if (body.notas !== undefined) {
    if (body.notas !== null && typeof body.notas !== 'string') return badRequest()
    patch.notas = body.notas as string | null
  }

  if (body.cozinha !== undefined) {
    if (body.cozinha !== null && (typeof body.cozinha !== 'string' || !isCozinha(body.cozinha))) {
      return badRequest()
    }
    patch.cozinha = body.cozinha as Cozinha | null
  }
  if (body.categoria !== undefined) {
    if (
      body.categoria !== null &&
      (typeof body.categoria !== 'string' || !isCategoria(body.categoria))
    ) {
      return badRequest()
    }
    patch.categoria = body.categoria as Categoria | null
  }
  if (body.restricoes !== undefined) {
    if (!Array.isArray(body.restricoes)) return badRequest()
    const restricoes: Restricao[] = []
    for (const r of body.restricoes) {
      if (typeof r !== 'string' || !isRestricao(r)) return badRequest()
      restricoes.push(r)
    }
    patch.restricoes = restricoes
  }
  if (body.porcoes !== undefined) {
    const v = optionalIntInRange(body.porcoes, isPorcoesValidas)
    if (v === undefined) return badRequest()
    patch.porcoes = v
  }
  if (body.dificuldade !== undefined) {
    const v = optionalIntInRange(body.dificuldade, isDificuldadeValida)
    if (v === undefined) return badRequest()
    patch.dificuldade = v
  }

  // Ingredientes: reescreve do zero (quantidade string|null; unidade enum|null; rawText string|null).
  if (body.ingredientes !== undefined) {
    if (!Array.isArray(body.ingredientes)) return badRequest()
    const ingredientes: NonNullable<OwnRecipePatch['ingredientes']>[number][] = []
    for (const raw of body.ingredientes as RawIngrediente[]) {
      if (typeof raw !== 'object' || raw === null) return badRequest()
      let unidade: Unidade | null = null
      if (raw.unidade !== undefined && raw.unidade !== null) {
        if (typeof raw.unidade !== 'string' || !isUnidade(raw.unidade)) return badRequest()
        unidade = raw.unidade
      }
      let quantidade: string | null = null
      if (raw.quantidade !== undefined && raw.quantidade !== null) {
        if (typeof raw.quantidade !== 'string') return badRequest()
        quantidade = raw.quantidade
      }
      let rawText: string | null = null
      if (raw.rawText !== undefined && raw.rawText !== null) {
        if (typeof raw.rawText !== 'string') return badRequest()
        rawText = raw.rawText.length > 0 ? raw.rawText : null
      }
      ingredientes.push({ rawText, quantidade, unidade })
    }
    patch.ingredientes = ingredientes
  }

  // Resolve o locale alvo da edição traduzível: body.locale presente ⇒ canonicalLocale (null ⇒
  // 404, rejeita cru/não-suportado); ausente ⇒ ?locale do request (DEFAULT_LOCALE se ausente).
  let locale: string
  if (body.locale !== undefined) {
    if (typeof body.locale !== 'string') return notFound()
    const canon = canonicalLocale(body.locale)
    if (canon === null) return notFound()
    locale = canon
  } else {
    locale = parseRequestLocale(request)
  }

  const result = await editOwnRecipe(db, { recipeId: id, viewerId, locale, patch })
  if (result === 'translation_not_found') {
    return Response.json({ error: 'translation_not_found' }, { status: 404 })
  }

  // was_public (história #277): a UI confirma "isto fica visível a quem favoritou" SÓ na pública.
  return Response.json({ ok: true, was_public: gate.visibility === 'public' }, { status: 200 })
}

/**
 * DELETE /api/recipes/[id] — APAGA (hard-delete) a PRÓPRIA Receita (issue #21). Um único
 * DELETE que cascateia os filhos e faz SET NULL nas refs fracas (derivada de terceiro sobrevive
 * com snapshot, só perde o ponteiro — história #157/#288). Sem soft-delete (recipe não tem
 * deleted_at). Mesma ordem/forma de guards do PATCH; 204 no sucesso (sem corpo).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return notFound()

  const g = await requireSession(request)
  if (!g.ok) return g.response
  const viewerId = g.session.user.id

  const db = getDb()

  // Gate barato de ownership (espelha o PATCH): catálogo / não-dono ⇒ 404 leak-safe.
  const [gate] = await db
    .select({ ownerId: recipe.ownerId })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return notFound()
  if (gate.ownerId == null || gate.ownerId !== viewerId) return notFound()

  const result = await deleteOwnRecipe(db, { recipeId: id, viewerId })
  if (result === 'not_found') return notFound() // corrida pós-gate

  return new Response(null, { status: 204 })
}
