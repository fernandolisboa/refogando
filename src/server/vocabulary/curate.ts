import { and, asc, count, desc, eq, isNotNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { briefing, recipe, vocabularyTerm } from '@/db/schema'
import { slugify } from '@/domain/handle'
import { emitNotification } from '@/server/notification'

/**
 * Fila do CURADOR para a dimensão `cozinha` (issue #320, ADR-0025 Decisão 5 — curadoria REATIVA).
 * O fluxo "Outra" (#319) materializa um termo `suggested`; aqui o Curador o resolve: APROVA (vira
 * faceta `active`, opcionalmente corrigindo o slug canônico), MESCLA numa cozinha ativa existente,
 * ou REJEITA. DML de runtime PURA: `vocabulary_term` + as FKs `recipe.cozinha`/`briefing.cozinha`
 * já existem (pós-#318/0033/0034), NÃO há migração.
 *
 * Estilo em UNIÃO DISCRIMINADA (`{ ok:true } | { ok:false, error }`), sem exceção de control-flow —
 * espelha `admin.ts`/`moderation.ts`. As rotas (`/api/curate/cozinhas/*`) mapeiam cada `error` para
 * um status; a UI discrimina pela CHAVE, nunca pelo número.
 *
 * TOMBSTONE, NUNCA delete físico: aprovar-com-correção-de-slug, mesclar e rejeitar deixam o termo
 * ORIGINAL como lápide (`merged`/`rejected`). Isso (a) preserva a validade da FK de `briefing.cozinha`
 * (proveniência imutável, ADR-0006), (b) serve auditoria, e (c) curto-circuita re-sugestão: uma futura
 * "Outra" que dobre para um slug lápide reusa o termo via `suggestCozinha` (#319 casa TODOS os status)
 * — contenção, não bug.
 *
 * RECONCILIAÇÃO DA IMUTABILIDADE DO BRIEFING (ADR-0006 × ADR-0025 Decisão 2): `briefing.cozinha` é
 * proveniência imutável e NÃO é reescrita em MESCLAR nem REJEITAR. A ÚNICA exceção é
 * APROVAR-COM-CORREÇÃO-DE-SLUG: lá o `briefing.cozinha` É repontado old→new como CORREÇÃO DE SLUG
 * CANÔNICO — o auto-slug do "Outra" era PROVISÓRIO, não definitivo até a aprovação (ADR-0025 Decisão 2),
 * então repontá-lo não muda o CONTEÚDO da proveniência, só fixa a chave canônica que ele sempre quis
 * dizer. Não é reescrita de conteúdo.
 *
 * FRONTEIRA REATIVA × PROATIVA (#320 × #321): cada ação exige o status ATUAL === 'suggested'
 * (anti-corrida `ja_resolvido`). Uma linha `active`/`deprecated` (ciclo do Admin #321) ou já lápide
 * (`merged`/`rejected`) não é resolúvel por aqui — o Curador não revive tombstone nem mexe no ciclo
 * ativo por esta porta.
 */

/** Uma cozinha sugerida como o Curador a vê na fila: slug cru + nº de receitas anexadas. */
export type SuggestedCozinhaRow = {
  slug: string
  recipeCount: number
}

export type ApproveCozinhaResult =
  | { ok: true; slug: string }
  | {
      ok: false
      error: 'nao_encontrado' | 'ja_resolvido' | 'rotulos_invalidos' | 'slug_invalido' | 'slug_em_uso'
    }

export type MergeCozinhaResult =
  | { ok: true }
  | { ok: false; error: 'nao_encontrado' | 'ja_resolvido' | 'alvo_invalido' }

export type RejectCozinhaResult =
  | { ok: true }
  | { ok: false; error: 'nao_encontrado' | 'ja_resolvido' }

/**
 * Lista as cozinhas `suggested` para a fila do Curador — DB-DIRETO (não o cache `loadVocabulary`,
 * que só enxerga active/deprecated): o Curador precisa do estado FRESCO e do slug CRU sugerido.
 *
 * `recipeCount` usa `count(recipe.id)` (NÃO `count(*)`): com o LEFT JOIN, `count(*)` reportaria
 * 1 para um termo sugerido SEM receita anexada (a linha-fantasma do outer join). `count(recipe.id)`
 * conta 0 quando não há receita. WHERE `recipe.cozinha = slug` (sem filtro de dono) ⇒ a contagem
 * abrange TODOS os donos (um `suggested` é multi-owner, #319).
 */
export async function listSuggestedCozinhas(db: Database): Promise<SuggestedCozinhaRow[]> {
  const rows = await db
    .select({
      slug: vocabularyTerm.slug,
      recipeCount: count(recipe.id),
    })
    .from(vocabularyTerm)
    .leftJoin(recipe, eq(recipe.cozinha, vocabularyTerm.slug))
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.status, 'suggested')))
    .groupBy(vocabularyTerm.slug)
    .orderBy(asc(vocabularyTerm.slug))
  return rows
}

