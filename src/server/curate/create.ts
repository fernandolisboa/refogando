import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import type { Cozinha, Categoria, Restricao, Unidade } from '@/domain/vocabulary'
import type { TranslationProvenance } from '@/domain/recipe'
import type { CurationStatus } from '@/domain/recipe-curation'
import { slugForNewTranslation } from '@/server/recipe/slug'

/**
 * Criação de Receita de CATÁLOGO editorial (issue #19, AC1; estendido p/ o seed #238/ADR-0026).
 *
 * Caminho NOVO (NÃO reusa `persistGeneration`, cujo `PersistOrigin` EXCLUI 'catalog'). Reusa o
 * TEMPLATE ESTRUTURAL da tx de `persistGeneration` (pai antes de filhos, numa transação) com as
 * decisões congeladas:
 *  - `origin='catalog'` no INSERT (origin é imutável via trigger BEFORE UPDATE — o INSERT NUNCA é
 *    gateado; verificado no micro-spike).
 *  - `ownerId=null` (catálogo/sistema — ADR-0011) ⇒ ramo de leitura por owner-NULL.
 *  - `visibility='private'` (default de banco; owner-NULL já abre a leitura — NÃO setar 'public').
 *  - itens com `ingredientId=null` (resolução Item→canônico é AC2, endpoint separado);
 *    `quantidade` string|null (numeric(10,3) trafega como string, NUNCA number).
 *
 * #238/ADR-0026 — ESTADO DE CURADORIA + BILÍNGUE-NA-ORIGEM:
 *  - `curationStatus` e a `provenance` de cada tradução vêm por chamador (sem default — fail-closed):
 *      • seed (rascunho de IA): `curationStatus='pending'`, provenance `automatica_nao_revisada`.
 *      • editorial hand-made (#19): `curationStatus='approved'`, provenance `escrita_por_pessoa`,
 *        `reviewedBy` = o Curador da sessão (nasce curado — a pessoa escreveu = curou).
 *  - `translations[]` aceita 1 (hand-made) OU 2 (seed pt-BR + en-US), cada uma congelando o slug no
 *    seu locale. Bilíngue-na-origem pula a auto-tradução deferida (ADR-0014).
 *  - `reviewedAt`/`reviewedBy` setados JUNTOS (satisfaz o CHECK): só quando há um `reviewedBy` real
 *    (aprovação registrada). Caso contrário ambos NULL.
 *
 * NÃO seta embedding (nasce ausente/dormente; embeda na APROVAÇÃO — ADR-0026); NÃO chama `applyEdit`.
 */

export type CatalogTranslationInput = {
  locale: string // já canonicalizado pela borda
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  provenance: TranslationProvenance
}

export type CreateCatalogRecipeInput = {
  /** Qual locale é o "original" (identidade primária; governa qual tradução a aprovação promove). */
  originalLocale: string
  /** 1 (hand-made) ou 2 (seed bilíngue) traduções; cada uma congela seu slug. */
  translations: CatalogTranslationInput[]
  cozinha: Cozinha | null
  categoria: Categoria | null
  restricoes: Restricao[]
  porcoes: number | null
  dificuldade: number | null
  tempoAtivoMin: number | null
  tempoTotalMin: number | null
  ingredientes: {
    rawText: string | null
    quantidade: string | null // numeric(10,3) ⇒ string|null, NUNCA number
    unidade: Unidade | null
  }[]
  /** #238: seed insere 'pending' (escondido); hand-made insere 'approved' (público). Obrigatório. */
  curationStatus: Extract<CurationStatus, 'pending' | 'approved'>
  /** Curador que assina a aprovação (hand-made). NULL no seed pending. */
  reviewedBy: string | null
}

export async function createCatalogRecipe(
  db: Database,
  input: CreateCatalogRecipeInput,
): Promise<{ recipeId: string }> {
  // reviewed_at/by setados JUNTOS (CHECK recipe_curation_review_consistency_chk): só quando há um
  // reviewedBy real (aprovação registrada). 'pending' ⇒ ambos NULL.
  const reviewedBy = input.curationStatus === 'approved' ? input.reviewedBy : null

  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(recipe)
      .values({
        origin: 'catalog',
        visibility: 'private', // owner-NULL abre a leitura; NÃO 'public'
        ownerId: null,
        originalLocale: input.originalLocale,
        cozinha: input.cozinha,
        categoria: input.categoria,
        restricoes: input.restricoes,
        porcoes: input.porcoes,
        dificuldade: input.dificuldade,
        tempoAtivoMin: input.tempoAtivoMin,
        tempoTotalMin: input.tempoTotalMin,
        curationStatus: input.curationStatus,
        reviewedAt: reviewedBy ? sql`now()` : null,
        reviewedBy,
        // resultKind/schemaVersion: default de banco.
      })
      .returning({ id: recipe.id })

    // Uma tradução por locale, cada uma com slug congelado AGORA a partir do título deste locale
    // (#229, ADR-0020 dec.4), desambiguado contra os slugs já em uso no locale.
    for (const t of input.translations) {
      const slug = await slugForNewTranslation(tx, { locale: t.locale, title: t.titulo })
      await tx.insert(recipeTranslation).values({
        recipeId: r.id,
        locale: t.locale,
        titulo: t.titulo,
        descricao: t.descricao,
        passos: t.passos,
        notas: t.notas,
        slug,
        provenance: t.provenance,
      })
    }

    if (input.ingredientes.length > 0) {
      await tx.insert(recipeIngredient).values(
        input.ingredientes.map((it, i) => ({
          recipeId: r.id,
          ingredientId: null,
          ordem: i,
          quantidade: it.quantidade, // string|null
          unidade: it.unidade,
          rawText: it.rawText,
        })),
      )
    }

    return { recipeId: r.id }
  })
}
