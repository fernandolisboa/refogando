import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation, users } from '@/db/schema'
import {
  decideDerivedCredit,
  needsDerivedCreditLookup,
  type DerivedCreditDecision,
} from '@/domain/derived-credit'
import type { RecipeRow, TranslationNameRow } from '@/domain/recipe-read'
import { publicAccountFilter } from '@/server/auth/pending-account'
import { emailVerificationRequired } from '@/lib/auth'
import { eligibleForPublicRead } from '@/domain/recipe-detail-route'
import { DEFAULT_LOCALE, canonicalLocale } from '@/i18n/locale'

/**
 * Lê a base de uma derivada para o crédito público (#610, ADR-0052) e decide com o puro `decideDerivedCredit`.
 * Receita que não é derivada não paga query nenhuma (nem a de crédito retirado lida por anônimo).
 *
 * UMA query: o pai + o dono dele (LEFT JOIN, catálogo não tem; `publicAccountFilter` vira coluna) + as traduções
 * no idioma original e no pedido + o slug no pedido. O gate de leitura pública da base é do puro, então a query
 * traz as colunas cruas e nada sai daqui sem passar por ele. `viewerId` (sessão) só serve ao controle do dono da
 * base (`creditoDoAutor`); o caminho público sem cookie não o passa.
 */
export async function loadDerivedCredit(
  db: Database,
  input: {
    recipe: Pick<RecipeRow, 'ownerId' | 'lineageKind' | 'parentRecipeId' | 'creditRemovedAt'>
    locale: string
    viewerId?: string
  },
): Promise<DerivedCreditDecision> {
  const derived = {
    ownerId: input.recipe.ownerId ?? null,
    lineageKind: input.recipe.lineageKind ?? null,
    parentRecipeId: input.recipe.parentRecipeId ?? null,
    creditRemovedAt: input.recipe.creditRemovedAt ?? null,
  }
  if (!needsDerivedCreditLookup(derived, input.viewerId) || derived.parentRecipeId == null) return {}
  // O locale vira prefixo do link e chave do slug: só a forma canônica (o `?locale=` do GET por uuid é livre).
  const locale = canonicalLocale(input.locale) ?? DEFAULT_LOCALE

  const tOrig = alias(recipeTranslation, 'credit_t_orig')
  const tLoc = alias(recipeTranslation, 'credit_t_loc')
  const [row] = await db
    .select({
      id: recipe.id,
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
      curationStatus: recipe.curationStatus,
      origin: recipe.origin,
      originalLocale: recipe.originalLocale,
      origTitulo: tOrig.titulo,
      origProvenance: tOrig.provenance,
      locTitulo: tLoc.titulo,
      locProvenance: tLoc.provenance,
      slugNoLocale: tLoc.slug,
      ownerHandle: users.handle,
      ownerPublic: sql<boolean>`coalesce(${publicAccountFilter(emailVerificationRequired())}, false)`,
      ownerCreditOnDerivatives: users.creditOnDerivatives,
    })
    .from(recipe)
    .leftJoin(users, eq(users.id, recipe.ownerId))
    .leftJoin(tOrig, and(eq(tOrig.recipeId, recipe.id), eq(tOrig.locale, recipe.originalLocale)))
    .leftJoin(tLoc, and(eq(tLoc.recipeId, recipe.id), eq(tLoc.locale, locale)))
    .where(eq(recipe.id, derived.parentRecipeId))
    .limit(1)

  const translations: TranslationNameRow[] = []
  if (row?.origTitulo != null && row.origProvenance != null) {
    translations.push({ locale: row.originalLocale, titulo: row.origTitulo, provenance: row.origProvenance })
  }
  if (row?.locTitulo != null && row.locProvenance != null && locale !== row.originalLocale) {
    translations.push({ locale, titulo: row.locTitulo, provenance: row.locProvenance })
  }

  return decideDerivedCredit({
    derived,
    base: row
      ? {
          id: row.id,
          ownerId: row.ownerId,
          visibility: row.visibility,
          resultKind: row.resultKind,
          moderationRemovedAt: row.moderationRemovedAt,
          curationStatus: row.curationStatus,
          origin: row.origin,
          originalLocale: row.originalLocale,
          translations,
          slugNoLocale: row.slugNoLocale,
        }
      : null,
    baseOwner:
      row?.ownerHandle != null
        ? {
            handle: row.ownerHandle,
            publicAccount: row.ownerPublic === true,
            creditOnDerivatives: row.ownerCreditOnDerivatives === true,
          }
        : null,
    locale,
    ...(input.viewerId ? { viewerId: input.viewerId } : {}),
  })
}

/**
 * "Retirar meu nome" / "Mostrar meu nome de novo" (#610): o DONO DA BASE liga ou desliga o crédito numa derivada.
 * Autoriza pela linhagem: a receita `id` é derivada (`lineage_kind='edited'`) de uma receita cujo `owner_id` é o
 * leitor, a derivada é leitura pública (é onde o crédito aparece) e o crédito valeria sem a retirada. Qualquer outro caso, inclusive o dono da
 * DERIVADA (o crédito não é dele para tirar), é `not_found` (404 leak-safe: não diz se a receita existe).
 *
 * Retirar de novo mantém a data da primeira retirada; mostrar zera. Não toca `updated_at` (não é edição da receita).
 */
export async function setDerivedCreditVisible(
  db: Database,
  input: { recipeId: string; viewerId: string; exibir: boolean },
): Promise<{ kind: 'ok'; exibir: boolean } | { kind: 'not_found' }> {
  const parent = alias(recipe, 'credit_parent')
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
      curationStatus: recipe.curationStatus,
      lineageKind: recipe.lineageKind,
      parentRecipeId: recipe.parentRecipeId,
      creditRemovedAt: recipe.creditRemovedAt,
    })
    .from(recipe)
    .innerJoin(parent, eq(parent.id, recipe.parentRecipeId))
    .where(
      and(eq(recipe.id, input.recipeId), eq(recipe.lineageKind, 'edited'), eq(parent.ownerId, input.viewerId)),
    )
    .limit(1)
  if (!gate || gate.ownerId === input.viewerId || !eligibleForPublicRead(gate)) return { kind: 'not_found' }
  // A mesma regra que oferece o controle na página: só quando o nome estaria lá se não fosse a retirada (base
  // pública, conta pública, crédito ligado no perfil). Senão "mostrar de novo" responderia `exibir: true` sem
  // nada aparecer. O locale não muda essa resposta (o título vem da tradução no idioma original, que toda receita
  // tem).
  const { creditoDoAutor } = await loadDerivedCredit(db, {
    recipe: gate,
    locale: DEFAULT_LOCALE,
    viewerId: input.viewerId,
  })
  if (!creditoDoAutor) return { kind: 'not_found' }

  await db
    .update(recipe)
    .set({ creditRemovedAt: input.exibir ? null : sql`coalesce(${recipe.creditRemovedAt}, now())` })
    .where(eq(recipe.id, input.recipeId))
  return { kind: 'ok', exibir: input.exibir }
}