/**
 * Sugeridores a notificar (#373, ADR-0028): donos DISTINTOS de receita anexada a `slug`. Roda DENTRO
 * da transação e ANTES de qualquer `.set({cozinha})` (que reescreve/nula o ponteiro) — captura a
 * fotografia da lista de destinatários. Pula `owner_id NULL` (catálogo — sem destinatário).
 */
async function distinctSuggesterOwnerIds(tx: Database, slug: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ ownerId: recipe.ownerId })
    .from(recipe)
    .where(and(eq(recipe.cozinha, slug), isNotNull(recipe.ownerId)))
  return rows.map((r) => r.ownerId).filter((id): id is string => id != null)
}

/** `sort` do próximo termo de cozinha = maior sort + 1 (anexa ao fim, igual a `admin.addCozinha`). */
async function nextCozinhaSort(tx: Database): Promise<number> {
  const [maxRow] = await tx
    .select({ sort: vocabularyTerm.sort })
    .from(vocabularyTerm)
    .where(eq(vocabularyTerm.kind, 'cozinha'))
    .orderBy(desc(vocabularyTerm.sort))
    .limit(1)
  return (maxRow?.sort ?? -1) + 1
}

/**
 * APROVA uma cozinha sugerida → faceta `active`. Exige AMBOS os rótulos (pt-BR + en-US) trimados
 * não-vazios (senão `rotulos_invalidos`). O Curador PODE corrigir o slug canônico via `newSlug`:
 *
 *  - `newSlug` omitido OU === `slug`: aprova EM PLACE — UPDATE status='active', rótulos, sort=max+1
 *    (paridade com `addCozinha`). `recipe.cozinha`/`briefing.cozinha` ficam INALTERADOS.
 *  - `newSlug` diferente: valida `slugify(newSlug)===newSlug` e não-vazio (senão `slug_invalido`);
 *    INSERE um termo `active` NOVO com `onConflictDoNothing` na UNIQUE(slug) — returning vazio ⇒
 *    `slug_em_uso` (colisão com QUALQUER status, incl. lápide; nunca deixa um 23505 virar 500).
 *    Depois REPONTA `recipe.cozinha` E `briefing.cozinha` de TODAS as linhas anexadas old→new e
 *    TOMBA o termo antigo (`merged`). ORDEM FK-SEGURA (a FK é ON DELETE RESTRICT / ON UPDATE NO
 *    ACTION): INSERE o pai novo PRIMEIRO, reaponta os filhos, e SÓ ENTÃO tomba o antigo (agora sem
 *    referências) — um UPDATE do slug em-place violaria a FK. O briefing é repontado aqui como
 *    CORREÇÃO DE SLUG CANÔNICO (ver docstring do módulo), não reescrita de proveniência.
 */
