import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, users } from '@/db/schema'
import { requireSessionFromHeaders } from '@/server/auth/guard'
import { isUuid } from '@/server/http/params'
import { loadRecipeRows, loadSocialState } from '@/server/recipe/load'
import { loadImageGenConfig } from '@/server/app-config'
import { loadGallery } from '@/server/recipe/image'
import { resolveRecipeView, type RecipeView } from '@/domain/recipe-read'
import { isCommunityVisible } from '@/domain/recipe-visibility-check'

/**
 * Leitura localizada da Receita por UUID (issue #3) — loader de servidor COMPARTILHADO entre o
 * `GET /api/recipes/[id]` (route fino) e o caminho do DONO de `/{locale}/recipes/[id]` (o Server
 * Component chama direto, sem self-fetch HTTP — ADR-0010 segue: a UI não reimplementa domínio, só
 * reusa o MESMO loader da rota). Carrega espinha + traduções + ingredientes + tags via
 * `loadRecipeRows` e delega a montagem da view ao módulo PURO `resolveRecipeView`.
 *
 * Gating de leitura (ADR-0011): catálogo/sistema (owner_id NULL) e Receitas `public` são legíveis
 * por qualquer um. Receita com dono + `private` (cobre toda geração da #8 e as playful) só é legível
 * pelo próprio dono; sem sessão OU dono diferente ⇒ `null` (a borda responde 404 not_found — NÃO
 * 401/403, não vaza existência).
 *
 * #18 (moderação): uma Receita removida do pool pelo Curador (moderation_removed_at) sai da leitura
 * pública (anônimo/não-dono ⇒ null), SEM tocar `visibility` — o Owner CONTINUA dono da linha privada
 * (lê/gerencia a própria). Remover-do-pool ≠ despublicar; as duas dimensões são ortogonais.
 *
 * `null` = malformado/ausente/sem-acesso (indistinguíveis de propósito). A view é JSON-pura (sem
 * `Date`/`undefined`): o que a página recebe direto é o mesmo que o JSON da rota entregava.
 */
