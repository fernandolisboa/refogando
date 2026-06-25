import { requireSession } from '@/server/auth/guard'
import { getDb, getRecipeImporter } from '@/server/deps'
import { embedTranslation } from '@/server/embedding/recompute'
import { persistImport } from '@/server/import/persist-import'
import type { ImportFailureReason } from '@/server/import/recipe-importer'
import { loadWebSearchConfig } from '@/server/app-config'
import { isUrlAllowed } from '@/domain/web-search-config'

/**
 * Importar uma receita de um link da web (#165, ADR-0019) — cópia PRIVADA do Usuário.
 *
 * Fluxo: requireSession (401 Visitante) → valida `url` (http(s) bem-formada) ANTES do seam → GUARD de
 * SSRF/allowlist (#164: o host TEM de estar na allowlist curada do admin — a MESMA fonte de verdade da
 * descoberta na web) → chama o seam `getRecipeImporter` (fetch + parse JSON-LD schema.org/Recipe) → na
 * falha tratada, 422 (não importa) → no sucesso, persiste origin=web_imported, owner=usuário,
 * visibility=private, atribuição (source_url/source_name) e embeda best-effort (como a Geração) → 201.
 *
 * O guard de allowlist fecha o flanco de SSRF: SEM ele, a rota aceitaria URL arbitrária e o seam Real
 * faria `fetch` em qualquer host (incluindo IPs/serviços internos). Como #164 introduz a allowlist,
 * o import passa a SÓ buscar domínios que o admin curou (mesma allowlist do `/api/discovery/web`).
 *
 * O guard "nunca pública" (recusar o toggle de publicação numa importada) é a #168; aqui a receita
 * já nasce `private`, então está segura até lá.
 *
 * Respostas:
 *  - 201 { recipeId, visibility: 'private' }  — criada.
 *  - 400 { error: 'url_invalida' }            — body sem `url` http(s) bem-formada.
 *  - 401 { error: 'nao_autenticado' }         — Visitante.
 *  - 403 { error: 'dominio_nao_permitido' }   — host fora da allowlist curada (SSRF guard, #164).
 *  - 403 { error: 'robots_blocked' }          — o robots.txt do site PROÍBE buscar a receita (#272).
 *  - 422 { error: <reason> }                  — sem JSON-LD confiável / idioma fora de PT/EN /
 *                                               fetch falho (não importa; nunca 500).
 */

export const runtime = 'nodejs' // fetch externo + postgres-js exigem Node, não Edge.

/**
 * Status HTTP de uma falha TRATADA do seam. `robots_blocked` é POLÍTICA do site externo (403, espelha o
 * 403 do SSRF guard); as demais são "o site não nos dá dados importáveis" → 422. O `default` preserva
 * `no_jsonld`/`unsupported_locale`/`fetch_failed` em 422 e acomoda futuras reasons (ex.: rate_limited).
 */
function statusForReason(reason: ImportFailureReason): number {
  switch (reason) {
    case 'robots_blocked':
      return 403
    default:
      return 422
  }
}

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

  // GUARD de SSRF/allowlist (#164, ADR-0019): o host TEM de estar na allowlist curada do admin (mesma
  // fonte de verdade da descoberta na web) ANTES de qualquer `fetch`. Allowlist vazia ⇒ recusa tudo
  // (fail-closed). Recusa host fora da curadoria com 403, ZERO efeito (nem rede, nem DB) — fecha o
  // flanco de SSRF (sem isto, o seam Real faria fetch em IP/serviço interno arbitrário).
  const cfg = await loadWebSearchConfig(getDb())
  if (!isUrlAllowed(url, cfg.allowlist)) {
    return Response.json({ error: 'dominio_nao_permitido' }, { status: 403 })
  }

  // Seam mockável: fetch + parse. Falhas são TRATADAS (nunca lança). O `reason` é a chave i18n p/ a UI
  // (#168); o status varia por reason (#272: robots_blocked → 403; demais → 422).
  const result = await getRecipeImporter().import(url)
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: statusForReason(result.reason) })
  }

  const p = await persistImport({ recipe: result.recipe, ownerId, sourceUrl: url })

  // Embeda a Receita recém-importada (best-effort, ASSISTIVO) p/ a Busca semântica achá-la pelo
  // SIGNIFICADO. Falha (sem key / 429 / rede) NÃO derruba a importação — a Receita já está
  // persistida; a Busca apenas degrada pra FTS+trigram. Espelha /api/generations.
  await embedTranslation(getDb(), p.recipeId, result.recipe.originalLocale).catch(() => {})

  return Response.json({ recipeId: p.recipeId, visibility: p.visibility }, { status: 201 })
}