export async function approveCozinha(
  db: Database,
  input: { slug: string; labelPtBr: string; labelEnUs: string; newSlug?: string },
): Promise<ApproveCozinhaResult> {
  const labelPtBr = typeof input.labelPtBr === 'string' ? input.labelPtBr.trim() : ''
  const labelEnUs = typeof input.labelEnUs === 'string' ? input.labelEnUs.trim() : ''
  if (labelPtBr.length === 0 || labelEnUs.length === 0) {
    return { ok: false, error: 'rotulos_invalidos' }
  }

  const { result, notifyOwnerIds } = await db.transaction(async (tx) => {
    // FOR UPDATE na tabela ÚNICA `vocabulary_term` (NUNCA cruzando o LEFT JOIN de recipe — FOR UPDATE
    // no lado nulável de outer join estoura no Postgres; ver moderation.ts).
    const [row] = await tx
      .select({ status: vocabularyTerm.status })
      .from(vocabularyTerm)
      .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, input.slug)))
      .for('update')
    if (!row) return { result: { ok: false as const, error: 'nao_encontrado' as const }, notifyOwnerIds: [] }
    if (row.status !== 'suggested')
      return { result: { ok: false as const, error: 'ja_resolvido' as const }, notifyOwnerIds: [] }

    // Sugeridores DISTINTOS ANTES de qualquer reescrita de `recipe.cozinha` (correção de slug) — captura
    // a fotografia p/ o fan-out; a notificação sai SÓ após o commit (best-effort, com o `db` de topo).
    const notifyOwnerIds = await distinctSuggesterOwnerIds(tx, input.slug)

    const nextSort = await nextCozinhaSort(tx)

    // Aprovação EM PLACE (sem correção de slug): o próprio termo vira active. Ponteiros intactos.
    if (input.newSlug === undefined || input.newSlug === input.slug) {
      await tx
        .update(vocabularyTerm)
        .set({ status: 'active', labelPtBr, labelEnUs, sort: nextSort, updatedAt: new Date() })
        .where(eq(vocabularyTerm.slug, input.slug))
      return { result: { ok: true as const, slug: input.slug }, notifyOwnerIds }
    }

    // Correção de slug canônico: valida o NOVO slug antes de tocar o banco.
    const newSlug = input.newSlug
    if (newSlug.length === 0 || slugify(newSlug) !== newSlug) {
      return { result: { ok: false as const, error: 'slug_invalido' as const }, notifyOwnerIds: [] }
    }

    // INSERE o pai novo PRIMEIRO (FK-safe). Colisão (incl. lápide) → returning vazio → slug_em_uso.
    const inserted = await tx
      .insert(vocabularyTerm)
      .values({ kind: 'cozinha', slug: newSlug, status: 'active', labelPtBr, labelEnUs, sort: nextSort })
      .onConflictDoNothing({ target: vocabularyTerm.slug })
      .returning({ slug: vocabularyTerm.slug })
    if (inserted.length === 0)
      return { result: { ok: false as const, error: 'slug_em_uso' as const }, notifyOwnerIds: [] }

    // Reaponta os filhos old→new (todos os donos), depois tomba o antigo (agora sem referências).
    await tx.update(recipe).set({ cozinha: newSlug }).where(eq(recipe.cozinha, input.slug))
    await tx.update(briefing).set({ cozinha: newSlug }).where(eq(briefing.cozinha, input.slug))
    await tx
      .update(vocabularyTerm)
      .set({ status: 'merged', updatedAt: new Date() })
      .where(eq(vocabularyTerm.slug, input.slug))
    return { result: { ok: true as const, slug: newSlug }, notifyOwnerIds }
  })

  // Fan-out DEPOIS do commit, com o `db` de topo (NUNCA o tx): um insert falho não pode dar rollback na
  // aprovação (best-effort, `emitNotification` já engole erro). Só no primeiro-evento genuíno (ok).
  if (result.ok) {
    for (const ownerId of notifyOwnerIds) {
      await emitNotification(db, { recipientId: ownerId, type: 'cuisine_suggestion_resolved' })
    }
  }
  return result
}

/**
 * MESCLA uma cozinha sugerida numa cozinha ATIVA existente (`target`). O alvo DEVE ser uma cozinha
 * `active` (senão `alvo_invalido` — não se mescla numa sugerida/lápide/depreciada). REPONTA
 * `recipe.cozinha` de TODAS as receitas anexadas (todos os donos) old→target e TOMBA a sugerida
 * (`merged`). `briefing.cozinha` NÃO é reescrito (proveniência imutável, ADR-0006): segue apontando
 * a lápide — FK válida porque a linha PERSISTE (nunca deletada).
 */
