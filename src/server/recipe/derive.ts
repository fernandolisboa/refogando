import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import type { Categoria, Cozinha, Restricao, Unidade } from '@/domain/vocabulary'
import { isRestricao } from '@/domain/vocabulary'
import { decideDerivedDiff, type DiffLado } from '@/domain/recipe-diff'
import { shouldSuggestNewImage, visualChangesFromDiff } from '@/domain/image-review'
import { loadRecipeRows } from '@/server/recipe/load'
import { pgCode } from '@/server/recipe/visibility'
import { embedTranslation } from '@/server/embedding/recompute'

/**
 * Derivação de Receita NÃO-própria (issue #17) — o KEYSTONE de "Minhas criações".
 *
 * Editar uma receita que o leitor NÃO possui (catálogo, ownerId NULL; OU pública de outro)
 * NUNCA muta a base: FORKA uma NOVA linha de `recipe` do leitor, com o diff CONGELADO no
 * instante do fork. Reusa o TEMPLATE ESTRUTURAL de `createCatalogRecipe`/`persistGeneration`
 * (pai antes de filhos, numa única `db.transaction`); a base fica BYTE-INALTERADA e
 * RE-FORKÁVEL (cada chamada cria uma derivada independente).
 *
 * Decisões congeladas (#17):
 *  - `origin='user_edited'` SETADO SÓ NO INSERT. O trigger `recipe_origin_immutable` (P0001,
 *    drizzle/0001) só dispara em UPDATE de origin — um INSERT puro é seguro. Ainda assim
 *    capturamos P0001 via `pgCode` e RE-LANÇAMOS (rede de segurança; nunca engolimos).
 *  - `ownerId=viewerId`, `visibility='private'` (a derivada nasce privada; publicar é #13).
 *  - `resultKind` HERDADO da base (FONTE: a base é a verdade da taxonomia de resultado). Um
 *    base playful ⇒ derivada playful ⇒ o CHECK recipe_playful_private_chk EXIGE private (já é).
 *  - `parentRecipeId=baseId` + `lineageKind='edited'` (linhagem do fork).
 *  - `derivedDiff` = `decideDerivedDiff({base, edits})` CONGELADO (nunca recomputado na leitura
 *    — história 289: apagar a base anula parent_recipe_id e um diff recomputado sumiria).
 *  - Traduções/ingredientes são COPIADOS (snapshot NOW), NÃO referência viva à base: editar a
 *    base depois NÃO toca a derivada (nem o conteúdo, nem o diff).
 */

export type DeriveEdits = {
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  ingredientes: ReadonlyArray<{
    rawText: string | null
    quantidade: string | null // numeric(10,3) ⇒ string|null, NUNCA number
    unidade: Unidade | null
  }>
  restricoes: ReadonlyArray<Restricao>
}

/**
 * Projeta um `DiffLado` (entrada do motor puro) a partir de titulo/descricao/passos +
 * ingredientes + restricoes. O `nome` de comparação do ingrediente é o `rawText` (o rótulo
 * de superfície do snapshot); `null` vira string vazia para o casamento (itens raw-only sem
 * texto colapsam num único nome vazio — caso de borda aceitável, não há identidade melhor).
 */
function toDiffLado(input: {
  titulo: string
  descricao: string | null
  passos: string[] | null
  ingredientes: ReadonlyArray<{ rawText: string | null; quantidade: string | null }>
  restricoes: ReadonlyArray<Restricao>
}): DiffLado {
  return {
    titulo: input.titulo,
    descricao: input.descricao,
    passos: input.passos,
    ingredientes: input.ingredientes.map((i) => ({ nome: i.rawText ?? '', quantidade: i.quantidade })),
    restricoes: input.restricoes,
  }
}

export type DeriveResult =
  // 201 — `imageReviewSuggested` (#131): a derivada HERDOU a imagem da base E uma mudança VISUAL
  // (título/ingredientes) tornou a foto possivelmente desatualizada ⇒ a UI sugere revisar.
  | { kind: 'ok'; recipeId: string; imageReviewSuggested: boolean }
  | { kind: 'not_found' } //            404 — base inexistente (corrida pós-gate)

