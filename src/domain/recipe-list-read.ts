/**
 * Montagem PURA do item de "Minhas criações" (issue #61). Sem DB, sem I/O: recebe a linha
 * já carregada (espinha da Receita + as traduções original/pedida) + o `requestLocale` e
 * devolve o `RecipeListItem` que o route serializa.
 *
 * Reusa `resolveName` (#3) para o título exibido (original primário + tradução confiável
 * entre parênteses) — NÃO re-deriva a regra de nome. DIFERENTE do Feed/Busca (`projectResult`):
 * a lista do dono NÃO calcula `autoTranslationSignal` (sinal de tela pública) e EXPÕE os campos
 * de gestão que só fazem sentido pro dono (`visibility`/`resultKind`/`lineageKind`), que a
 * leitura pública gateia. O dono vê TUDO da própria Receita (inclusive private/playful/removida)
 * — o gate de pool NÃO se aplica aqui (a query owner-scoped é a fonte da verdade).
 *
 * "Sem título exibível" (defesa "nunca tela quebrada", espelha `projectResult`): se `resolveName`
 * devolver string vazia, cai no rótulo localizado `semTitulo` — o dono nunca vê um card mudo.
 */
import type { LineageKind, Origin, ResultKind, Visibility } from '@/domain/recipe'
import { resolveName, type TranslationRow } from '@/domain/recipe-read'

/**
 * Linha da Receita que a lista do dono consome: a espinha (id/origin/visibility/resultKind/
 * lineageKind/originalLocale/updatedAt) + as traduções para resolver o título. `updatedAt`
 * trafega como TEXTO canônico do Postgres (`::text` ou `.toISOString()` no loader) — o
 * cliente só o exibe/ordena, nunca o reanalisa.
 */
export type RecipeListRow = {
  id: string
  origin: Origin
  visibility: Visibility
  resultKind: ResultKind
  lineageKind: LineageKind | null
  originalLocale: string
  updatedAt: string
  // Removida-do-pool pela moderação (#18). É dado do PRÓPRIO dono (query owner-scoped, sem
  // vazamento): a lista mostra TUDO que é seu, inclusive o que saiu do acervo público.
  moderationRemovida: boolean
  // Imagem da receita (#130/#206): `blob_url` PÚBLICO da thumbnail, já gateado por
  // `moderated_at IS NULL` no loader (espelha feed.ts). `undefined` = sem imagem.
  imageUrl?: string
  // Proveniência da imagem (#216): `recipe_image.provenance` da thumbnail. `undefined` = sem imagem.
  // `resolveRecipeListItem` deriva o booleano `imageAiGenerated` (espelha `projectResult`).
  imageProvenance?: 'user_photo' | 'ai_generated'
  translations: ReadonlyArray<TranslationRow>
}

/**
 * Item de "Minhas criações" como sai na lista serializada. `name` é o título exibido já
 * resolvido (não o titulo cru). `lineageKind` é `null` para uma Receita NÃO-derivada/NÃO-
 * regenerada (catálogo/geração nascem `null`).
 */
export type RecipeListItem = {
  id: string
  name: string
  origin: Origin
  visibility: Visibility
  resultKind: ResultKind
  lineageKind: LineageKind | null
  updatedAt: string
  // Removida-do-pool (#18): a UI renderiza um selo "fora do acervo" — só o dono vê.
  moderationRemovida: boolean
  // Imagem da receita (#130/#206): `blob_url` da thumbnail; `undefined` = sem imagem (placeholder).
  imageUrl?: string
  // Imagem gerada por IA (#216): derivado de `imageProvenance === 'ai_generated'` — a UI sobrepõe
  // o selo "✨ gerada por IA" na thumbnail (espelha `projectResult`/RecipeResultItem). Omitido se falso.
  imageAiGenerated?: boolean
}

/**
 * Projeta UMA linha do dono para `RecipeListItem`. PURO/total: nunca lança. O título exibido
 * vem de `resolveName` (#3); se vazio (sem tradução exibível), cai em `fallbackName` (rótulo
 * localizado que o route/UI injeta — o domínio não importa MESSAGES por linha).
 */
export function resolveRecipeListItem(
  row: RecipeListRow,
  requestLocale: string,
  fallbackName: string,
): RecipeListItem {
  const name = resolveName({
    originalLocale: row.originalLocale,
    requestLocale,
    translations: row.translations,
  })
  return {
    id: row.id,
    name: name.length > 0 ? name : fallbackName,
    origin: row.origin,
    visibility: row.visibility,
    resultKind: row.resultKind,
    lineageKind: row.lineageKind,
    updatedAt: row.updatedAt,
    moderationRemovida: row.moderationRemovida,
    imageUrl: row.imageUrl,
    ...(row.imageProvenance === 'ai_generated' ? { imageAiGenerated: true } : {}),
  }
}
