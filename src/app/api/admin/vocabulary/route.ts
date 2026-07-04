import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import {
  addCozinha,
  editCozinhaLabels,
  listCozinhasForAdmin,
  setCozinhaStatus,
} from '@/server/vocabulary/admin'

/**
 * CRUD da taxonomia de cozinhas — ADMIN-ONLY (#321, ADR-0025: curadoria proativa). GET lista;
 * POST adiciona; PATCH edita rótulos e/ou vira o status (depreciar/reativar). Curador é BARRADO
 * (403): autoria proativa é só do Admin — o poder do Curador é a fila de sugestões #319/#320.
 *
 * Corpo de erro sempre `{ error:'<chave>' }` (a UI mapeia pela CHAVE, não pelo status — convenção
 * do repo). DB embrulhado em try/catch → `erro_interno` 500 sem stack (igual /api/admin/config).
 *
 * A rota NÃO busta o cache de 30s de `loadVocabulary` (mesmo trade-off do /api/admin/config): um
 * add/depreciar reflete nas facetas/rótulos após ≤30s — aceitável por #315.
 */

export async function GET(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response
  try {
    return Response.json({ cozinhas: await listCozinhasForAdmin(getDb()) })
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }
}

export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as {
    slug?: unknown
    labelPtBr?: unknown
    labelEnUs?: unknown
  }
  if (typeof body.slug !== 'string') {
    return Response.json({ error: 'slug_invalido' }, { status: 400 })
  }
  if (typeof body.labelPtBr !== 'string' || typeof body.labelEnUs !== 'string') {
    return Response.json({ error: 'rotulos_invalidos' }, { status: 400 })
  }

  let result
  try {
    result = await addCozinha(getDb(), {
      slug: body.slug,
      labelPtBr: body.labelPtBr,
      labelEnUs: body.labelEnUs,
    })
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }

  if (!result.ok) {
    const status = result.error === 'slug_em_uso' ? 409 : 400
    return Response.json({ error: result.error }, { status })
  }
  // Relê a linha recém-criada (espelha o GET item) — a UI insere o que a rota devolve.
  return Response.json({ cozinha: await readOne(result.slug) })
}

export async function PATCH(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as {
    slug?: unknown
    labelPtBr?: unknown
    labelEnUs?: unknown
    // #422: nota de voz curada — OPCIONAL (string | null). '' vira null no domínio (limpar a nota).
    voiceNote?: unknown
    status?: unknown
  }
  if (typeof body.slug !== 'string' || body.slug.length === 0) {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  const hasLabels = body.labelPtBr !== undefined || body.labelEnUs !== undefined
  // #422: patch SÓ-de-nota é válido (a nota não é obrigatória). voiceNote deve ser string OU null.
  const hasVoiceNote = body.voiceNote !== undefined
  const hasStatus = body.status !== undefined
  if (!hasLabels && !hasVoiceNote && !hasStatus) {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }
  if (hasVoiceNote && body.voiceNote !== null && typeof body.voiceNote !== 'string') {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }
  if (hasStatus && body.status !== 'active' && body.status !== 'deprecated') {
    return Response.json({ error: 'status_invalido' }, { status: 400 })
  }

  try {
    if (hasLabels || hasVoiceNote) {
      const r = await editCozinhaLabels(getDb(), body.slug, {
        labelPtBr: body.labelPtBr as string | undefined,
        labelEnUs: body.labelEnUs as string | undefined,
        voiceNote: hasVoiceNote ? (body.voiceNote as string | null) : undefined,
      })
      // Mapeia pela CHAVE: rótulo vazio é validação (400), não inexistência da linha (404).
      if (!r.ok) {
        const status = r.error === 'rotulos_invalidos' ? 400 : 404
        return Response.json({ error: r.error }, { status })
      }
    }
    if (hasStatus) {
      const r = await setCozinhaStatus(getDb(), body.slug, body.status as 'active' | 'deprecated')
      if (!r.ok) return Response.json({ error: r.error }, { status: 404 })
    }
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }

  return Response.json({ cozinha: await readOne(body.slug) })
}

/** Relê uma cozinha pós-escrita (DB-direto, espelha o item do GET). */
async function readOne(slug: string) {
  const all = await listCozinhasForAdmin(getDb())
  return all.find((c) => c.slug === slug) ?? null
}