/**
 * Forka a derivada. O route já fez o GATE (uuid + sessão + ownership + visibilidade) e
 * validou `edits`; aqui carregamos a base, computamos o diff congelado e gravamos a nova
 * linha + cópias numa só transação. Devolve `{recipeId}` da derivada (ou not_found se a base
 * sumiu entre o gate e a carga — corrida improvável, mantém o contrato 404).
 */
export async function deriveRecipe(input: {
  db: Database
  baseId: string // já validado uuid + autorizado pelo route (NÃO-próprio, legível)
  viewerId: string // session.user.id (o futuro dono da derivada)
  edits: DeriveEdits
  locale: string // requestLocale — o locale em que as edições textuais se aplicam
}): Promise<DeriveResult> {
  const { db, baseId, viewerId, edits, locale } = input

  // Carrega a base (espinha + traduções + ingredientes). NULL ⇒ corrida pós-gate ⇒ 404.
  const baseRows = await loadRecipeRows(db, baseId)
  if (!baseRows) return { kind: 'not_found' }

  const baseRecipe = baseRows.recipe

  // A tradução-base do locale pedido é a fonte dos campos textuais "de" do diff. Quando a base
  // não tem o locale pedido, cai no originalLocale (assim o diff compara contra texto real, não
  // contra vazio). Os ingredientes-base vêm do snapshot do loader (ordenado por ordem,id).
  const baseTranslationDoLocale =
    baseRows.translations.find((t) => t.locale === locale) ??
    baseRows.translations.find((t) => t.locale === baseRecipe.originalLocale)

  const baseLado = toDiffLado({
    titulo: baseTranslationDoLocale?.titulo ?? '',
    descricao: baseTranslationDoLocale?.descricao ?? null,
    passos: baseTranslationDoLocale?.passos ?? null,
    ingredientes: baseRows.ingredients.map((i) => ({ rawText: i.rawText, quantidade: i.quantidade })),
    restricoes: baseRecipe.restricoes.filter(isRestricao),
  })

  const editsLado = toDiffLado({
    titulo: edits.titulo,
    descricao: edits.descricao,
    passos: edits.passos,
    ingredientes: edits.ingredientes,
    restricoes: edits.restricoes,
  })

  // Diff CONGELADO no instante do fork (apresentacional, versionado). Armazenado, nunca recomputado.
  const derivedDiff = decideDerivedDiff({ base: baseLado, edits: editsLado })

  // SNAPSHOT FIEL: para preservar a FK canônica (e com ela o dado de alérgeno que alimenta o
  // Aviso de restrição no GET — #7/ADR-0004), mapeamos o `ingredientId` da base por `rawText`.
  // Um item editado que casa por rawText um item canônico da base herda a FK; itens novos/sem
  // casamento ficam ingredientId NULL (raw-text-only). O loader não projeta a FK, então lemos
  // (rawText → ingredientId) direto. Primeiro casamento por rawText vence (determinístico).
  const baseIngredientFk = new Map<string, string>()
  const baseIngRows = await db
    .select({ rawText: recipeIngredient.rawText, ingredientId: recipeIngredient.ingredientId })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, baseId))
    .orderBy(recipeIngredient.ordem, recipeIngredient.id)
  for (const ing of baseIngRows) {
    if (ing.rawText != null && ing.ingredientId != null && !baseIngredientFk.has(ing.rawText)) {
      baseIngredientFk.set(ing.rawText, ing.ingredientId)
    }
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Pai primeiro (mirror de createCatalogRecipe). origin SÓ no INSERT (trigger P0001 só
      // dispara em UPDATE). resultKind HERDADO da base; playful ⇒ private satisfaz o CHECK.
      const [r] = await tx
        .insert(recipe)
        .values({
          origin: 'user_edited',
          ownerId: viewerId,
          visibility: 'private',
          resultKind: baseRecipe.resultKind, // FONTE: base é a verdade da taxonomia de resultado
          originalLocale: baseRecipe.originalLocale,
          // cozinha/categoria vêm da coluna ENUM da base (RecipeRow os alarga p/ string|null;
          // o valor lido É um membro válido do enum) — herdadas inalteradas da base.
          cozinha: baseRecipe.cozinha as Cozinha | null,
          categoria: baseRecipe.categoria as Categoria | null,
          restricoes: [...edits.restricoes],
          porcoes: baseRecipe.porcoes,
          dificuldade: baseRecipe.dificuldade,
          parentRecipeId: baseId,
          lineageKind: 'edited',
          derivedDiff,
          // Carry-forward da Imagem (#131, ADR-0016): a derivada HERDA o image_id da base (mesmo
          // blob, ZERO arquivo novo — many-versions→one-image; o ref-count de #130 já conta certo).
          // NULL quando a base não tem imagem.
          imageId: baseRecipe.imageId,
          // schemaVersion: default de banco.
        })
        .returning({ id: recipe.id })

      // Traduções: COPIA todas as da base (snapshot), MAS para o locale pedido aplica as edições
      // textuais (titulo/descricao/passos/notas do request). Provenance preservada da base; a do
      // locale editado nasce 'escrita_por_pessoa' (o leitor escreveu/curou o texto editado).
      const translationsToInsert = baseRows.translations.map((t) =>
        t.locale === locale
          ? {
              recipeId: r.id,
              locale,
              titulo: edits.titulo,
              descricao: edits.descricao,
              passos: edits.passos,
              notas: edits.notas,
              provenance: 'escrita_por_pessoa' as const,
            }
          : {
              recipeId: r.id,
              locale: t.locale,
              titulo: t.titulo,
              descricao: t.descricao,
              passos: t.passos,
              notas: t.notas,
              provenance: t.provenance,
            },
      )
      // Se a base NÃO tinha o locale pedido, ele entra como tradução nova (edições + origem do leitor).
      if (!baseRows.translations.some((t) => t.locale === locale)) {
        translationsToInsert.push({
          recipeId: r.id,
          locale,
          titulo: edits.titulo,
          descricao: edits.descricao,
          passos: edits.passos,
          notas: edits.notas,
          provenance: 'escrita_por_pessoa' as const,
        })
      }
      if (translationsToInsert.length > 0) {
        await tx.insert(recipeTranslation).values(translationsToInsert)
      }

      // Ingredientes: SNAPSHOT das edições (o que o leitor mandou é o estado final da derivada).
      // `ingredientId` HERDA a FK canônica da base quando o `rawText` casa um item canônico
      // (snapshot fiel ⇒ o dado de alérgeno segue alimentando o Aviso no GET); item novo/sem
      // casamento ⇒ null (raw-text-only). quantidade string|null; ordem por índice.
      if (edits.ingredientes.length > 0) {
        await tx.insert(recipeIngredient).values(
          edits.ingredientes.map((it, i) => ({
            recipeId: r.id,
            ingredientId: it.rawText != null ? (baseIngredientFk.get(it.rawText) ?? null) : null,
            ordem: i,
            quantidade: it.quantidade, // string|null
            unidade: it.unidade,
            rawText: it.rawText,
          })),
        )
      }

      // #131: a derivada herdou a imagem da base? Então uma mudança VISUAL (título/ingredientes,
      // lida do diff JÁ congelado) sugere revisar a foto. Sem imagem herdada ⇒ silencioso.
      const imageReviewSuggested = shouldSuggestNewImage({
        hasImage: baseRecipe.imageId != null,
        changed: visualChangesFromDiff(derivedDiff),
      })
      return { kind: 'ok' as const, recipeId: r.id, imageReviewSuggested }
    })

    // #119: embeda a derivada (best-effort, ASSISTIVO) DEPOIS do commit — a tx não pode segurar a
    // chamada de rede do embedder. Falha (sem key / 429 / rede) NÃO derruba o fork; a Busca degrada
    // pra FTS+trigram. Embeda o originalLocale (a tradução-fonte do novo recipe).
    await embedTranslation(db, result.recipeId, baseRecipe.originalLocale).catch(() => {})
    return result
  } catch (e) {
    // Rede de segurança (defense-in-depth): o INSERT seta origin='user_edited' e o trigger
    // recipe_origin_immutable só dispara em UPDATE — um P0001 aqui seria bug INTERNO (nunca
    // num INSERT puro). NUNCA engolimos: P0001 é reconhecido explicitamente (via `pgCode`,
    // mesmo helper de visibility.ts) e RE-LANÇADO como 500 honesto; qualquer outro erro também
    // propaga intacto. O `if` documenta/audita a fronteira mesmo relançando nos dois ramos.
    if (pgCode(e) === 'P0001') throw e // origin imutável (ADR-0002) — relança, não mascara
    throw e
  }
}
