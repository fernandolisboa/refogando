import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { isRestricao, isUnidade, type Restricao, type Unidade } from '@/domain/vocabulary'
import { deriveRecipe, type DeriveEdits } from '@/server/recipe/derive'
import { isCommunityVisible } from '@/domain/recipe-visibility-check'

/**
 * POST /api/recipes/[id]/derive — DERIVA (forka) uma Receita NÃO-própria (issue #17).
 *
 * Editar uma receita que o leitor NÃO possui (catálogo OU pública de outro) NUNCA muta a base:
 * cria uma NOVA Receita `user_edited` do leitor, com diff CONGELADO e snapshot completo. Editar
 * a PRÓPRIA receita é o caminho IN-PLACE da #21 — aqui é PROIBIDO (409 conflito).
 *
 * Ordem dos guards é LOAD-BEARING (espelha visibility.ts/o GET da #3):
 *   1. isUuid → 404 (sem tocar o DB; malformado indistinguível de ausente).
 *   2. requireSession → 401 (ANTES do DB; Visitante = zero efeito colateral).
 *   3. SELECT barato (owner_id, visibility) da base.
 *      - base ausente → 404 (não vaza existência).
 *      - ownerId === viewer → 409 (derivar-da-própria é proibido; o in-place é #21).
 *      - ownerId !== null E visibility !== 'public' → 404 (privada de OUTRO; leak-safe).
 *      - senão (catálogo ownerId NULL, OU pública de outro) → PROSSEGUE.
 *   4. parse + valida body.edits → 400 dados_invalidos em forma ruim.
 *   5. deriveRecipe → 201 { recipeId }.
 *
 * 404-not-403 em ownership (nunca vaza existência). Vocabulário de erro alinhado às outras
 * rotas: `nao_autenticado` (401), `not_found` (404), `dados_invalidos` (400). O 409 usa a chave
 * `derivar_da_propria` (i18n na UI #21/#61).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

type RawIngrediente = { rawText?: unknown; quantidade?: unknown; unidade?: unknown }

type DeriveBody = {
  edits?: {
    titulo?: unknown
    descricao?: unknown
    passos?: unknown
    notas?: unknown
    ingredientes?: unknown
    restricoes?: unknown
  }
}

function badRequest(): Response {
  return Response.json({ error: 'dados_invalidos' }, { status: 400 })
}

/** string opcional: ausente/null ⇒ null; vazia ⇒ null; tipo errado ⇒ undefined (inválido). */
function optionalString(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return undefined
  return v.length > 0 ? v : null
}

/**
 * Valida + normaliza `body.edits` para `DeriveEdits` (mesmo rigor de borda do curate route:
 * bindar string crua numa coluna enum dispararia 22P02→500). Devolve `null` em forma ruim
 * (o route mapeia para 400). `titulo` é obrigatório não-vazio (a derivada precisa de nome).
 */
function parseEdits(edits: DeriveBody['edits']): DeriveEdits | null {
  if (typeof edits !== 'object' || edits === null) return null

  // titulo: obrigatório, não-vazio.
  if (typeof edits.titulo !== 'string' || edits.titulo.length === 0) return null

  const descricao = optionalString(edits.descricao)
  if (descricao === undefined) return null
  const notas = optionalString(edits.notas)
  if (notas === undefined) return null

  // passos: array de string|null.
  let passos: string[] | null = null
  if (edits.passos !== undefined && edits.passos !== null) {
    if (!Array.isArray(edits.passos) || edits.passos.some((p) => typeof p !== 'string')) return null
    passos = edits.passos as string[]
  }

  // restricoes: array de enum (default []).
  const restricoes: Restricao[] = []
  if (edits.restricoes !== undefined && edits.restricoes !== null) {
    if (!Array.isArray(edits.restricoes)) return null
    for (const r of edits.restricoes) {
      if (typeof r !== 'string' || !isRestricao(r)) return null
      restricoes.push(r)
    }
  }

  // ingredientes: array de itens (default []). quantidade string|null; unidade enum|null.
  const ingredientes: DeriveEdits['ingredientes'][number][] = []
  if (edits.ingredientes !== undefined && edits.ingredientes !== null) {
    if (!Array.isArray(edits.ingredientes)) return null
    for (const raw of edits.ingredientes as RawIngrediente[]) {
      if (typeof raw !== 'object' || raw === null) return null
      let unidade: Unidade | null = null
      if (raw.unidade !== undefined && raw.unidade !== null) {
        if (typeof raw.unidade !== 'string' || !isUnidade(raw.unidade)) return null
        unidade = raw.unidade
      }
      let quantidade: string | null = null
      if (raw.quantidade !== undefined && raw.quantidade !== null) {
        if (typeof raw.quantidade !== 'string') return null
        quantidade = raw.quantidade
      }
      const rawText = optionalString(raw.rawText)
      if (rawText === undefined) return null
      ingredientes.push({ rawText, quantidade, unidade })
    }
  }

  return { titulo: edits.titulo, descricao, passos, notas, ingredientes, restricoes }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  // Sessão ANTES do DB: Visitante ⇒ 401, zero efeito colateral.
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const viewerId = g.session.user.id

  const db = getDb()

  // Gate barato: lê só owner_id + visibility da base.
  const [gate] = await db
    .select({ ownerId: recipe.ownerId, visibility: recipe.visibility })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return Response.json({ error: 'not_found' }, { status: 404 })

  // Derivar-da-PRÓPRIA é proibido (o in-place é #21) ⇒ 409. (Antes do gate de visibilidade:
  // o dono pode ter a própria PRIVADA, e ainda assim é 409, não 404.)
  if (gate.ownerId === viewerId) {
    return Response.json({ error: 'derivar_da_propria' }, { status: 409 })
  }

  // Privada de OUTRO (com dono e não-pública) ⇒ 404 leak-safe. Catálogo (ownerId NULL) e
  // pública de outro PASSAM. Espelha o gate de leitura do GET (não vaza existência).
  if (!isCommunityVisible(gate.ownerId, gate.visibility)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  // Valida o corpo SÓ depois de autorizar (não revela forma do contrato a quem não pode derivar).
  const body = (await request.json().catch(() => ({}))) as DeriveBody
  const edits = parseEdits(body.edits)
  if (edits === null) return badRequest()

  const locale = parseRequestLocale(request)
  const res = await deriveRecipe({ db, baseId: id, viewerId, edits, locale })

  switch (res.kind) {
    case 'ok':
      // imageReviewSuggested (#131): a derivada herdou a imagem da base E uma mudança visual sugere
      // revisar a foto — a UI navega pra derivada com a dica.
      return Response.json(
        { recipeId: res.recipeId, imageReviewSuggested: res.imageReviewSuggested },
        { status: 201 },
      )
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
