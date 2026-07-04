import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { vocabularyTerm } from '@/db/schema'
import { slugify } from '@/domain/handle'

/**
 * CRUD mínimo da taxonomia de cozinhas para o Admin (#321, ADR-0025 Decisão 4 — curadoria
 * proativa). DML de runtime PURA: `vocabulary_term` já existe (pós-#318), NÃO há migração.
 *
 * Estilo em UNIÃO DISCRIMINADA (`{ ok:true } | { ok:false, error }`), sem exceção de
 * control-flow — espelha o guard/`requireRole`. As rotas (`/api/admin/vocabulary`) mapeiam
 * cada `error` para um status; a UI discrimina pela CHAVE, nunca pelo número.
 *
 * LEITURA admin é DB-DIRETA (não o cache `loadVocabulary`): o Admin precisa ver as
 * depreciadas + o estado FRESCO logo após escrever (o cache tem TTL de 30s, não bustado).
 *
 * FRONTEIRA PROATIVA × REATIVA (curadoria #319/#320): esta superfície só governa o ciclo
 * ATIVO ('active' ↔ 'deprecated'). Toda escrita restringe o status ATUAL a
 * `['active','deprecated']` no WHERE — uma linha 'suggested'/'merged'/'rejected' não casa
 * NADA → `nao_encontrado`. Assim o Admin NUNCA aprova uma sugestão UGC (#319) nem revive um
 * tombstone (#320) por fora da fila do Curador.
 */

/** Status que a superfície do Admin enxerga/governa (ciclo proativo). */
const ADMIN_VISIBLE_STATUSES = ['active', 'deprecated'] as const

/** Linha de cozinha como o Admin a vê (inclui `status`, ao contrário da view de leitura). */
export type AdminCozinhaRow = {
  slug: string
  labelPtBr: string | null
  labelEnUs: string | null
  // #422 (ADR-0029 dec.3): nota de voz curada, editável AQUI (Admin proativo) sem deploy. LOCALE-
  // NEUTRA e OPCIONAL (null quando não curada). NÃO entra na fila do Curador — é edição proativa.
  voiceNote: string | null
  status: 'active' | 'deprecated'
  sort: number
}

/** Resultado da escrita: união discriminada (sem exceção). */
export type AddCozinhaResult =
  | { ok: true; slug: string }
  | { ok: false; error: 'slug_invalido' | 'rotulos_invalidos' | 'slug_em_uso' }

export type MutateCozinhaResult = { ok: true; slug: string } | { ok: false; error: 'nao_encontrado' }

/**
 * Resultado de editar rótulos: além do `nao_encontrado` (WHERE sem match), distingue
 * `rotulos_invalidos` (rótulo presente mas vazio/branco) — senão a rota mapearia uma falha de
 * validação como 404 "não encontrada" numa cozinha que existe na lista logo acima do form.
 */
export type EditCozinhaResult =
  | { ok: true; slug: string }
  | { ok: false; error: 'nao_encontrado' | 'rotulos_invalidos' }

/**
 * Lista as cozinhas que o Admin governa — DB-DIRETO (vê depreciadas + estado fresco), kind
 * 'cozinha' e status ∈ {active,deprecated}. Ordenado por (sort, slug). 'suggested'/'merged'/
 * 'rejected' NÃO aparecem aqui (são a fila do Curador #320, nunca esta superfície).
 */
export async function listCozinhasForAdmin(db: Database): Promise<AdminCozinhaRow[]> {
  const rows = await db
    .select({
      slug: vocabularyTerm.slug,
      labelPtBr: vocabularyTerm.labelPtBr,
      labelEnUs: vocabularyTerm.labelEnUs,
      voiceNote: vocabularyTerm.voiceNote,
      status: vocabularyTerm.status,
      sort: vocabularyTerm.sort,
    })
    .from(vocabularyTerm)
    .where(
      and(
        eq(vocabularyTerm.kind, 'cozinha'),
        inArray(vocabularyTerm.status, [...ADMIN_VISIBLE_STATUSES]),
      ),
    )
    .orderBy(asc(vocabularyTerm.sort), asc(vocabularyTerm.slug))
  // O status já vem restrito a {active,deprecated} pelo WHERE — o cast estreita o enum amplo.
  return rows as AdminCozinhaRow[]
}

/**
 * Adiciona uma cozinha NOVA, nascendo `active` (faceta imediata — completa a promessa "sem
 * deploy" pela porta proativa). Valida: `slugify(slug)===slug` e não-vazio (slug canônico,
 * congelado depois — ADR-0025 Decisão 2); ambos os rótulos TRIMADOS não-vazios. `sort` =
 * (maior sort de cozinha) + 1 (anexa ao fim, como a americana).
 *
 * Conflito de UNIQUE(slug) tratado por `onConflictDoNothing` + `.returning()` vazio →
 * `slug_em_uso` (NUNCA deixa a violação do PG virar 500).
 */
