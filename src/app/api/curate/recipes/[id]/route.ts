import { eq } from 'drizzle-orm'
import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { isUuid } from '@/server/http/params'
import { canonicalLocale } from '@/i18n/locale'
import {
  isActiveCozinha,
  isCategoria,
  isRestricao,
  isPorcoesValidas,
  isDificuldadeValida,
  type Cozinha,
  type Categoria,
  type Restricao,
} from '@/domain/vocabulary'
import { loadActiveCozinhaSlugs } from '@/server/vocabulary/active-set'
import { editCatalogRecipe, type EditCatalogRecipeInput } from '@/server/curate/edit'

/**
 * PATCH /api/curate/recipes/[id] — edita/“organiza” Receita de CATÁLOGO (issue #19,
 * AC1 organizar + AC6 stale).
 *
 * Ordem de guards (espelha review/route.ts): isUuid→404, requireRole→401/403, gate de
 * escopo origin='catalog' (404 leak-safe — Curador não edita comunidade por aqui),
 * resolução de locale (body.locale presente ⇒ canonicalLocale; null ⇒ 404; ausente ⇒
 * originalLocale), validação de enums + FAIXAS numéricas (porcoes 1-50, dificuldade 1-5)
 * na borda (22P02→500 evitado; colunas integer puro SEM CHECK), depois o efeito.
 * `editCatalogRecipe` faz o GATE da linha de tradução e devolve discriminator p/ 404.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

type EditCatalogBody = {
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
  tags?: unknown
}

function badRequest(): Response {
  return Response.json({ error: 'dados_invalidos' }, { status: 400 })
}
function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}

/**
 * integer-em-faixa: null ⇒ null (limpa o campo); integer dentro da faixa canônica
 * (validador puro `isFaixa`) ⇒ valor; NÃO-inteiro OU fora da faixa ⇒ undefined (sinaliza
 * inválido). Contrato simétrico ao create: as colunas são integer puro SEM CHECK, então a
 * faixa (PORCOES 1-50, DIFICULDADE 1-5) é validada aqui na borda como em todo outro
 * caminho de escrita. (O caso `undefined` — chave ausente — é tratado antes, pela presença
 * da chave no body.)
 */
function optionalIntInRange(v: unknown, isFaixa: (n: number) => boolean): number | null | undefined {
  if (v === null) return null
  if (typeof v === 'number' && Number.isInteger(v) && isFaixa(v)) return v
  return undefined
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return notFound()

  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const db = getDb()

  // Gate de escopo: existe E origin='catalog' (404 leak-safe). Lê originalLocale p/ o
  // fallback de locale numa só ida.
  const [gate] = await db
    .select({ origin: recipe.origin, originalLocale: recipe.originalLocale })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate || gate.origin !== 'catalog') return notFound()

  const body = (await req.json().catch(() => ({}))) as EditCatalogBody

  // Eixo traduzível: resolver o locale. body.locale presente ⇒ canonicalLocale (null ⇒
  // 404, rejeita cru/não-suportado); ausente ⇒ originalLocale (caso comum do Curador).
  let locale: string
  if (body.locale !== undefined) {
    if (typeof body.locale !== 'string') return notFound()
    const canon = canonicalLocale(body.locale)
    if (canon === null) return notFound()
    locale = canon
  } else {
    locale = gate.originalLocale
  }

  // Monta o patch validando enums na borda. `presença` (chave no body) = mudou.
  const patch: Omit<EditCatalogRecipeInput, 'recipeId' | 'locale'> = {}

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
    // Cozinha DATA-DRIVEN (#318): conjunto ATIVO do DB DIRETO (ADR-0025 Decisão 4), carregado SÓ
    // neste ramo. Pós-virada #318 (coluna `text` + FK) NÃO há enum-bounding: toda cozinha ATIVA
    // (inclusive 'americana') é storável; só slug NÃO-ativo vira 400 dados_invalidos.
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
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string')) {
      return badRequest()
    }
    patch.tags = body.tags as string[]
  }

  const result = await editCatalogRecipe(db, { recipeId: id, locale, ...patch })
  if (result === 'translation_not_found') return notFound()

  return Response.json({ ok: true }, { status: 200 })
}
