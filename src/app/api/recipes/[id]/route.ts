import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import { recipe } from '@/db/schema'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { loadRecipeDetailView } from '@/server/recipe/detail-view'
import {
  isActiveCozinha,
  isCategoria,
  isRestricao,
  isUnidade,
  isPorcoesValidas,
  isDificuldadeValida,
  isTempoValido,
  type Cozinha,
  type Categoria,
  type Restricao,
  type Unidade,
} from '@/domain/vocabulary'
import { loadActiveCozinhaSlugs } from '@/server/vocabulary/active-set'
import { suggestCozinha, cozinhaSlugFromText, COZINHA_OUTRA_MAX } from '@/server/vocabulary/suggest'
import { canonicalLocale } from '@/i18n/locale'
import { editOwnRecipe, deleteOwnRecipe, type OwnRecipePatch } from '@/server/recipe/owner-edit'

/**
 * GET: leitura localizada da Receita (issue #3). Route FINO: delega TUDO a `loadRecipeDetailView`
 * (loader compartilhado com o caminho do dono de `/{locale}/recipes/[id]`, que o chama direto, sem
 * self-fetch). `?locale` escolhe o idioma pedido (padrão DEFAULT_LOCALE). Contrato: o gating
 * (ADR-0011, #18) mora no loader; `null` vira 404 not_found leak-safe (NUNCA 401/403).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  // Toda a leitura (gate barato, sessão só quando precisa, view) mora no loader compartilhado com a
  // página do detalhe. `null` = malformado/ausente/sem-acesso ⇒ o MESMO 404 leak-safe.
  const view = await loadRecipeDetailView(getDb(), {
    id,
    requestLocale: parseRequestLocale(request),
    headers: request.headers,
  })
  if (view == null) return Response.json({ error: 'not_found' }, { status: 404 })
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
  // "Outra" (#319, ADR-0025 Decisão 5): cozinha livre na EDIÇÃO. PRECEDÊNCIA sobre `cozinha`.
  cozinhaOutra?: unknown
  categoria?: unknown
  restricoes?: unknown
  porcoes?: unknown
  dificuldade?: unknown
  tempoAtivoMin?: unknown
  tempoTotalMin?: unknown
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
  // Corpo ausente (sem texto) ⇒ patch vazio (no-op tolerado). Corpo PRESENTE mas JSON inválido ⇒
  // 400 dados_invalidos (não trata silenciosamente como vazio — FIX 6).
  const rawBody = await request.text()
  let body: EditOwnBody = {}
  if (rawBody.length > 0) {
    try {
      const parsed = JSON.parse(rawBody) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return badRequest()
      body = parsed as EditOwnBody
    } catch {
      return badRequest()
    }
  }

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

  // "Outra" (#319, ADR-0025 Decisão 5): cozinha livre tem PRECEDÊNCIA sobre `cozinha`. Aqui o slug é
  // só VALIDADO e COMPUTADO (puro), BYPASSANDO de propósito o guard `isActiveCozinha` (um `suggested`
  // é não-ativo por design); a MATERIALIZAÇÃO do termo fica DEFERIDA pra depois que TODO o corpo
  // validar (logo antes de editOwnRecipe), pra que um 400 num campo posterior nunca deixe um termo
  // órfão na fila do Curador (#320). Texto vazio/só-símbolo (slug vazio) OU longo demais ⇒ 400.
  // Quando AUSENTE, segue o ramo `cozinha` (ativa ou limpa-p/-null).
  let cozinhaOutraSlug: string | null = null
  if (body.cozinhaOutra !== undefined) {
    if (typeof body.cozinhaOutra !== 'string' || body.cozinhaOutra.trim() === '') return badRequest()
    if (body.cozinhaOutra.trim().length > COZINHA_OUTRA_MAX) return badRequest()
    const s = cozinhaSlugFromText(body.cozinhaOutra)
    if (s == null) return badRequest()
    cozinhaOutraSlug = s
    patch.cozinha = s as Cozinha
  } else if (body.cozinha !== undefined) {
    // Cozinha DATA-DRIVEN (#318): conjunto ATIVO do DB DIRETO (ADR-0025 Decisão 4), carregado SÓ
    // dentro deste ramo (não paga ida ao banco em edição que não toca cozinha). Pós-virada #318
    // (coluna `text` + FK) NÃO há enum-bounding: toda cozinha ATIVA (inclusive 'americana') é
    // storável; só slug NÃO-ativo vira 400 dados_invalidos.
    const activeCozinhas = await loadActiveCozinhaSlugs(db)
    if (
      body.cozinha !== null &&
      (typeof body.cozinha !== 'string' || !isActiveCozinha(body.cozinha, activeCozinhas))
    ) {
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
  // Tempo de preparo (#261, ADR-0023): valida SÓ a faixa por campo (positividade + teto). A
  // consistência ativo ≤ total NÃO é rejeitada aqui — é reconciliada no editOwnRecipe sobre o
  // estado mesclado (conciliarTempoPreparo), política de salvamento uniforme com a geração.
  if (body.tempoAtivoMin !== undefined) {
    const v = optionalIntInRange(body.tempoAtivoMin, isTempoValido)
    if (v === undefined) return badRequest()
    patch.tempoAtivoMin = v
  }
  if (body.tempoTotalMin !== undefined) {
    const v = optionalIntInRange(body.tempoTotalMin, isTempoValido)
    if (v === undefined) return badRequest()
    patch.tempoTotalMin = v
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

  // "Outra" (#319): materializa o termo `suggested` SÓ depois que TODO o corpo validou (acima) —
  // dedup-na-entrada idempotente. Deferir até aqui impede um termo órfão quando um campo posterior
  // do PATCH devolve 400. A FK `recipe.cozinha` (gravada por editOwnRecipe a seguir) exige a linha.
  if (cozinhaOutraSlug != null) await suggestCozinha(db, body.cozinhaOutra as string, viewerId)

  const result = await editOwnRecipe(db, { recipeId: id, viewerId, locale, patch })
  if (result.kind === 'translation_not_found') {
    return Response.json({ error: 'translation_not_found' }, { status: 404 })
  }

  // was_public (história #277): a UI confirma "isto fica visível a quem salvou" SÓ na pública.
  // imageReviewSuggested (#131): a UI sugere revisar a foto após uma mudança visual numa Receita
  // com imagem (edição in-place mantém o mesmo image_id; só a sugestão importa).
  return Response.json(
    { ok: true, was_public: gate.visibility === 'public', imageReviewSuggested: result.imageReviewSuggested },
    { status: 200 },
  )
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

  // #146: injeta o ImageStore — o delete roda o ref-count da Imagem (apaga recipe_image+blob órfãos
  // quando some a última versão que os referenciava). store.owns gateia o delete do blob.
  const result = await deleteOwnRecipe(db, getImageStore(), { recipeId: id, viewerId })
  if (result === 'not_found') return notFound() // corrida pós-gate

  return new Response(null, { status: 204 })
}
