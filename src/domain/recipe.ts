/**
 * Espinha canônica da Receita — kernel de domínio (issue #3).
 *
 * Mesma forma de `vocabulary.ts`: arrays `as const` + tipos derivados + validadores
 * PUROS de pertencimento. Sem nenhum import de Drizzle — este módulo é a fonte dos
 * conjuntos que `db/schema.ts` mapeia para `pgEnum`. Nada de DB, nada de I/O.
 *
 * `origin` é o selo de proveniência (ADR-0002): imutável no banco via trigger.
 * `provenance` de tradução distingue texto confiável (pessoa ou revisado) do não
 * revisado — `isTranslationReliable` é a regra que a leitura localizada consulta.
 */

// ── Origin: selo de proveniência da Receita (imutável — ADR-0002) ──────────────
export const ORIGENS = ['catalog', 'ai_chat', 'ai_structured', 'ai_free_text', 'user_edited'] as const
export type Origin = (typeof ORIGENS)[number]

// ── Visibilidade ───────────────────────────────────────────────────────────────
export const VISIBILIDADES = ['private', 'public'] as const
export type Visibility = (typeof VISIBILIDADES)[number]

// ── Tipo de resultado da geração ───────────────────────────────────────────────
export const RESULT_KINDS = ['success', 'degraded', 'playful'] as const
export type ResultKind = (typeof RESULT_KINDS)[number]

// ── Modo de criação da Session (ADR-0006): conversa (#12), estruturado (#11) ou ──
// ── prompt aberto / free_text (#88) ─────────────────────────────────────────────
export const CREATION_MODES = ['conversation', 'structured', 'free_text'] as const
export type CreationMode = (typeof CREATION_MODES)[number]

// ── Linhagem: como a Receita derivou de um pai ─────────────────────────────────
export const LINEAGE_KINDS = ['regenerated', 'edited'] as const
export type LineageKind = (typeof LINEAGE_KINDS)[number]

// ── Proveniência da tradução (confiável = pessoa OU revisada) ──────────────────
export const TRANSLATION_PROVENANCES = [
  'escrita_por_pessoa', 'automatica_revisada', 'automatica_nao_revisada',
] as const
export type TranslationProvenance = (typeof TRANSLATION_PROVENANCES)[number]

// ── Proveniência da Imagem da receita (#130, ADR-0016) ─────────────────────────
// Eixo DISTINTO da Proveniência da Receita (ORIGENS, "como a receita surgiu"): aqui é "como a
// IMAGEM surgiu" — foto do Usuário (#130) ou ilustração gerada por IA (#132). Mora na entidade
// `recipe_image`, nunca na Tradução (a imagem é language-neutral — ver CONTEXT.md).
export const IMAGE_PROVENANCES = ['user_photo', 'ai_generated'] as const
export type ImageProvenance = (typeof IMAGE_PROVENANCES)[number]

export const SCHEMA_VERSION_RECEITA = 1 as const

// ── Validadores PUROS ──────────────────────────────────────────────────────────

export function isOrigin(v: string): v is Origin {
  return (ORIGENS as readonly string[]).includes(v)
}

export function isVisibility(v: string): v is Visibility {
  return (VISIBILIDADES as readonly string[]).includes(v)
}

export function isResultKind(v: string): v is ResultKind {
  return (RESULT_KINDS as readonly string[]).includes(v)
}

export function isCreationMode(v: string): v is CreationMode {
  return (CREATION_MODES as readonly string[]).includes(v)
}

export function isLineageKind(v: string): v is LineageKind {
  return (LINEAGE_KINDS as readonly string[]).includes(v)
}

export function isTranslationProvenance(v: string): v is TranslationProvenance {
  return (TRANSLATION_PROVENANCES as readonly string[]).includes(v)
}

export function isTranslationReliable(p: TranslationProvenance): boolean {
  return p === 'escrita_por_pessoa' || p === 'automatica_revisada'
}

// ── Seção da Busca (#6): regra PURA de seccionamento por origin ─────────────────

/** Seção da Busca: Catálogo (origin `catalog`) vs. Comunidade (o resto). */
export type SearchSection = 'catalogo' | 'comunidade'

/**
 * Classifica a seção da Busca a partir do `origin`: `catalog` ⇒ Catálogo; o resto
 * (`ai_chat`/`ai_structured`/`ai_free_text`/`user_edited`) ⇒ Comunidade. PURO — fonte única da
 * regra de seção no TS (o SQL espelha a MESMA regra para particionar o ranking).
 */
export function classifySection(origin: Origin): SearchSection {
  return origin === 'catalog' ? 'catalogo' : 'comunidade'
}