export async function loadRecipeDetailView(
  db: Database,
  input: { id: string; requestLocale: string; headers: Headers },
): Promise<RecipeView | null> {
  const { id, requestLocale, headers } = input
  if (!isUuid(id)) return null

  // Gating barato ANTES de carregar a view: lê só owner_id + visibility. Receita
  // ausente cai no mesmo not_found (malformado/ausente/sem-acesso indistinguíveis).
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      // #18: removida do pool pela moderação sai da leitura pública (não-dono → 404).
      moderationRemovedAt: recipe.moderationRemovedAt,
      // #238: rascunho de catálogo (pending/editing/rejected) NÃO é leitura pública — anônimo → 404.
      curationStatus: recipe.curationStatus,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return null

  // Pública/catálogo (owner_id NULL = sistema, ADR-0011) → legível por qualquer um.
  // Caso contrário (com dono + private) exige ser o próprio dono; senão 404 (não vaza
  // existência — mesma forma da rota de retomada em creation-sessions/[id]).
  //
  // #18: uma Receita removida do pool NÃO é leitura pública (isPublicRead=false) — anônimo/
  // não-dono cai no ramo privado → 404 (não vaza). O Owner da própria removida cai no ramo
  // privado, confirma ownership e lê a linha privada (200). Remover-do-pool NÃO toca
  // `visibility` (≠ despublicar, AC3).
  //
  // `viewerId` (#59) habilita os campos de gestão (`canManage`/`visibility`/`resultKind`)
  // quando o requester é o dono — NUNCA altera corpo/gate de leitura. Resolvido com
  // parcimônia: nunca lemos a sessão no tráfego anônimo quente (a Busca linka direto pra cá).
  const isPublicRead =
    isCommunityVisible(gate.ownerId, gate.visibility, gate.curationStatus) &&
    gate.moderationRemovedAt == null

  let viewerId: string | undefined
  let rows: Awaited<ReturnType<typeof loadRecipeRows>>
  if (!isPublicRead) {
    // Ramo privado: a sessão GATEIA se vale carregar — só pagamos `loadRecipeRows` depois
    // de confirmar que o requester é o dono (sequencial de propósito: não carregar sem acesso).
    const g = await requireSessionFromHeaders(headers)
    if (!g.ok || g.session.user.id !== gate.ownerId) return null
    viewerId = g.session.user.id
    rows = await loadRecipeRows(db, id)
  } else if (headers.get('cookie') != null) {
    // Ramo público COM cookie (com OU sem dono — #16): só vale descobrir o requester quando
    // há cookie (pula o anônimo puro — perf). Antes (#59) este ramo exigia `ownerId != null`,
    // o que NUNCA resolvia o viewerId no Catálogo (ownerId NULL); mas Catálogo É
    // votável/salvável (#16), então um logado que salvou no Catálogo precisa ver
    // `viewerSaved` no detalhe. Resolver a sessão sempre que houver cookie corrige isso.
    // Lê só `g.ok`/`g.session`; JAMAIS `g.response` (leitura pública permanece
    // anônima-friendly, nunca vira 401/404 aqui). A sessão NÃO gateia a carga ⇒ sobrepomos
    // a sessão e `loadRecipeRows` (colapsa o round-trip serial do logado quente).
    const [g, loaded] = await Promise.all([requireSessionFromHeaders(headers), loadRecipeRows(db, id)])
    if (g.ok) viewerId = g.session.user.id
    rows = loaded
  } else {
    // Ramo público anônimo (sem cookie) ou catálogo anônimo: nenhuma sessão a resolver.
    rows = await loadRecipeRows(db, id)
  }
  if (!rows) return null

  // Estado social (#16/#362): `viewerSaved` SÓ quando há viewerId. #134: a config de geração-por-IA
  // (enabled) SÓ quando o requester é o DONO (a ação é owner-only ⇒ o tráfego anônimo/não-dono
  // NÃO paga essa query — preserva o caminho quente). As duas leituras são independentes ⇒ paralelas.
  const isOwner = viewerId != null && rows.recipe.ownerId === viewerId
  const [social, imageGenEnabled, imageGenBlocked, gallery] = await Promise.all([
    loadSocialState(db, { id, viewerId }),
    isOwner ? loadImageGenConfig(db).then((c) => c.enabled) : Promise.resolve(undefined),
    // #226: a restrição GRANULAR de geração-por-IA do usuário (flag por-conta do Curador), owner-gated
    // como imageGenEnabled — a flag é por-USUÁRIO e a ação de gerar é owner-only ⇒ é o bloqueio do
    // próprio dono. O tráfego anônimo/não-dono NÃO paga essa query (afordância proativa de esconder).
    isOwner && viewerId != null
      ? db
          .select({ blockedAt: users.imageGenBlockedAt })
          .from(users)
          .where(eq(users.id, viewerId))
          .then((rows) => rows[0]?.blockedAt != null)
      : Promise.resolve(undefined),
    // #222: a GALERIA da linhagem SÓ quando o requester é o DONO (mirror de imageGenEnabled, NÃO
    // dentro de loadRecipeRows — que o caminho público-por-slug reusa). O tráfego anônimo/não-dono
    // NÃO paga essa query e a vista pública NUNCA carrega o campo `gallery` (owner-gated).
    isOwner && rows.recipe.lineageId != null
      ? loadGallery(db, rows.recipe.lineageId, rows.recipe.imageId ?? null)
      : Promise.resolve(undefined),
  ])

  return resolveRecipeView({
    ...rows,
    requestLocale,
    viewerId,
    viewerSaved: social.viewerSaved,
    imageGenEnabled,
    imageGenBlocked,
    gallery,
  })
}
