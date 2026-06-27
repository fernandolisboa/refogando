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
  status: 'active' | 'deprecated'
  sort: number
}

/** Resultado da escrita: união discriminada (sem exceção). */
export type AddCozinhaResult =
  | { ok: true; slug: string }
  | { ok: false; error: 'slug_invalido' | 'rotulos_invalidos' | 'slug_em_uso' }

export type MutateCozinhaResult = { ok: true; slug: string } | { ok: false; error: 'nao_encontrado' }

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
 * Edita os RÓTULOS de uma cozinha (nunca o slug — identidade congelada, ADR-0025 Decisão 2).
 * Só atualiza os rótulos PRESENTES (cada um, se presente, trimado não-vazio). WHERE restringe
 * o status atual a {active,deprecated}: uma linha 'suggested'/'merged'/'rejected' não casa →
 * `nao_encontrado` (o Admin NÃO mexe nos rótulos de uma sugestão #319 pendente).
 */
export async function editCozinhaLabels(
  db: Database,
  slug: string,
  labels: { labelPtBr?: string; labelEnUs?: string },
): Promise<MutateCozinhaResult> {
  const set: { labelPtBr?: string; labelEnUs?: string; updatedAt: Date } = { updatedAt: new Date() }
  if (labels.labelPtBr !== undefined) {
    const v = typeof labels.labelPtBr === 'string' ? labels.labelPtBr.trim() : ''
    if (v.length === 0) return { ok: false, error: 'nao_encontrado' }
    set.labelPtBr = v
  }
  if (labels.labelEnUs !== undefined) {
    const v = typeof labels.labelEnUs === 'string' ? labels.labelEnUs.trim() : ''
    if (v.length === 0) return { ok: false, error: 'nao_encontrado' }
    set.labelEnUs = v
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