export async function addCozinha(
  db: Database,
  input: { slug: string; labelPtBr: string; labelEnUs: string },
): Promise<AddCozinhaResult> {
  const slug = typeof input.slug === 'string' ? input.slug : ''
  if (slug.length === 0 || slugify(slug) !== slug) {
    return { ok: false, error: 'slug_invalido' }
  }
  const labelPtBr = typeof input.labelPtBr === 'string' ? input.labelPtBr.trim() : ''
  const labelEnUs = typeof input.labelEnUs === 'string' ? input.labelEnUs.trim() : ''
  if (labelPtBr.length === 0 || labelEnUs.length === 0) {
    return { ok: false, error: 'rotulos_invalidos' }
  }

  // sort do novo termo = maior sort de cozinha + 1 (anexa). Sem linha ⇒ 0.
  const [maxRow] = await db
    .select({ sort: vocabularyTerm.sort })
    .from(vocabularyTerm)
    .where(eq(vocabularyTerm.kind, 'cozinha'))
    .orderBy(desc(vocabularyTerm.sort))
    .limit(1)
  const nextSort = (maxRow?.sort ?? -1) + 1

  const inserted = await db
    .insert(vocabularyTerm)
    .values({ kind: 'cozinha', slug, status: 'active', labelPtBr, labelEnUs, sort: nextSort })
    .onConflictDoNothing({ target: vocabularyTerm.slug })
    .returning({ slug: vocabularyTerm.slug })

  if (inserted.length === 0) return { ok: false, error: 'slug_em_uso' }
  return { ok: true, slug }
}

/**
 * Edita os RÓTULOS e/ou a NOTA DE VOZ (#422) de uma cozinha (nunca o slug — identidade congelada,
 * ADR-0025 Decisão 2). Só atualiza os campos PRESENTES. Rótulos, se presentes, trimados NÃO-vazios
 * (rótulo é obrigatório). A `voiceNote` (#422) é OPCIONAL e distinta: aceita `''`/só-espaços → `null`
 * (limpar a nota é uma edição válida — a nota NÃO é obrigatória; um patch SÓ-de-nota é permitido).
 * WHERE restringe o status atual a {active,deprecated}: uma linha 'suggested'/'merged'/'rejected'
 * não casa → `nao_encontrado` (o Admin NÃO mexe numa sugestão #319 pendente por aqui).
 */
export async function editCozinhaLabels(
  db: Database,
  slug: string,
  labels: { labelPtBr?: string; labelEnUs?: string; voiceNote?: string | null },
): Promise<EditCozinhaResult> {
  const set: {
    labelPtBr?: string
    labelEnUs?: string
    voiceNote?: string | null
    updatedAt: Date
  } = { updatedAt: new Date() }
  if (labels.labelPtBr !== undefined) {
    const v = typeof labels.labelPtBr === 'string' ? labels.labelPtBr.trim() : ''
    if (v.length === 0) return { ok: false, error: 'rotulos_invalidos' }
    set.labelPtBr = v
  }
  if (labels.labelEnUs !== undefined) {
    const v = typeof labels.labelEnUs === 'string' ? labels.labelEnUs.trim() : ''
    if (v.length === 0) return { ok: false, error: 'rotulos_invalidos' }
    set.labelEnUs = v
  }
  // #422: nota de voz OPCIONAL — trima; vazio/só-espaços vira NULL (limpar). Nunca é "inválida".
  if (labels.voiceNote !== undefined) {
    const v = typeof labels.voiceNote === 'string' ? labels.voiceNote.trim() : ''
    set.voiceNote = v.length === 0 ? null : v
  }

  const updated = await db
    .update(vocabularyTerm)
    .set(set)
    .where(
      and(
        eq(vocabularyTerm.kind, 'cozinha'),
        eq(vocabularyTerm.slug, slug),
        inArray(vocabularyTerm.status, [...ADMIN_VISIBLE_STATUSES]),
      ),
    )
    .returning({ slug: vocabularyTerm.slug })

  if (updated.length === 0) return { ok: false, error: 'nao_encontrado' }
  return { ok: true, slug }
}

/**
 * Vira o status de uma cozinha — SÓ 'active' ↔ 'deprecated' (depreciar/reativar). WHERE
 * restringe o status ATUAL a {active,deprecated}: uma linha 'suggested'/'merged'/'rejected'
 * não casa → `nao_encontrado`. Fecha a porta-dos-fundos onde um PATCH status='active' numa
 * sugestão #319 a APROVARIA por fora da fila do Curador #320.
 */
export async function setCozinhaStatus(
  db: Database,
  slug: string,
  status: 'active' | 'deprecated',
): Promise<MutateCozinhaResult> {
  const updated = await db
    .update(vocabularyTerm)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(vocabularyTerm.kind, 'cozinha'),
        eq(vocabularyTerm.slug, slug),
        inArray(vocabularyTerm.status, [...ADMIN_VISIBLE_STATUSES]),
      ),
    )
    .returning({ slug: vocabularyTerm.slug })

  if (updated.length === 0) return { ok: false, error: 'nao_encontrado' }
  return { ok: true, slug }
}