export async function mergeCozinha(
  db: Database,
  input: { slug: string; target: string },
): Promise<MergeCozinhaResult> {
  const { result, notifyOwnerIds } = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: vocabularyTerm.status })
      .from(vocabularyTerm)
      .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, input.slug)))
      .for('update')
    if (!row) return { result: { ok: false as const, error: 'nao_encontrado' as const }, notifyOwnerIds: [] }
    if (row.status !== 'suggested')
      return { result: { ok: false as const, error: 'ja_resolvido' as const }, notifyOwnerIds: [] }

    // O alvo precisa ser uma cozinha ATIVA (existente, viva). Auto-merge (target===slug) cai aqui
    // como alvo_invalido (a própria sugerida não é 'active').
    const [target] = await tx
      .select({ slug: vocabularyTerm.slug })
      .from(vocabularyTerm)
      .where(
        and(
          eq(vocabularyTerm.kind, 'cozinha'),
          eq(vocabularyTerm.slug, input.target),
          eq(vocabularyTerm.status, 'active'),
        ),
      )
    if (!target) return { result: { ok: false as const, error: 'alvo_invalido' as const }, notifyOwnerIds: [] }

    // Sugeridores DISTINTOS ANTES de repontar `recipe.cozinha` (o `.set` reescreve o ponteiro).
    const notifyOwnerIds = await distinctSuggesterOwnerIds(tx, input.slug)

    await tx.update(recipe).set({ cozinha: input.target }).where(eq(recipe.cozinha, input.slug))
    // briefing.cozinha NÃO é tocado (imutável; segue apontando a lápide, FK válida — a linha persiste).
    await tx
      .update(vocabularyTerm)
      .set({ status: 'merged', updatedAt: new Date() })
      .where(eq(vocabularyTerm.slug, input.slug))
    return { result: { ok: true as const }, notifyOwnerIds }
  })

  // Fan-out pós-commit, `db` de topo, só no primeiro-evento (ok) — best-effort.
  if (result.ok) {
    for (const ownerId of notifyOwnerIds) {
      await emitNotification(db, { recipientId: ownerId, type: 'cuisine_suggestion_resolved' })
    }
  }
  return result
}

/**
 * REJEITA uma cozinha sugerida. Anula `recipe.cozinha` (→ NULL) de TODAS as receitas anexadas (todos
 * os donos) — o efeito-de-dado É o sinal visível ao dono (a receita deixa de exibir cozinha e o texto
 * "Outra" pendente some da edição). TOMBA a sugerida (`rejected`). `briefing.cozinha` NÃO é reescrito
 * (imutável; segue apontando a lápide, FK válida — a linha persiste). NUNCA toca `recipe.visibility`:
 * a receita pública segue publicada, só sem cozinha.
 */
export async function rejectCozinha(
  db: Database,
  input: { slug: string },
): Promise<RejectCozinhaResult> {
  const { result, notifyOwnerIds } = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: vocabularyTerm.status })
      .from(vocabularyTerm)
      .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, input.slug)))
      .for('update')
    if (!row) return { result: { ok: false as const, error: 'nao_encontrado' as const }, notifyOwnerIds: [] }
    if (row.status !== 'suggested')
      return { result: { ok: false as const, error: 'ja_resolvido' as const }, notifyOwnerIds: [] }

    // Sugeridores DISTINTOS ANTES de anular `recipe.cozinha` (o `.set(null)` apaga o ponteiro).
    const notifyOwnerIds = await distinctSuggesterOwnerIds(tx, input.slug)

    await tx.update(recipe).set({ cozinha: null }).where(eq(recipe.cozinha, input.slug))
    // briefing.cozinha NÃO é tocado (imutável). NUNCA toca visibility.
    await tx
      .update(vocabularyTerm)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(vocabularyTerm.slug, input.slug))
    return { result: { ok: true as const }, notifyOwnerIds }
  })

  // Fan-out pós-commit, `db` de topo, só no primeiro-evento (ok) — best-effort.
  if (result.ok) {
    for (const ownerId of notifyOwnerIds) {
      await emitNotification(db, { recipientId: ownerId, type: 'cuisine_suggestion_resolved' })
    }
  }
  return result
}
