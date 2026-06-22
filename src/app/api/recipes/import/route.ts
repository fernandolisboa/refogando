import { requireSession } from '@/server/auth/guard'
import { getDb, getRecipeImporter } from '@/server/deps'
import { embedTranslation } from '@/server/embedding/recompute'
import { persistImport } from '@/server/import/persist-import'

/**
 * Importar uma receita de um link da web (#165, ADR-0019) — cópia PRIVADA do Usuário.
 *
 * Fluxo: requireSession (401 Visitante) → valida `url` (http(s) bem-formada) ANTES do seam → chama
 * o seam `getRecipeImporter` (fetch + parse JSON-LD schema.org/Recipe) → na falha tratada, 422 (não
 * importa) → no sucesso, persiste origin=web_imported, owner=usuário, visibility=private, atribuição
 * (source_url/source_name) e embeda best-effort (como a Geração) → 201.
 *
 * O guard "nunca pública" (recusar o toggle de publicação numa importada) é a #168; aqui a receita
 * já nasce `private`, então está segura até lá.
 *
 * Respostas:
 *  - 201 { recipeId, visibility: 'private' }  — criada.
 *  - 400 { error: 'url_invalida' }            — body sem `url` http(s) bem-formada.
 *  - 401 { error: 'nao_autenticado' }         — Visitante.
 *  - 422 { error: <reason> }                  — sem JSON-LD confiável / idioma fora de PT/EN /
 *                                               fetch falho (não importa; nunca 500).
 */

export const runtime = 'nodejs' // fetch externo + postgres-js exigem Node, não Edge.

/** Só http(s) bem-formada é importável (defesa antes do seam: nada de file:/ftp:/javascript:). */
function parseHttpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export async function POST(req: Request): Promise<Response> {
  // Sessão ANTES de tudo: anônimo ⇒ 401, zero efeito colateral (nem rede, nem DB).
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const ownerId = g.session.user.id

  const body = (await req.json().catch(() => ({}))) as { url?: unknown }
  const url = parseHttpUrl(body.url)
  if (!url) return Response.json({ error: 'url_invalida' }, { status: 400 })

  // Seam mockável: fetch + parse. Falhas são TRATADAS (nunca lança) — mapeadas a 422.
  const result = await getRecipeImporter().import(url)
  if (!result.ok) {
    // reason ∈ { no_jsonld, unsupported_locale, fetch_failed } — chave i18n p/ a UI (#168).
    return Response.json({ error: result.reason }, { status: 422 })
  }

  const p = await persistImport({ recipe: result.recipe, ownerId, sourceUrl: url })

  // Embeda a Receita recém-importada (best-effort, ASSISTIVO) p/ a Busca semântica achá-la pelo
  // SIGNIFICADO. Falha (sem key / 429 / rede) NÃO derruba a importação — a Receita já está
  // persistida; a Busca apenas degrada pra FTS+trigram. Espelha /api/generations.
  await embedTranslation(getDb(), p.recipeId, result.recipe.originalLocale).catch(() => {})

  return Response.json({ recipeId: p.recipeId, visibility: p.visibility }, { status: 201 })
}
