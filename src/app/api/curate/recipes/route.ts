import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { canonicalLocale } from '@/i18n/locale'
import {
  isActiveCozinha,
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
import { loadActiveCozinhaSlugs } from '@/server/vocabulary/active-set'
import { createCatalogRecipe, type CreateCatalogRecipeInput } from '@/server/curate/create'

/**
 * POST /api/curate/recipes — cria Receita de CATÁLOGO editorial (issue #19, AC1).
 *
 * Rota fina: gating por papel (Curador) e validação de BORDA dos enums (bindar string
 * crua numa coluna enum dispararia 22P02→500; rejeitamos na borda com 400 dados_invalidos)
 * + das FAIXAS numéricas canônicas (porcoes 1-50, dificuldade 1-5 — colunas integer puro
 * SEM CHECK, mesma faixa que todo outro caminho de escrita aplica), antes de delegar a
 * `createCatalogRecipe`. `quantidade` é string|null (numeric trafega como string, NUNCA
 * number).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

type RawIngrediente = {
  rawText?: unknown
  quantidade?: unknown
  unidade?: unknown
}

type CreateCatalogBody = {
  originalLocale?: unknown
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

/**
 * string opcional: ausente/null/vazia ⇒ null; string não-vazia ⇒ valor; tipo errado ⇒
 * undefined (sinaliza inválido — simetria com o PATCH, que rejeita tipo errado com 400).
 */
function optionalString(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return undefined
  return v.length > 0 ? v : null
}

/**
 * integer-em-faixa: ausente/null ⇒ null; integer dentro da faixa canônica (validador puro
 * `isFaixa`) ⇒ valor; NÃO-inteiro OU fora da faixa ⇒ undefined (sinaliza inválido). As
 * colunas são integer puro SEM CHECK — a faixa (PORCOES 1-50, DIFICULDADE 1-5) é a MESMA
 * que todo outro caminho de escrita aplica (generations/briefing/facet-params).
 */
function optionalIntInRange(v: unknown, isFaixa: (n: number) => boolean): number | null | undefined {
  if (v === undefined || v === null) return null
  if (typeof v === 'number' && Number.isInteger(v) && isFaixa(v)) return v
  return undefined
}

export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as CreateCatalogBody

  // titulo: obrigatório, não-vazio.
  if (typeof body.titulo !== 'string' || body.titulo.length === 0) return badRequest()

  // originalLocale: obrigatório e canonicalizável.
  if (typeof body.originalLocale !== 'string') return badRequest()
  const originalLocale = canonicalLocale(body.originalLocale)
  if (originalLocale === null) return badRequest()

  // Enums escalares: presentes ⇒ válidos; ausentes/null ⇒ null.
  let cozinha: Cozinha | null = null
  if (body.cozinha !== undefined && body.cozinha !== null) {
    // Cozinha DATA-DRIVEN (#318): conjunto ATIVO do DB DIRETO (ADR-0025 Decisão 4), carregado SÓ
    // neste ramo. Pós-virada #318 (coluna `text` + FK) NÃO há enum-bounding: toda cozinha ATIVA
    // (inclusive 'americana') é storável; só slug NÃO-ativo vira 400 dados_invalidos.
    const activeCozinhas = await loadActiveCozinhaSlugs(getDb())
    if (typeof body.cozinha !== 'string' || !isActiveCozinha(body.cozinha, activeCozinhas)) {
      return badRequest()
    }
    cozinha = body.cozinha as Cozinha
  }
  let categoria: Categoria | null = null
  if (body.categoria !== undefined && body.categoria !== null) {
    if (typeof body.categoria !== 'string' || !isCategoria(body.categoria)) return badRequest()
    categoria = body.categoria
  }

  // restricoes: array de enum (default []).
  const restricoes: Restricao[] = []
  if (body.restricoes !== undefined && body.restricoes !== null) {
    if (!Array.isArray(body.restricoes)) return badRequest()
    for (const r of body.restricoes) {
      if (typeof r !== 'string' || !isRestricao(r)) return badRequest()
      restricoes.push(r)
    }
  }

  // porcoes/dificuldade: integer|null dentro da faixa canônica (1-50 / 1-5).
  const porcoes = optionalIntInRange(body.porcoes, isPorcoesValidas)
  if (porcoes === undefined) return badRequest()
  const dificuldade = optionalIntInRange(body.dificuldade, isDificuldadeValida)
  if (dificuldade === undefined) return badRequest()

  // descricao/notas: string opcional; tipo errado ⇒ 400 (simetria com o PATCH).
  const descricao = optionalString(body.descricao)
  if (descricao === undefined) return badRequest()
  const notas = optionalString(body.notas)
  if (notas === undefined) return badRequest()

  // passos: array de string|null.
  let passos: string[] | null = null
  if (body.passos !== undefined && body.passos !== null) {
    if (!Array.isArray(body.passos) || body.passos.some((p) => typeof p !== 'string')) {
      return badRequest()
    }
    passos = body.passos as string[]
  }

  // ingredientes: array de itens (default []).
  const ingredientes: CreateCatalogRecipeInput['ingredientes'] = []
  if (body.ingredientes !== undefined && body.ingredientes !== null) {
    if (!Array.isArray(body.ingredientes)) return badRequest()
    for (const raw of body.ingredientes as RawIngrediente[]) {
      if (typeof raw !== 'object' || raw === null) return badRequest()
      let unidade: Unidade | null = null
      if (raw.unidade !== undefined && raw.unidade !== null) {
        if (typeof raw.unidade !== 'string' || !isUnidade(raw.unidade)) return badRequest()
        unidade = raw.unidade
      }
      // quantidade: string|null (numeric trafega como string).
      let quantidade: string | null = null
      if (raw.quantidade !== undefined && raw.quantidade !== null) {
        if (typeof raw.quantidade !== 'string') return badRequest()
        quantidade = raw.quantidade
      }
      const rawText = optionalString(raw.rawText)
      if (rawText === undefined) return badRequest()
      ingredientes.push({ rawText, quantidade, unidade })
    }
  }

  const result = await createCatalogRecipe(getDb(), {
    originalLocale,
    // Editorial hand-made (#19): UMA tradução, escrita por uma pessoa. #238: nasce 'approved'
    // (a pessoa escreveu = curou), assinada pelo Curador da sessão (reviewedBy).
    translations: [
      {
        locale: originalLocale,
        titulo: body.titulo,
        descricao,
        passos,
        notas,
        provenance: 'escrita_por_pessoa',
      },
    ],
    cozinha,
    categoria,
    restricoes,
    porcoes,
    dificuldade,
    tempoAtivoMin: null,
    tempoTotalMin: null,
    ingredientes,
    curationStatus: 'approved',
    reviewedBy: g.session.user.id,
  })

  return Response.json({ id: result.recipeId }, { status: 200 })
}
