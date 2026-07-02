import { sql } from 'drizzle-orm'
import {
  pgTable,
  pgEnum,
  serial,
  uuid,
  text,
  integer,
  smallint,
  numeric,
  boolean,
  timestamp,
  jsonb,
  vector,
  index,
  uniqueIndex,
  unique,
  primaryKey,
  check,
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { CATEGORIAS, RESTRICOES, UNIDADES } from '@/domain/vocabulary'
import {
  ORIGENS,
  VISIBILIDADES,
  RESULT_KINDS,
  LINEAGE_KINDS,
  TRANSLATION_PROVENANCES,
  IMAGE_PROVENANCES,
  CREATION_MODES,
  SCHEMA_VERSION_RECEITA,
} from '@/domain/recipe'
import { GENERATION_OUTCOMES } from '@/domain/generation'
import type { DerivedDiff } from '@/domain/recipe-diff'
import type { ProfileLink } from '@/domain/links'
import { ROLES } from '@/domain/user'
import { STRENGTHS } from '@/domain/briefing'
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_GEN_CAP_BY_ROLE,
  type ImageGenCapByRole,
} from '@/domain/image-gen-config'
import {
  DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
  type RecipeGenCapByRole,
} from '@/domain/recipe-gen-config'
import { DEFAULT_WEB_SEARCH_CONFIG } from '@/domain/web-search-config'
import { DEFAULT_CATALOG_DISCLOSURE_CONFIG } from '@/domain/catalog-disclosure-config'
import { DEFAULT_POPULARITY_CONFIG, type PopularityConfig } from '@/domain/popularity'
import { REPORT_STATUSES } from '@/domain/report'
import { CURATION_STATUSES } from '@/domain/recipe-curation'
import { VOCABULARY_KINDS, VOCABULARY_TERM_STATUSES } from '@/domain/vocabulary-term'
import { TRANSCRIPT_ROLES } from '@/domain/transcript'
import { NOTIFICATION_TYPES } from '@/domain/notification'
import { DSAR_EVENT_TYPES } from '@/domain/dsar'

/**
 * Dimensão do vetor de embedding da camada semântica (#14, ADR-0008). Co-locada com a
 * coluna `recipe_embedding.embedding` (`vector(EMBEDDING_DIMENSIONS)`) — fonte única que
 * o route reusa para validar a saída do embedder antes de bindar (uma saída de dimensão
 * errada faria o cast `::vector` estourar 500; o route degrada em vez disso).
 */
export const EMBEDDING_DIMENSIONS = 1536

/**
 * Espinha canônica da Receita (issue #3). Drizzle é a fonte única de verdade do
 * schema (ADR-0009). Convenções: prop camelCase em JS + nome snake_case explícito
 * em DB; timestamps `withTimezone` com `defaultNow().notNull()`. Enums vêm do kernel
 * de domínio (`vocabulary.ts` + `recipe.ts`) — mesma lista, um só lugar.
 *
 * `recipe_embedding` é DORMENTE: a coluna `embedding` é nullable e fica NULL na #3
 * (a camada semântica real — modelo/índice — nasce na #14). Igualmente dormentes:
 * `ingredient.alergenos` e `recipe_ingredient.nota` (sem comportamento aqui).
 */

// ── Enums (do kernel de domínio — fonte única) ─────────────────────────────────
// Cozinha NÃO é mais pgEnum (#318, ADR-0025): virou `text` com FK p/ `vocabulary_term.slug`
// (data-driven). O pgEnum `cozinha` foi DROPADO na migração 0034 (DROP TYPE) — ver recipe.cozinha
// e briefing.cozinha abaixo. Os demais enums seguem do kernel estático.
export const categoriaEnum = pgEnum('categoria', CATEGORIAS)
export const restricaoEnum = pgEnum('restricao', RESTRICOES)
export const unidadeEnum = pgEnum('unidade', UNIDADES)
export const originEnum = pgEnum('origin', ORIGENS)
export const visibilityEnum = pgEnum('visibility', VISIBILIDADES)
export const resultKindEnum = pgEnum('result_kind', RESULT_KINDS)
export const lineageKindEnum = pgEnum('lineage_kind', LINEAGE_KINDS)
export const translationProvenanceEnum = pgEnum('translation_provenance', TRANSLATION_PROVENANCES)
// Proveniência da Imagem da receita (#130, ADR-0016). Fonte única: IMAGE_PROVENANCES de
// @/domain/recipe. Eixo DISTINTO de originEnum (Proveniência da Receita) — DB type
// 'image_provenance'. user_photo (foto do dono, #130) | ai_generated (gerada por IA, #132).
export const imageProvenanceEnum = pgEnum('image_provenance', IMAGE_PROVENANCES)
// Kernel de geração (issue #8). Modo da Session (ADR-0006) + taxonomia de resultado
// (5 valores, auditável). Fonte única: CREATION_MODES (recipe.ts) + GENERATION_OUTCOMES
// (generation.ts). `result_kind` segue congelado em success|degraded|playful.
export const creationModeEnum = pgEnum('creation_mode', CREATION_MODES)
export const generationOutcomeEnum = pgEnum('generation_outcome', GENERATION_OUTCOMES)
// Papel de Usuário (issue #5). Fonte única: ROLES de @/domain/user. Sem `visitante`
// (Visitante = ausência de sessão/conta — ADR-0011).
export const roleEnum = pgEnum('role', ROLES)
// Força do BriefingItem (issue #11). Fonte única: STRENGTHS de @/domain/briefing —
// `strength` é conceito do Briefing, não do kernel bidirecional de vocabulary.ts
// (espelha creationModeEnum importando de recipe.ts). ÚNICO enum novo da #11.
export const strengthEnum = pgEnum('strength', STRENGTHS)
// Status do Report (issue #18). Fonte única: REPORT_STATUSES de @/domain/report
// (pending/resolved/rejected). Espelha roleEnum/strengthEnum importando do kernel.
export const reportStatusEnum = pgEnum('report_status', REPORT_STATUSES)
// Estado de CURADORIA do catálogo (issue #238, ADR-0026). Fonte única: CURATION_STATUSES de
// @/domain/recipe-curation (pending/editing/approved/rejected/not_required). Pré-publicação
// EXCLUSIVA do catálogo (owner-null); receita de usuário é sempre `not_required`.
export const curationStatusEnum = pgEnum('curation_status', CURATION_STATUSES)
// Vocabulário culinário data-driven (issue #314, ADR-0025). O META fica no código:
// `kind` = quais dimensões existem (só 'cozinha' no passo 1); `vocabulary_term_status` =
// ciclo de vida de um termo. Fonte única: VOCABULARY_KINDS + VOCABULARY_TERM_STATUSES de
// @/domain/vocabulary-term. QUAIS cozinhas existem vira DADO (linhas de vocabulary_term).
export const vocabularyKindEnum = pgEnum('vocabulary_kind', VOCABULARY_KINDS)
export const vocabularyTermStatusEnum = pgEnum('vocabulary_term_status', VOCABULARY_TERM_STATUSES)
// Papel da fala na Transcrição durável (issue #15). Fonte única: TRANSCRIPT_ROLES de
// @/domain/transcript (user/assistant) — espelha roleEnum/strengthEnum importando do
// kernel. DB type 'transcript_role', DISTINTO de roleEnum (DB type 'role', papéis de
// Usuário): o TS id é `transcriptRoleEnum`, NUNCA `roleEnum` (já em uso ~linha 71).
export const transcriptRoleEnum = pgEnum('transcript_role', TRANSCRIPT_ROLES)
// Tipo do evento de Notificação (issue #371, ADR-0028). Fonte única: NOTIFICATION_TYPES de
// @/domain/notification. Os 7 tipos do catálogo v1 entram de uma vez (completude do enum), mas só
// `new_follower` é EMITIDO nesta fatia. DB type 'notification_type'.
export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES)
// Tipo do evento de auditoria DSAR (issue #395, GAP-5). Fonte única: DSAR_EVENT_TYPES de @/domain/dsar.
// Os 4 tipos do ciclo de vida do pedido do titular entram de uma vez (completude do enum); só
// `DSAR_FULFILLED` é EMITIDO nesta fatia (por clearSourceAttribution). DB type 'dsar_event_type'.
export const dsarEventTypeEnum = pgEnum('dsar_event_type', DSAR_EVENT_TYPES)

/**
 * Tabela de smoke-test do harness de fundação (issue #2).
 *
 * NÃO é proto-Receita: deliberadamente sem domínio (nada de origin, owner_id,
 * visibility, result_kind, locale). A espinha canônica da Receita nasce na #3.
 * Existe só para o route handler de saúde tocar um Postgres real pela porta mais alta.
 */
/**
 * Tipo `tsvector` mínimo (issue #6, busca FTS). A coluna `search_vector` é GERADA
 * STORED no banco (migração 0005) e read-only do ponto de vista da app — nunca a
 * inserimos. customType só precisa do `dataType()` para o typecheck/queries; o DDL
 * de verdade vive em drizzle/0005_busca_fts.sql (fonte única do aplicado).
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const ping = pgTable('ping', {
  id: serial('id').primaryKey(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const recipe = pgTable(
  'recipe',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    origin: originEnum('origin').notNull(),
    visibility: visibilityEnum('visibility').notNull().default('private'),
    resultKind: resultKindEnum('result_kind').notNull().default('success'),
    // FK → users.id, ON DELETE restrict (D5): rede de segurança contra hard-delete
    // acidental (nunca dispara — não há hard-delete). owner_id continua NULLABLE
    // (NULL = catálogo/sistema — ADR-0011, inegociável).
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    originalLocale: text('original_locale').notNull(),
    // Cozinha DATA-DRIVEN (#318, ADR-0025): `text` com FK p/ `vocabulary_term.slug`, ON DELETE
    // RESTRICT (preserva proveniência — um slug em uso nunca some sob a Receita). NULLABLE (default
    // NULL — "sem cozinha"). Ref LAZY (arrow): `vocabularyTerm` é definido ADIANTE (~linha 980); um
    // ref direto seria erro de ordenação/TDZ. Era o pgEnum `cozinha` até a virada #318.
    cozinha: text('cozinha').references((): AnyPgColumn => vocabularyTerm.slug, { onDelete: 'restrict' }),
    categoria: categoriaEnum('categoria'),
    restricoes: restricaoEnum('restricoes').array().notNull().default(sql`'{}'`),
    porcoes: integer('porcoes'),
    dificuldade: integer('dificuldade'),
    // ── Tempo de preparo (#188/#261, ADR-0023) ────────────────────────────────────
    // Atributo INVARIANTE (language-neutral, como porcoes/dificuldade — vive na recipe,
    // nunca na recipe_translation). Duas facetas em minutos: tempo ATIVO (mão na massa) e
    // tempo TOTAL (relógio na parede, inclui esperas passivas como marinar/descansar).
    // Ambos NULLABLE/sem default ("ausente ≠ vazio", espelha porcoes). Output-only da IA
    // (o Briefing NÃO ganha tempo); o CHECK recipe_tempo_consistency_chk garante ativo ≤
    // total (ativo-sozinho é impossível). Sem backfill (linhas existentes ficam NULL).
    tempoAtivoMin: integer('tempo_ativo_min'),
    tempoTotalMin: integer('tempo_total_min'),
    parentRecipeId: uuid('parent_recipe_id').references((): AnyPgColumn => recipe.id, {
      onDelete: 'set null',
    }),
    lineageKind: lineageKindEnum('lineage_kind'),
    // Diff DERIVADO congelado (issue #17): forma apresentacional versionada
    // (`decideDerivedDiff` → recipe-diff.ts) computada UMA vez no fork e ARMAZENADA — NUNCA
    // recomputada na leitura (história 289: apagar a base anula parent_recipe_id e um diff
    // recomputado sumiria). NULLABLE, SEM default, SEM CHECK de propósito: um NOT NULL/default
    // quebraria os INSERTs de persistGeneration/createCatalogRecipe (que não derivam). SÓ as
    // linhas lineageKind='edited' o carregam — invariante de ROTA/DOMÍNIO (derive.ts), não DB.
    // `$type<DerivedDiff>` tipa a leitura/escrita do jsonb (o driver devolve `unknown` cru);
    // a forma é a `DerivedDiff` congelada de recipe-diff.ts (domínio puro, sem ciclo de import).
    derivedDiff: jsonb('derived_diff').$type<DerivedDiff>(),
    // Imagem da receita (#130, ADR-0016): FK OPCIONAL → recipe_image.id, MUITAS-VERSÕES → UMA
    // IMAGEM (many-to-one). Nunca uma coluna-URL: a entidade `recipe_image` carrega blob/proveniência
    // e o blob é ref-counted (apagado só quando NENHUMA linha de recipe referencia o image_id). NULL
    // = sem imagem (o caso normal). ON DELETE set null: se o recipe_image for apagado (último ref),
    // esta FK zera (rede de segurança — o ref-count já garante que ninguém aponta). Forward-ref via
    // AnyPgColumn (recipeImage é definido adiante; mesma técnica do self-ref parent_recipe_id).
    imageId: uuid('image_id').references((): AnyPgColumn => recipeImage.id, { onDelete: 'set null' }),
    // ── Linhagem da galeria de imagens (#222, ADR-0022) ───────────────────────────
    // Chave OPACA da linhagem (ADR-0022 dec.1): a Galeria da Receita R = `recipe_image WHERE
    // lineage_id = R.lineage_id`. NÃO é um tree-walk de parent_recipe_id (previews ficam
    // DESELECIONADAS — a galeria precisa agrupar ANTES de qualquer seleção; e a chave sobrevive ao
    // hard-delete do ancestral, que anula parent_recipe_id por ON DELETE set null). NOT NULL com
    // DEFAULT gen_random_uuid(): toda RAIZ (geração/conversa/catálogo/import/DERIVA) nasce com
    // linhagem PRÓPRIA (o default). A REGENERAÇÃO same-owner (#20) INHERITS a lineage_id da
    // predecessora (setada explicitamente no INSERT — persist.ts). A edição in-place (#21) muta a
    // MESMA linha ⇒ mantém a lineage_id. A DERIVA cross-owner (#17) NÃO herda (ADR-0022 dec.1:
    // "derivada nasce com galeria vazia") — toma o default ⇒ linhagem nova, galeria vazia.
    lineageId: uuid('lineage_id').notNull().defaultRandom(),
    // ── Atribuição da importação da web (#165, ADR-0019) ──────────────────────────
    // Só Receitas `origin=web_imported` (cópia privada de um link externo) carregam estas duas; toda
    // outra Receita as deixa NULL. A Autoria é creditada à FONTE EXTERNA ("fonte: …"), nunca "por
    // <Usuário>" — `source_name` é o nome legível do site/publisher e `source_url` a URL de origem,
    // ambas só para ATRIBUIÇÃO (CONTEXT.md: _Receita importada da web_). NULLABLE/SEM default/SEM
    // CHECK de propósito: um NOT NULL quebraria todos os INSERTs de geração/catálogo (que não
    // importam). A regra "web_imported ⇒ tem atribuição" é invariante de ROTA (import.ts), não DB —
    // espelha o tratamento de derived_diff (só `edited` o carrega, sem CHECK).
    sourceUrl: text('source_url'),
    sourceName: text('source_name'),
    // ── Estado de MODERAÇÃO (issue #18, ADR-0003/0011) ────────────────────────────
    // Remover-do-pool pelo Curador é exclusão LÓGICA de moderação, DISTINTA de
    // despublicar (que toca `visibility`, #13). As 3 colunas são a SAÍDA do pool por
    // moderação (gate de pool ganha `AND moderation_removed_at IS NULL` — ver
    // recipe-pool.ts). Denormalizadas na recipe (não tabela) porque o gate é predicado
    // SQL repetido em ~7 lugares — `moderation_removed_at IS NULL` casa byte-a-byte com
    // `result_kind <> 'playful'`. Nullable/default NULL: a maioria das Receitas nunca é
    // moderada. `moderated_by` ON DELETE set null: apagar o Curador NÃO ressuscita a
    // Receita (o registro "removido" persiste; a proveniência da 1ª remoção é preservada).
    moderationRemovedAt: timestamp('moderation_removed_at', { withTimezone: true }),
    moderationReason: text('moderation_reason'),
    moderatedBy: uuid('moderated_by').references(() => users.id, { onDelete: 'set null' }),
    // ── Estado de CURADORIA do catálogo (issue #238, ADR-0026) ────────────────────
    // Pré-publicação EXCLUSIVA do catálogo (owner-null): um rascunho — inclusive
    // rascunhado por IA (o seed) — fica ESCONDIDO até um Curador aprovar. O gate de
    // comunidade-visível passa a exigir `curation_status='approved'` no ramo owner-null
    // (ver `recipe-curation.ts` isCatalogPubliclyCurated + os 4 espelhos de visibilidade).
    // DEFAULT 'not_required' = receita de USUÁRIO (curadoria não se aplica; Visibilidade
    // governa). ADD COLUMN com default constante = metadata-only (sem rewrite). O catálogo
    // é setado explícito por createCatalogRecipe (pending no seed / approved hand-made);
    // a migração faz backfill `WHERE owner_id IS NULL → approved` (não esconde o existente).
    // reviewed_at/by = "quem curou / quando" (vale p/ aprovar E rejeitar); review_note =
    // motivo da rejeição / nota. ON DELETE set null espelha moderatedBy.
    curationStatus: curationStatusEnum('curation_status').notNull().default('not_required'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewNote: text('review_note'),
    schemaVersion: integer('schema_version').notNull().default(SCHEMA_VERSION_RECEITA),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('recipe_playful_private_chk', sql`${t.resultKind} <> 'playful' OR ${t.visibility} = 'private'`),
    // Consistência de moderação (#18): removed_at e moderated_by setados JUNTOS ou ambos
    // NULL (rede de banco contra remoção sem proveniência). `moderation_reason` fica FORA
    // do CHECK (texto livre) mas é exigido não-vazio na borda do route (decideModerationReason).
    // Ortogonal a recipe_playful_private_chk (este só acopla result_kind/visibility).
    check(
      'recipe_moderation_consistency_chk',
      sql`(${t.moderationRemovedAt} IS NULL) = (${t.moderatedBy} IS NULL)`,
    ),
    // Consistência da curadoria (#238, espelha recipe_moderation_consistency_chk): reviewed_at e
    // reviewed_by setados JUNTOS ou ambos NULL. Satisfeito por TODOS os caminhos: seed `pending`
    // (ambos NULL), aprovação/rejeição (ambos set), backfill de catálogo legado → approved (ambos
    // NULL = true=true). `review_note` fica FORA do CHECK (texto livre). NÃO acoplamos owner↔status
    // por CHECK de propósito: o gate já é fail-closed (not_required em owner-null nunca casa
    // ='approved'), e engessar a tabela quente não paga.
    check(
      'recipe_curation_review_consistency_chk',
      sql`(${t.reviewedAt} IS NULL) = (${t.reviewedBy} IS NULL)`,
    ),
    // Consistência do tempo de preparo (#261, ADR-0023): o ativo só existe junto de um
    // total e nunca o excede (ativo-sozinho é impossível). NULL passa trivialmente —
    // ambas as facetas são opcionais. Espelha o padrão de moderation_consistency_chk.
    check(
      'recipe_tempo_consistency_chk',
      sql`${t.tempoAtivoMin} IS NULL OR (${t.tempoTotalMin} IS NOT NULL AND ${t.tempoAtivoMin} <= ${t.tempoTotalMin})`,
    ),
    index('recipe_restricoes_gin').using('gin', t.restricoes),
    // Índice parcial na FK owner_id: cobre o RESTRICT e queries por owner sem
    // seq-scan. Parcial WHERE owner_id IS NOT NULL — a maioria do catálogo tem
    // owner_id=NULL, então o índice fica enxuto (só Receitas com dono).
    index('recipe_owner_id_idx')
      .on(t.ownerId)
      .where(sql`${t.ownerId} IS NOT NULL`),
    // Índice parcial nas Receitas removidas (#18): enxuto (a maioria é NULL).
    index('recipe_moderation_removed_idx')
      .on(t.moderationRemovedAt)
      .where(sql`${t.moderationRemovedAt} IS NOT NULL`),
    // Fila do Curador de receitas (#238): o predicado é `curation_status IN ('pending','editing')`
    // (os rascunhos ainda não decididos). Índice PARCIAL nesse predicado, ordenado por created_at
    // (ordem da fila) — enxuto, espelha os outros índices parciais (a maioria é 'not_required'/
    // 'approved').
    index('recipe_curation_queue_idx')
      .on(t.createdAt)
      .where(sql`${t.curationStatus} IN ('pending', 'editing')`),
    // Índice parcial na FK image_id (#130): cobre o ref-count (COUNT recipe WHERE image_id = X)
    // que decide se o blob pode ser apagado. Parcial WHERE image_id IS NOT NULL — a maioria das
    // Receitas não tem imagem, então o índice fica enxuto (espelha recipe_owner_id_idx).
    index('recipe_image_id_idx')
      .on(t.imageId)
      .where(sql`${t.imageId} IS NOT NULL`),
  ],
)

/**
 * Imagem da receita (#130, ADR-0016) — ENTIDADE própria, language-neutral (CONTEXT.md: _Imagem da
 * receita_). MUITAS versões da linhagem → UMA imagem: a FK é `recipe.image_id` (acima); aqui NÃO há
 * `recipe_id` de volta — o carry-forward (#131) fará várias linhas de `recipe` apontarem para o
 * MESMO `recipe_image`. O blob é REF-COUNTED: só é apagado quando NENHUMA linha de `recipe`
 * referencia este id (lógica em `server/recipe/image.ts`, não no banco). Proveniência da imagem
 * DISTINTA da Proveniência da Receita: `user_photo` (#130) | `ai_generated` (#132). As flags de
 * moderação ("remover só a imagem", #133) e os metadados de geração IA (#132) NÃO entram aqui ainda
 * — cada fatia os adiciona por migração própria (slice vertical).
 */
export const recipeImage = pgTable(
  'recipe_image',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // URL pública do blob (Vercel Blob, store PUBLIC — servida direto a anônimos). NOT NULL: toda
    // linha de imagem tem um blob (não há recipe_image sem arquivo).
    blobUrl: text('blob_url').notNull(),
    provenance: imageProvenanceEnum('provenance').notNull(),
    // ── Linhagem da galeria (#222, ADR-0022 dec.1) ────────────────────────────────
    // A imagem PERTENCE a uma linhagem (= a galeria daquela linhagem). NOT NULL: setada na criação
    // (`createGalleryImage`) = a `recipe.lineage_id` da Receita-alvo. A galeria do Owner é
    // `recipe_image WHERE lineage_id = recipe.lineage_id ORDER BY created_at` — daí o índice
    // composto (lineage_id, created_at) abaixo. A imagem NÃO carrega `recipe_id` (a face é o
    // ponteiro recipe.image_id; várias versões da linhagem compartilham a galeria).
    lineageId: uuid('lineage_id').notNull(),
    // Quem subiu/gerou (#130). ON DELETE set null (espelha recipe.moderatedBy): apagar o usuário NÃO
    // apaga a imagem (a Receita que a referencia — possivelmente já no catálogo — sobrevive). NULLABLE.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    // ── Parentesco de edição (image-to-image, #285, ADR-0022 atualização) ─────────
    // Quando esta imagem é uma VARIANTE editada a partir de outra, aponta pra imagem-base (auto-FK
    // na própria recipe_image). NULL = gerada do zero / upload. ON DELETE set null: apagar a base
    // NÃO apaga a variante (independente). Dirige o selo "Editada com IA" (NOT NULL) vs "Gerada por
    // IA" (NULL) — só no estúdio do Owner na v1 (#285; público = follow-up do ADR-0022).
    sourceImageId: uuid('source_image_id').references((): AnyPgColumn => recipeImage.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // ── Moderação "remover só a imagem" (#133, ADR-0016) ──────────────────────────
    // Eixo ORTOGONAL a recipe.moderation_removed_at (remover-a-Receita-do-pool, #18): aqui o Curador
    // esconde SÓ a imagem, a Receita CONTINUA no pool. A flag mora na imagem (não na Receita): como a
    // imagem é COMPARTILHADA entre versões (carry-forward), moderá-la a esconde EM TODA PARTE. NÃO
    // apaga o blob nem zera image_id — o Owner segue vendo no privado. O gate público de imagem ganha
    // `AND moderated_at IS NULL` (espelha recipe_moderation_removed). moderatedBy ON DELETE set null:
    // apagar o Curador preserva o registro de moderação.
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderatedReason: text('moderated_reason'),
    moderatedBy: uuid('moderated_by').references(() => users.id, { onDelete: 'set null' }),
    // ── Sinal PROATIVO de revisão (#227, ADR-0022 dec.3) ──────────────────────────
    // Uma geração-por-IA COM refino (o sufixo de estilo em texto livre do Owner, #223) marca a
    // imagem resultante `review_required` ⇒ uma fila PROATIVA e NÃO-BLOQUEANTE do Curador surfa as
    // gerações refinadas. NÃO é um gate de publicação (default-open INTACTO, ADR-0020): a imagem
    // segue pública/selecionável; o Curador só MONITORA e pode REMOVER (moderar, #133) reativamente
    // OU DISPENSAR (zera a flag — julgou ok). Geração SEM refino e UPLOAD nascem `false`. A fila
    // encolhe por remoção (moderated_at setado) OU dispensa (review_required=false). NOT NULL DEFAULT
    // false: um ADD COLUMN com default constante é metadata-only no Postgres moderno (sem rewrite) —
    // seguro na tabela populada do prod; linhas existentes ficam false.
    reviewRequired: boolean('review_required').notNull().default(false),
  },
  (t) => [
    // Consistência (espelha recipe_moderation_consistency_chk): at e by setados JUNTOS ou ambos NULL.
    // `moderated_reason` fica FORA do CHECK (texto livre), exigido não-vazio na borda do route.
    check(
      'recipe_image_moderation_consistency_chk',
      sql`(${t.moderatedAt} IS NULL) = (${t.moderatedBy} IS NULL)`,
    ),
    // Índice parcial nas imagens moderadas (enxuto — a maioria é NULL).
    index('recipe_image_moderated_idx')
      .on(t.moderatedAt)
      .where(sql`${t.moderatedAt} IS NOT NULL`),
    // Galeria por linhagem (#222, ADR-0022 dec.1): a query é `WHERE lineage_id = X ORDER BY
    // created_at` — o índice composto (lineage_id, created_at) cobre filtro + ordenação.
    index('recipe_image_lineage_idx').on(t.lineageId, t.createdAt),
    // Fila proativa do Curador (#227): o predicado da fila é `review_required AND moderated_at IS
    // NULL` (uma imagem já moderada saiu da fila). Índice PARCIAL nesse predicado (ordenado por
    // created_at, a ordem da fila) — enxuto, espelha os outros índices parciais (a maioria é false).
    index('recipe_image_review_required_idx')
      .on(t.createdAt)
      .where(sql`${t.reviewRequired} AND ${t.moderatedAt} IS NULL`),
  ],
)

/**
 * Registro (append-only) de EVENTOS de geração de imagem por IA (#132, ADR-0017) — o LEDGER de
 * custo que o teto de 24h deslizante conta. DISTINTO de `recipe_image`: a entidade da imagem é
 * REF-COUNTED e REAPADA (apagada quando nenhuma versão a referencia — ADR-0016), então NÃO serve de
 * contador (regenerar a mesma receita apagaria a linha e "devolveria o slot", driblando o teto).
 * Este ledger é IMUTÁVEL: cada geração bem-sucedida grava uma linha que NUNCA é apagada por reap —
 * o custo já foi gasto e conta na janela mesmo se a imagem resultante for substituída/moderada
 * (ADR-0017: "não devolve slot"). Uma linha por geração; o teto faz `COUNT WHERE user_id AND
 * created_at > agora-24h`. ON DELETE cascade: apagar o usuário limpa o ledger dele.
 *
 * #224 (ADR-0022 dec.4): a linha passa a CARREGAR o custo — o `model` usado, os tokens do
 * `usageMetadata` (prompt/output-imagem/thinking/total) e o `cost_usd` SNAPSHOT derivado da tabela de
 * preço EM CÓDIGO (`computeImageCost`). TODAS NULLABLE e best-effort: linhas pré-#224 e gerações sem
 * telemetria do provedor ficam nulas (não invalidam o teto, que segue por CONTAGEM — #167). Gravar o
 * custo (não recomputar) congela o que cada geração custou mesmo quando os preços do provedor mudam.
 * `cost_usd` é numeric → trafega string|null (precisão exata; OK p/ snapshot).
 */
export const imageGeneration = pgTable(
  'image_generation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // ── Cost-tracking (#224, ADR-0022 dec.4) — NULLABLE/best-effort ──────────────────
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    outputTokens: integer('output_tokens'),
    thinkingTokens: integer('thinking_tokens'),
    totalTokens: integer('total_tokens'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  },
  (t) => [index('image_generation_user_created_idx').on(t.userId, t.createdAt)],
)

export const recipeTranslation = pgTable(
  'recipe_translation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    titulo: text('titulo').notNull(),
    descricao: text('descricao'),
    passos: text('passos').array(),
    notas: text('notas'),
    // Slug por idioma (#229, ADR-0020): o identificador legível na URL de detalhe
    // (`/{locale}/recipes/<slug>`, nunca o UUID). Derivado do título DAQUELE locale na
    // criação, normalizado (recipe-slug.ts), e CONGELADO — renomear/revisar/republicar não
    // muda a URL; en-US congela a partir do título da MT inicial (estabilidade > beleza).
    // NULLABLE de propósito: (a) tabela POPULADA em prod ⇒ um NOT NULL sem default quebraria
    // o deploy; o backfill preenche numa etapa separada (script idempotente). (b) escreve-se a
    // tradução ANTES de ter slug em alguns caminhos; o slug é materializado por freezeSlug na
    // borda. A unicidade é por (locale, slug) via índice PARCIAL (WHERE slug IS NOT NULL) —
    // ortogonal ao recipe_translation_recipe_locale_uq existente.
    slug: text('slug'),
    provenance: translationProvenanceEnum('provenance').notNull(),
    stale: boolean('stale').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Coluna GERADA STORED (issue #6): FTS por linha, cada uma na própria config de
    // idioma via recipe_ts_config(locale). generatedAlwaysAs marca a coluna como
    // read-only ⇒ omitida de $inferInsert (seedTranslation/persist seguem válidos).
    // A expressão aqui ESPELHA drizzle/0005_busca_fts.sql (fonte única do DDL aplicado).
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector(recipe_ts_config(locale), immutable_unaccent(coalesce(titulo, '') || ' ' || coalesce(descricao, '')))`,
    ),
  },
  (t) => [
    uniqueIndex('recipe_translation_recipe_locale_uq').on(t.recipeId, t.locale),
    // Unicidade do slug POR locale (#229, ADR-0020): pt-BR e en-US podem ter o mesmo slug sem
    // colidir; a colisão dentro de um locale é resolvida por sufixo na borda (disambiguateSlug).
    // PARCIAL (WHERE slug IS NOT NULL): as linhas que ainda não ganharam slug (antes/durante o
    // backfill, ou en-US sem tradução) não disputam a unicidade — só as preenchidas. Ortogonal
    // ao recipe_translation_recipe_locale_uq (este acopla recipe_id+locale, aquele locale+slug).
    uniqueIndex('recipe_translation_locale_slug_uq')
      .on(t.locale, t.slug)
      .where(sql`${t.slug} IS NOT NULL`),
    index('recipe_translation_search_vector_gin').using('gin', t.searchVector),
  ],
)

export const ingredient = pgTable(
  'ingredient',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug'),
    // NULLABLE, dormente — dados oportunistas de alérgeno (ADR-0004). SEM motor de
    // alérgeno/contradição na #3.
    alergenos: text('alergenos').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ingredient_slug_uq').on(t.slug)],
)

export const ingredientTranslation = pgTable(
  'ingredient_translation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredient.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    nome: text('nome').notNull(),
    aliases: text('aliases').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ingredient_translation_ingredient_locale_uq').on(t.ingredientId, t.locale)],
)

export const recipeIngredient = pgTable(
  'recipe_ingredient',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    ingredientId: uuid('ingredient_id').references(() => ingredient.id, { onDelete: 'set null' }),
    ordem: integer('ordem').notNull().default(0),
    quantidade: numeric('quantidade', { precision: 10, scale: 3 }),
    unidade: unidadeEnum('unidade'),
    rawText: text('raw_text'),
    // NULLABLE, dormente — texto livre monolíngue. Tradução por-locale do item está
    // FORA de escopo da #3.
    nota: text('nota'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('recipe_ingredient_recipe_id_idx').on(t.recipeId)],
)

export const tag = pgTable(
  'tag',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nome: text('nome').notNull(),
  },
  (t) => [uniqueIndex('tag_nome_uq').on(t.nome)],
)

export const recipeTag = pgTable(
  'recipe_tag',
  {
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.tagId] })],
)

export const recipeEmbedding = pgTable(
  'recipe_embedding',
  {
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    model: text('model'),
    stale: boolean('stale').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // HNSW para a camada semântica (#14, ADR-0008): cosseno via vector_cosine_ops
  // (obrigatório p/ o planner usar <=>). PARCIAL (embedding IS NOT NULL): a maioria
  // das linhas nasce embedding NULL (degradação/pré-recompute) e um índice sobre NULL
  // não tem uso. A DDL é a fonte da verdade (drizzle/0006_hnsw_recipe_embedding.sql,
  // escrita à mão — drizzle-kit não gera HNSW); este espelho mantém o schema TS honesto.
  (t) => [
    primaryKey({ columns: [t.recipeId, t.locale] }),
    index('recipe_embedding_embedding_hnsw')
      .using('hnsw', t.embedding.op('vector_cosine_ops'))
      .where(sql`${t.embedding} IS NOT NULL`),
  ],
)

// ── Identidade + auth (issue #5, ADR-0010/0011) ────────────────────────────────
//
// `users` (plural — única exceção justificada à convenção singular: evita colisão
// com a palavra reservada `user` do Postgres). Tabela de identidade ÚNICA, com
// `role` (gerenciado pelo plugin admin), `locale` (additionalField) e `deletedAt`
// (additionalField, soft-delete). PKs/FKs em uuid para casar com recipe.owner_id e
// com a geração no banco (Better Auth com generateId:false ⇒ DB preenche via
// uuid().defaultRandom()).

export const users = pgTable(
  'users',
  {
    // uuid gerado pelo Postgres (C1): Better Auth com generateId:false NÃO envia id;
    // o DB preenche via defaultRandom() (= gen_random_uuid()). Casa com recipe.owner_id.
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Handle público, único e legível (#128, CONTEXT.md: _Handle_) — endereça `/u/<handle>`.
    // NOT NULL UNIQUE, SEM default no banco: é gerado na borda (auth hook, slug do `name` +
    // desambiguação) e editável depois. Minúsculo/ascii/[a-z0-9-]; o formato e as reservadas
    // são validados no app (PATCH /api/me), o banco só garante presença + unicidade. Distinto
    // do `name` (display, não-único) e do `id` (uuid interno, nunca na URL pública).
    handle: text('handle').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    // Papel gerenciado pelo plugin admin; pgEnum dá integridade no banco (C6).
    role: roleEnum('role').notNull().default('usuario'),
    // Preferência de apresentação (D1, #4.AC5/#5.AC4). text livre BCP-47, NULLABLE.
    locale: text('locale'),
    // Bio curta do perfil (#124, frente Perfil). text livre, NULLABLE; o CAP de tamanho
    // (~280) é validado na borda do app (PATCH /api/me), não no banco — mesma tese do
    // `locale` (a coluna não restringe; a escrita do app é a fronteira intencional).
    bio: text('bio'),
    // Links sociais do perfil (#127, frente Perfil). jsonb `Array<{ tipo, url }>` (até 5),
    // DEFAULT '[]' (NOT NULL): perfil sem links é lista vazia, nunca null — o GET/UI não
    // precisam de guard de nulo. A FORMA e a SEGURANÇA (allowlist de tipo, só URL http(s),
    // recusa de `javascript:`/`data:` etc.) são validadas na borda (PATCH /api/me via
    // `validateLinks` de @/domain/links), não no banco — mesma tese de `bio`/`locale`. `$type`
    // tipa a leitura/escrita do jsonb (o driver devolve `unknown` cru). Esses links são
    // renderizados CLICÁVEIS no perfil público (#129): a validação de esquema é a fronteira.
    links: jsonb('links').$type<ProfileLink[]>().notNull().default(sql`'[]'::jsonb`),
    // Soft delete (D4): só a coluna agora; máscara/endpoint deferidos.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Campos do plugin admin (OBRIGATÓRIOS com o plugin ligado: o adapter os lê/escreve).
    // A APLICAÇÃO de ban segue deferida (ADR-0007); aqui são colunas inertes
    // (default false / null) — nada lê para gating agora.
    banned: boolean('banned').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    // Restrição GRANULAR de geração de imagem por IA (#226, ADR-0022 dec.3 / 1º gancho do ADR-0007).
    // DISTINTA do `banned` inerte (ban de CONTA INTEIRA, ainda deferido): aqui o Curador bloqueia SÓ a
    // geração de imagem por IA do Usuário (abuso confirmado) — o upload de foto e o resto da conta
    // seguem funcionando. As 3 colunas espelham o idioma de moderação (`recipe.moderation_*`):
    // `at` (quando) + `by` (qual Curador, FK ON DELETE set null) + `reason` (texto livre, obrigatório
    // não-vazio na borda do route ao bloquear). Bloqueado = `image_gen_blocked_at IS NOT NULL`. Todas
    // NULLABLE, sem backfill: usuários existentes nascem desbloqueados. A escada completa (bloquear
    // geração-de-receita → conta inteira) é follow-up (ADR-0007), fora desta fatia.
    imageGenBlockedAt: timestamp('image_gen_blocked_at', { withTimezone: true }),
    // Self-FK (o Curador é um `users`): `AnyPgColumn` quebra a inferência circular do TS — mesma
    // técnica do self-ref `recipe.parent_recipe_id`/`recipe.image_id`.
    imageGenBlockedBy: uuid('image_gen_blocked_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    imageGenBlockedReason: text('image_gen_blocked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    // Unicidade do handle no banco (#128): a borda gera/edita garantindo livre, mas a UNIQUE
    // é a última linha contra corrida (dois signups simultâneos com o mesmo slug → 23505).
    uniqueIndex('users_handle_uq').on(t.handle),
    // Trigram GIN em name/handle (#279) — ESCALA a busca pública de Cozinheiros: `searchUsers` casa por
    // `name ILIKE '%termo%'` / `handle ILIKE '%termo%'` (substring, leading wildcard) que sem índice faz
    // seq scan. `gin_trgm_ops` na COLUNA CRUA acelera ILIKE case-insensitive (a query NÃO usa
    // lower()/unaccent — o índice espelha EXATAMENTE a expressão buscada; copiar o lower(immutable_unaccent)
    // do 0012 deixaria o índice MORTO). DOIS índices (não composto): o planner faz BitmapOr nos dois lados
    // do `name ILIKE OR handle ILIKE`. Não-parcial (sempre usável). pg_trgm já criada no 0012; o índice só
    // engaja com trigrama completo (≥3 chars não-curinga). drizzle-kit GERA `USING gin (col gin_trgm_ops)`
    // via `.op()` em coluna crua (≠ HNSW/0012 hand-written) ⇒ db:generate offline; NUNCA db:migrate local.
    index('users_name_trgm_gin').using('gin', t.name.op('gin_trgm_ops')),
    index('users_handle_trgm_gin').using('gin', t.handle.op('gin_trgm_ops')),
    // Consistência da restrição de imagem (#226) — espelha `recipe_moderation_consistency_chk`:
    // `at` e `by` setados JUNTOS ou ambos NULL (o `reason` fica fora do CHECK — texto livre validado
    // não-vazio na borda do route ao bloquear). Garante que um bloqueio sempre carrega proveniência.
    check(
      'users_image_gen_block_consistency_chk',
      sql`(${t.imageGenBlockedAt} IS NULL) = (${t.imageGenBlockedBy} IS NULL)`,
    ),
  ],
)

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('session_token_uq').on(t.token)],
)

export const account = pgTable('account', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const verification = pgTable('verification', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ── Config de aplicação (#5.AC2 — modelo default; #134 — geração de imagem) ─────
//
// Singleton: só pode existir a linha id=true (CHECK app_config_singleton_chk torna o
// singleton garantia de banco, não só convenção de PK). `default_model` é text livre
// (não enum): o conjunto válido é detalhe de runtime; o handler valida por allowlist.
//
// #134 (geração de imagem por IA, admin-configurável): `image_gen_enabled` liga/desliga a geração;
// `image_gen_model` é o modelo do gerador (text livre + allowlist EM CÓDIGO, espelha default_model);
// `image_gen_cap_by_role` é o teto diário por papel (jsonb Record<Role, number|null>, `null` =
// ILIMITADO — JSON não tem Infinity). Defaults vêm do domínio (mesma fonte da #132). Colunas planas
// na MESMA linha singleton (não tabela própria): a config é um punhado de campos, não uma coleção.
//
// #167 (teto de geração de RECEITA por papel): `recipe_gen_cap_by_role` espelha EXATAMENTE a forma de
// `image_gen_cap_by_role` (jsonb Record<Role, number|null>, `null` = ILIMITADO). Sem `enabled`/`model`
// análogos: a geração de receita é o core do produto (sempre ligada) e o modelo de chat já vive em
// `default_model`. Defaults vêm do domínio (`DEFAULT_RECIPE_GEN_CAP_BY_ROLE`).
//
// #164 (descoberta na web, ADR-0019): `web_search_enabled` liga/desliga a ponte de DESCOBERTA na web
// (links externos quando o acervo é raso); `web_search_allowlist` é a lista de domínios permitidos
// (jsonb string[]). Defaults DESLIGADO + lista VAZIA (fail-closed): a ponte só "acende" quando o admin
// liga E define domínios E o deploy tem credencial (gate humano). A allowlist é fonte ÚNICA tanto da
// busca na web quanto do GUARD de SSRF do import (#165). Defaults vêm do domínio (`web-search-config`).
//
// #237 (aviso de catálogo AI-assistido, SEO #187): `catalog_disclosure_enabled` liga/desliga o aviso
// editorial OPCIONAL ("em colaboração entre curadoria e IA"); `catalog_disclosure_text` é a frase
// EDITÁVEL exibida. Defaults DESLIGADO + texto padrão pt-BR (cortesia opt-in: aparece só quando o
// admin liga). Colunas planas na MESMA linha singleton (não tabela própria) — espelha os demais eixos.
// O aviso é CORTESIA: renderiza só em `origin=catalog` quando ligado e NUNCA suprime os selos
// obrigatórios de proveniência. Defaults vêm do domínio (`catalog-disclosure-config`).
export const appConfig = pgTable(
  'app_config',
  {
    id: boolean('id').primaryKey().default(true),
    defaultModel: text('default_model').notNull().default('claude-opus-4-8'),
    imageGenEnabled: boolean('image_gen_enabled').notNull().default(true),
    imageGenModel: text('image_gen_model').notNull().default(DEFAULT_IMAGE_MODEL),
    imageGenCapByRole: jsonb('image_gen_cap_by_role')
      .$type<ImageGenCapByRole>()
      .notNull()
      .default(DEFAULT_IMAGE_GEN_CAP_BY_ROLE),
    recipeGenCapByRole: jsonb('recipe_gen_cap_by_role')
      .$type<RecipeGenCapByRole>()
      .notNull()
      .default(DEFAULT_RECIPE_GEN_CAP_BY_ROLE),
    webSearchEnabled: boolean('web_search_enabled')
      .notNull()
      .default(DEFAULT_WEB_SEARCH_CONFIG.enabled),
    webSearchAllowlist: jsonb('web_search_allowlist')
      .$type<string[]>()
      .notNull()
      .default(DEFAULT_WEB_SEARCH_CONFIG.allowlist),
    catalogDisclosureEnabled: boolean('catalog_disclosure_enabled')
      .notNull()
      .default(DEFAULT_CATALOG_DISCLOSURE_CONFIG.enabled),
    catalogDisclosureText: text('catalog_disclosure_text')
      .notNull()
      .default(DEFAULT_CATALOG_DISCLOSURE_CONFIG.text),
    // #368 (ADR-0027/0028): constantes da mistura de POPULARIDADE (pesos wSave/wNota/wNovo + m + tauDays)
    // — a FORMA está no ADR (Bayesiana + exp-decay); os NÚMEROS são calibragem reversível ajustável sem
    // deploy. jsonb PopularityConfig na MESMA linha singleton (espelha os demais eixos de config). O
    // read-path re-valida (parsePopularityConfig) — linha legada/editada à mão com lixo cai no DEFAULT.
    popularityConfig: jsonb('popularity_config')
      .$type<PopularityConfig>()
      .notNull()
      .default(DEFAULT_POPULARITY_CONFIG),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check('app_config_singleton_chk', sql`${t.id}`)],
)

// ── Briefing de geração (issue #11, ADR-0006/0009) ─────────────────────────────
//
// O Briefing é a ENTRADA estruturada da criação (o "pedido"), persistido como
// PROVENIÊNCIA distinta da Receita entregue. `briefing` guarda os escalares; cada
// `briefing_item` é um ingrediente com `strength` (força). SEM `categoria` (CONTEXT.md
// proíbe Categoria/Tag no Briefing). A posse vive na `creation_session` (que tem
// `user_id`); o Briefing é pendurado na sessão via `creation_session.briefing_id`.
export const briefing = pgTable('briefing', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Cozinha DATA-DRIVEN (#318, ADR-0025): espelha recipe.cozinha — `text` + FK p/
  // `vocabulary_term.slug`, ON DELETE RESTRICT (briefing.cozinha é proveniência imutável,
  // ADR-0006). Ref LAZY (arrow): `vocabularyTerm` é definido adiante. Era o pgEnum `cozinha`.
  cozinha: text('cozinha').references((): AnyPgColumn => vocabularyTerm.slug, { onDelete: 'restrict' }),
  // Espelha recipe.restricoes: array NOT NULL default '{}' (nunca null; vazio = sem restrição).
  restricoes: restricaoEnum('restricoes').array().notNull().default(sql`'{}'`),
  // NULLABLE (opcionais no pedido, como em recipe).
  porcoes: integer('porcoes'),
  dificuldade: integer('dificuldade'),
  observacoes: text('observacoes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const briefingItem = pgTable(
  'briefing_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Item é parte-de do briefing (espelha recipe_ingredient.recipe_id): ON DELETE cascade.
    briefingId: uuid('briefing_id')
      .notNull()
      .references(() => briefing.id, { onDelete: 'cascade' }),
    // FK opcional ao canônico (espelha recipe_ingredient.ingredient_id): canônico some →
    // item vira raw-text-only. Catálogo ADIADO → normalmente NULL nesta fatia.
    ingredientId: uuid('ingredient_id').references(() => ingredient.id, { onDelete: 'set null' }),
    // Força do item. NOT NULL SEM default (decisão #3): o app sempre envia; o default de
    // UX 'preferred' mora no cliente, não no banco.
    strength: strengthEnum('strength').notNull(),
    // raw_text é NULLABLE no DDL (espelha recipe_ingredient.raw_text), mas o domínio puro
    // GARANTE rawText OU ingredientId (item_sem_identidade). Sem catálogo é o portador do nome.
    rawText: text('raw_text'),
    // numeric(10,3) → trafega string|null, NUNCA number (espelha recipe_ingredient.quantidade).
    quantidade: numeric('quantidade', { precision: 10, scale: 3 }),
    unidade: unidadeEnum('unidade'),
    ordem: integer('ordem').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('briefing_item_briefing_id_idx').on(t.briefingId)],
)

// ── Kernel de geração (issue #8, ADR-0006/0009) ────────────────────────────────
//
// `creation_session`: scaffold mínimo do episódio de criação. ref FRACA session→recipe
// (nunca o reverso), NULLABLE, SEM unicidade (deixa espaço p/ #20 regeneração).
// `generation`: uma linha por tentativa (success|degraded|playful|impossible). Carrega
// o Comentário consultivo FORA da Receita (advisory_comment) + schema_version + model.
export const creationSession = pgTable(
  'creation_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: creationModeEnum('mode').notNull(),
    // ref FRACA session→recipe (nunca o reverso). NULLABLE, ON DELETE set null.
    // SEM unicidade agora (deixa espaço p/ #20 regeneração).
    recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
    // Aponta pro Briefing (issue #11; a sessão aponta pro briefing, nunca o reverso —
    // ADR-0006). NULLABLE (conversation não tem briefing). ON DELETE set null: ref fraca
    // (espelha recipe_id) — briefing some, a sessão (registro durável do episódio) sobrevive.
    briefingId: uuid('briefing_id').references(() => briefing.id, { onDelete: 'set null' }),
    // Texto livre CRU do modo `free_text` (#88), gravado como PROVENIÊNCIA. NULLABLE:
    // só `free_text` o popula; conversation/structured deixam NULL (structured guarda o
    // pedido no Briefing). NÃO entra no CHECK structured_briefing (free_text não exige briefing).
    freeText: text('free_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('creation_session_user_id_idx').on(t.userId),
    // mode=structured EXIGE briefing (AC2). CHECK simples na própria tabela (espelha
    // recipe_playful_private_chk); a rede de banco contra structured-sem-briefing.
    check(
      'creation_session_structured_briefing_chk',
      sql`${t.mode} <> 'structured' OR ${t.briefingId} IS NOT NULL`,
    ),
  ],
)

export const generation = pgTable(
  'generation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creationSessionId: uuid('creation_session_id')
      .notNull()
      .references(() => creationSession.id, { onDelete: 'cascade' }),
    // NULLABLE: NULL para impossible (não há Receita). ON DELETE set null.
    recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
    outcome: generationOutcomeEnum('outcome').notNull(),
    // Comentário consultivo FORA da Receita (ADR-0009).
    advisoryComment: text('advisory_comment'),
    model: text('model').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('generation_creation_session_id_idx').on(t.creationSessionId),
    // Índice parcial na FK recipe_id (espelha recipe_owner_id_idx): a maioria das
    // linhas impossible tem recipe_id NULL, então o índice fica enxuto.
    index('generation_recipe_id_idx')
      .on(t.recipeId)
      .where(sql`${t.recipeId} IS NOT NULL`),
  ],
)

// ── Transcrição durável da conversa (issue #15, ADR-0006/0009) ─────────────────
//
// `transcript_message`: 1-N com `creation_session`. Cada linha é UMA fala ({role,content})
// com `seq` monotônico ATRIBUÍDO PELO SERVIDOR (coalesce(max(seq),-1)+1 na mesma tx) — nunca
// vindo do cliente. UNIQUE(creation_session_id, seq) é a rede de banco contra dupla atribuição
// (23505). ON DELETE cascade: apagar a sessão limpa as falas (a Receita — ref FRACA — sobrevive).
// Apagar a Transcrição (route dedicada de #15) NÃO apaga a Receita; é DELETE direto destas linhas.
export const transcriptMessage = pgTable(
  'transcript_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creationSessionId: uuid('creation_session_id')
      .notNull()
      .references(() => creationSession.id, { onDelete: 'cascade' }),
    role: transcriptRoleEnum('role').notNull(),
    content: text('content').notNull(),
    seq: integer('seq').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Ordena por (sessão, seq) E é a rede UNIQUE contra dupla atribuição de seq na mesma sessão.
    uniqueIndex('transcript_message_session_seq_idx').on(t.creationSessionId, t.seq),
  ],
)

// ── Social: Salvar (issue #16/#362, ADR-0003/0027) ─────────────────────────────
//
// Relação PURA (sem payload): cada linha é "este Usuário salvou esta Receita", espelhando
// recipeTag/recipeEmbedding:
//  - PK composta (user_id, recipe_id): satisfaz a idempotência (salvar 2× = UM save — a
//    re-inserção colide na PK) E cobre o lookup leak-safe "este viewer salvou?" (EXISTS por PK).
//    Desfazer = DELETE da linha (sem updatedAt/deletedAt — o save é descartável).
//  - FK ON DELETE cascade (sem órfãos): apagar Usuário ou Receita limpa os saves.
//    Despublicar é UPDATE de visibility, NUNCA DELETE ⇒ os saves PERSISTEM (AC5).
//  - índice btree em recipe_id: cobre COUNT(*) WHERE recipe_id=? (a Popularidade, #368) e os
//    agregados sociais.
export const recipeSave = pgTable(
  'recipe_save',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.recipeId] }),
    index('recipe_save_recipe_id_idx').on(t.recipeId),
  ],
)

// ── Coleções: pastas PRIVADAS sobre o Salvar (issue #364, ADR-0027) ────────────
//
// A Coleção é uma pasta PRIVADA de UM usuário; `collection_item` é a aresta M:N que põe uma
// Receita SALVA em 0+ coleções (uma Receita pode estar em várias; uma coleção agrupa várias).
// "Todos" = TODOS os saves (não é uma coleção materializada); uma coleção nomeada é um SUBCONJUNTO.
//
//  - `collection`: `UNIQUE(user_id, name)` (uma pessoa não repete nome de pasta — case-sensitive
//    exact-after-trim no v1; case-insensitive exigiria índice funcional `lower(name)`, deferido).
//    FK user_id ON DELETE cascade (apagar o Usuário apaga as pastas). Índice em user_id cobre o
//    "minhas coleções". Tudo PRIVADO: nenhuma leitura é anônima; o servidor escopa por user_id.
//  - `collection_item`: PK composta (collection_id, recipe_id) ⇒ idempotente (add 2× = 1 linha).
//    FK collection_id ON DELETE cascade (apagar a pasta limpa os itens) E recipe_id ON DELETE
//    cascade (apagar a Receita limpa a aresta). Índice em recipe_id cobre o cleanup ao dessalvar.
//
// SAVE É A FONTE DA VERDADE (invariante #364): dessalvar (DELETE em recipe_save) NÃO dispara
// nenhuma FK cascade sobre collection_item (o cascade só liga por recipe, não por save). Por isso
// `applyUnsave` (src/server/recipe/social.ts) apaga, na MESMA transação, os collection_item daquele
// (user, recipe) — senão a Receita ficaria numa coleção sem estar salva (viola collection_item ⊆
// saves). E `applyCollectionAddItem` só admite Receita JÁ salva (trava a save row FOR UPDATE contra
// a corrida com o unsave). Nenhum CHECK cobre isso (é cross-table); o servidor é a rede.
export const collection = pgTable(
  'collection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('collection_user_name_uq').on(t.userId, t.name),
    index('collection_user_id_idx').on(t.userId),
  ],
)

export const collectionItem = pgTable(
  'collection_item',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collection.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.recipeId] }),
    index('collection_item_recipe_id_idx').on(t.recipeId),
  ],
)

// ── Engajamento: Avaliação (issue #363, ADR-0027) ─────────────────────────────
//
// A Avaliação é nota 1–5★ + comentário opcional, UMA por (Usuário, Receita), e alimenta a
// MÉDIA genuína (aggregateRating). Mira a RECEITA (recipe_id, NÃO o locale): a avaliação vale
// idêntica entre pt-BR/en-US (cross-locale, como report). FK ON DELETE cascade em ambas (sem
// órfãos): apagar Usuário ou Receita limpa a avaliação; despublicar é UPDATE de visibility,
// NUNCA DELETE ⇒ as avaliações PERSISTEM (AC5).
//
// `moderated_at` alimenta o SEAM de LEITURA: `loadRecipeReviews`/`loadAggregate` filtram
// `moderated_at IS NULL` desde o dia 1, então a fatia da moderação (#366) vira SÓ um escritor.
// As colunas `photo_url` (#365) e `moderated_reason`/`moderated_by` (#366) já ficam RESERVADAS
// aqui (sem leitor nem escritor na #363), no idioma de `recipe`/`recipe_image`: incluem o CHECK de
// consistência `(moderated_at IS NULL)=(moderated_by IS NULL)` e `moderated_by` é ON DELETE set
// null. Como NÃO há caminho de escrita de moderação nesta fatia, o CHECK nunca é violado e o branch
// set-null nunca dispara. LANDMINE p/ a #366 (o futuro escritor de moderação): SET NULL zera
// `moderated_by` mantendo `moderated_at` setado ⇒ violaria o CHECK e abortaria o DELETE do Curador
// (erasure LGPD). Ao LIGAR a escrita, ancore `moderated_by` numa coluna imune a set-null.
//
// NÃO há CHECK de auto-avaliação (owner_id mora em `recipe`, cross-table). `decideReview`
// (src/domain/review.ts) é a ÚNICA guarda; `applyReview` (src/server/recipe/review.ts) é o
// ÚNICO escritor de recipe_review e o único a chamar `decideReview`. Qualquer FUTURO segundo
// escritor (ex.: o emit da notificação #371 "nova avaliação na sua receita" — enganchar DENTRO
// de `applyReview`) DEVE passar por `decideReview`, ou a guarda de auto-avaliação fura.
export const recipeReview = pgTable(
  'recipe_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    // Foto do prato cozinhado (ADR-0027 dec.4) — coluna RESERVADA aqui; o upload (só câmera/arquivo,
    // NUNCA IA) e a exibição são a fatia da foto (#366). Sem eixo de proveniência (é sempre do usuário).
    photoUrl: text('photo_url'),
    // Moderação da Avaliação (unidade INTEIRA, reativa report→Curador — fatia futura). Colunas
    // RESERVADAS + CHECK/índice de consistência já modelados no idioma do recipe_image: a leitura quente
    // já filtra `moderated_at IS NULL` desde já, e moderatedBy é ON DELETE set null (apagar o Curador
    // não apaga o registro). Sem caminho de escrita de moderação nesta fatia.
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderatedReason: text('moderated_reason'),
    moderatedBy: uuid('moderated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Backstop de DB pro range 1–5 (a guarda de verdade é decideReview no servidor).
    check('recipe_review_rating_chk', sql`${t.rating} between 1 and 5`),
    // Consistência de moderação (espelha recipe_image): moderado ⟺ tem quem moderou.
    check(
      'recipe_review_moderation_consistency_chk',
      sql`(${t.moderatedAt} is null) = (${t.moderatedBy} is null)`,
    ),
    // 1 Avaliação por (user, receita) — também o backstop de concorrência do upsert.
    unique('recipe_review_user_recipe_uq').on(t.userId, t.recipeId),
    // Índice PARCIAL cobrindo a leitura quente `WHERE recipe_id=? AND moderated_at IS NULL`
    // (AVG/COUNT/lista). Idioma de `recipe_moderation_removed_idx`/`recipe_image_moderated_idx`.
    index('recipe_review_recipe_id_idx')
      .on(t.recipeId)
      .where(sql`${t.moderatedAt} is null`),
  ],
)

// Grafo de SEGUIR (#274, ADR-0024) — aresta dirigida `follower → followee` entre Usuários. Espelha
// `recipe_save`: par ÚNICO via PK composta (re-seguir colide na PK = idempotente), DELETE da linha =
// deixar de seguir (sem updatedAt/deletedAt — a aresta é descartável). Seguir é ASSIMÉTRICO e público
// (modelo Instagram, NÃO amizade) e NUNCA dá acesso a conteúdo privado (é só assinatura de descoberta).
//  - FK ON DELETE cascade em AMBAS as colunas (sem órfãos): apagar QUALQUER um dos Usuários limpa a
//    aresta. Soft-delete (deleted_at) NÃO é DELETE ⇒ a aresta PERSISTE, mas os contadores/listas a
//    gateiam por `isNull(users.deleted_at)` no servidor (conta desativada some da social, leak-safe).
//  - CHECK `follower <> followee`: ninguém segue a si mesmo (backstop do DB; o gate de verdade é o 422
//    no servidor ANTES do insert — `src/server/user/follow.ts`, comparando `session.user.id`).
//  - índice em followee_id (lista/conta de SEGUIDORES, futuro trilho) e em follower_id (lista/conta de
//    SEGUINDO, futuro feed "Seguindo" #277). Ambos cobrem COUNT(*) e o JOIN com `users`.
export const userFollow = pgTable(
  'user_follow',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    check('user_follow_not_self_chk', sql`${t.followerId} <> ${t.followeeId}`),
    index('user_follow_followee_id_idx').on(t.followeeId),
    index('user_follow_follower_id_idx').on(t.followerId),
  ],
)

// Caixa de Notificações (#371, ADR-0028) — um EVENTO por Usuário, persistido, com lido/não-lido.
// Guarda DADO ESTRUTURADO (tipo + ator + referências do sujeito), NUNCA frase pronta: o texto é
// renderizado e localizado na leitura (renderNotification), então sem coluna de texto.
//  - recipient_id → users ON DELETE cascade: apagar o dono limpa a caixa dele (sem órfãos).
//  - actor_id → users ON DELETE set null: ações de sistema/Curador podem não ter ator; e um hard-delete
//    (LGPD, #276/#298) preserva a linha degradando o ator. Soft-delete (deleted_at) NÃO é DELETE ⇒ a
//    linha persiste e a LEITURA colapsa a identidade do ator (nome/handle/imagem) por isNull(deleted_at).
//  - recipe_id/review_id → ON DELETE cascade: referências do sujeito conforme o tipo (NULL p/ new_follower).
//  - índice (recipient_id, created_at) p/ a lista paginada + parcial de NÃO-LIDAS (contador). E um índice
//    de cobertura em actor_id: o set-null do hard-delete de um ator varreria a tabela sem ele.
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'cascade' }),
    reviewId: uuid('review_id').references(() => recipeReview.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('notification_recipient_created_idx').on(t.recipientId, t.createdAt),
    index('notification_recipient_unread_idx')
      .on(t.recipientId)
      .where(sql`${t.readAt} is null`),
    index('notification_actor_id_idx').on(t.actorId),
  ],
)

// ── Moderação reativa: Report (issue #18, ADR-0003/0011) ───────────────────────
//
// ENTRADA da moderação: qualquer Usuário autenticado reporta uma Receita do POOL; a linha
// entra na FILA do Curador (status='pending'). O Report mira a RECEITA (recipe_id, não o
// locale): a moderação tem identidade única entre pt-BR/en-US (AC4 — uma decisão afeta a
// Receita em TODOS os locales). Estrutura espelha recipeSave (FK cascade ao
// recipe/users), mas COM payload (reason/status/resolução) — não é relação pura.
//
// MÚLTIPLOS reports por Receita são permitidos (a fila agrega; a 1ª remoção preserva a
// proveniência — ver moderation.ts). Dedup por (recipe,reporter) é followup, não-AC.
//
// POLIMORFISMO DE ALVO (#366): o Report deixa de mirar SÓ a Receita — passa a poder mirar
// UMA Avaliação (`review_id`). `recipe_id` vira NULLABLE e um CHECK exige EXATAMENTE UM alvo
// (recipe XOR review). Reportar uma Avaliação leva a `applyReviewModeration` (moderação da
// unidade INTEIRA da avaliação, espelha remove-image). O alvo-review espelha `notification.reviewId`
// (FK cascade): apagar a Avaliação limpa seus reports (sem órfãos).
export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // #366: NULLABLE (era NOT NULL) — um Report mira a Receita OU uma Avaliação, nunca ambos
    // (CHECK `report_target_chk`). FK cascade mantido.
    recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'cascade' }),
    // #366: alvo-Avaliação. Nullable; FK cascade (precedente EXATO: notification.reviewId). Apagar
    // a Avaliação limpa seus reports. recipeReview é declarado ACIMA → a FK resolve.
    reviewId: uuid('review_id').references(() => recipeReview.id, { onDelete: 'cascade' }),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Motivo verbatim (i18n visível mora na UI #63). Exigido não-vazio na borda do route
    // via decideModerationReason; aqui NOT NULL é a rede de banco.
    reason: text('reason').notNull(),
    status: reportStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Resolução (Curador que removeu/manteve). Nullable enquanto pending. resolvedBy ON
    // DELETE set null: apagar o Curador NÃO apaga o registro de resolução.
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // Agrupamento por Receita + filtro de status (quantos pending por Receita).
    index('report_recipe_status_idx').on(t.recipeId, t.status),
    // #366: agrupamento por Avaliação + filtro de status (quantos pending por avaliação).
    index('report_review_status_idx').on(t.reviewId, t.status),
    // Fila do Curador: pending ordenada por data de criação.
    index('report_status_created_idx').on(t.status, t.createdAt),
    // #366: EXATAMENTE UM alvo — recipe XOR review (backstop de banco do polimorfismo). As linhas
    // legadas (recipe_id set, review_id null) passam: false <> true = TRUE.
    check('report_target_chk', sql`(${t.recipeId} is null) <> (${t.reviewId} is null)`),
  ],
)

/**
 * Termo de vocabulário data-driven (issue #314, ADR-0025 Fatia A). Substitui o pgEnum
 * estático `cozinha` por uma TABELA: quais cozinhas existem vira dado curável (e o caminho
 * "Outra" → sugestão → Curador). Desde a virada #318 `recipe.cozinha`/`briefing.cozinha` são
 * `text` com FK p/ `slug` (o pgEnum `cozinha` foi DROPADO) — esta tabela é a fonte única.
 *
 * `slug` é a chave natural (estável entre locales); os rótulos vivem em duas colunas
 * NULLABLE bilíngues (ADR Decisão 2). `status` nasce 'suggested' por padrão (caminho
 * "Outra"), mas a seed grava 'active' explicitamente.
 */
export const vocabularyTerm = pgTable(
  'vocabulary_term',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: vocabularyKindEnum('kind').notNull(),
    slug: text('slug').notNull(),
    status: vocabularyTermStatusEnum('status').notNull().default('suggested'),
    labelPtBr: text('label_pt_br'),
    labelEnUs: text('label_en_us'),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // UNIQUE(slug) é uma CONSTRAINT real (unique()), NÃO uniqueIndex(): a virada #318
    // referencia `slug` por FK, e o Postgres só aceita FK contra coluna respaldada por
    // UNIQUE CONSTRAINT/PK — um índice único "solto" NÃO é alvo garantido. Mantida CRUA
    // (slug puro, não parcial nem composta kind+slug) por ADR-0025 Decisão 3. NÃO trocar
    // por uniqueIndex numa futura "padronização" — quebraria a FK da #318 silenciosamente.
    unique('vocabulary_term_slug_uq').on(t.slug),
    // Leitura do #315: termos de uma dimensão por status, já ordenados.
    index('vocabulary_term_kind_status_sort_idx').on(t.kind, t.status, t.sort),
  ],
)

/**
 * Trilha de auditoria DSAR — APPEND-ONLY (issue #395, GAP-5; `docs/legal/takedown-e-remocao-titular.md` §5).
 *
 * Prova de conformidade dos pedidos do titular (LGPD Art. 18; Res. CD/ANPD 15/2024 Art. 10). A tabela é
 * um LOG imutável: a aplicação SÓ faz INSERT/SELECT (`recordDsarEvent`/`countDsarEvents` em
 * `src/server/legal/dsar-audit.ts`) — NÃO há caminho de UPDATE nem DELETE dos registros. Não há timestamp
 * `updatedAt` de propósito (uma linha nunca muda). Retenção mínima de 5 anos (sem job de expurgo por ora).
 *
 * MINIMIZAÇÃO: o `DSAR_FULFILLED` NUNCA guarda o dado removido (ex.: o `source_name` do autor) em claro —
 * senão a auditoria vira cópia do que se pediu para apagar. Guarda o `payload_hash` (SHA-256 do payload
 * canônico `{ recipeIds, removedSourceName, ts }`) — prova o que foi feito sem re-armazenar o nome. O
 * `details` (jsonb) carrega só metadados NÃO-sensíveis (ex.: `recipeIds` internos, contagem). O CHECK
 * `dsar_fulfilled_hash_chk` garante no banco que todo `DSAR_FULFILLED` tem hash.
 *
 * As colunas por-tipo são NULLABLE (um único evento usa só as suas): `channel`/`requestType` (RECEIVED),
 * `verificationMethod` (IDENTITY_VERIFIED), `payloadHash` (FULFILLED), `reason` (REJECTED). `caseId`
 * correlaciona o ciclo de vida de um pedido do operador (GAP-4); `actorId` é quem disparou (dono no
 * self-service, ou o Encarregado) — FK `set null` (apagar o ator NÃO apaga a prova).
 */
export const dsarAuditEvent = pgTable(
  'dsar_audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: dsarEventTypeEnum('event_type').notNull(),
    // Correlaciona os eventos de UM pedido (received → verified → fulfilled/rejected). Nullable: o
    // self-service do dono (clearSourceAttribution) não abre ticket. Opaco (sem FK — o ticket é externo).
    caseId: uuid('case_id'),
    // Quem disparou (dono no self-service; Encarregado no fluxo do operador). set null: prova sobrevive
    // à exclusão da conta. Nullable p/ pedidos do titular B (autor de terceiro, sem conta).
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    // DSAR_RECEIVED: canal de intake (ex.: 'self_service' | 'web_form' | 'email') + tipo do pedido.
    channel: text('channel'),
    requestType: text('request_type'),
    // DSAR_IDENTITY_VERIFIED: método de verificação (texto livre do operador).
    verificationMethod: text('verification_method'),
    // DSAR_FULFILLED: SHA-256 (hex) do payload canônico. NUNCA o nome em claro (ver docstring).
    payloadHash: text('payload_hash'),
    // DSAR_REJECTED: motivo da recusa.
    reason: text('reason'),
    // Metadados estruturados NÃO-sensíveis (ids internos, contagens). NUNCA dado pessoal do titular.
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Correlação por ticket (fluxo do operador) — só quando caseId presente.
    index('dsar_audit_event_case_idx').on(t.caseId, t.createdAt),
    // Varredura cronológica por tipo (auditoria/relatório de conformidade).
    index('dsar_audit_event_type_created_idx').on(t.eventType, t.createdAt),
    // Rede de banco do invariante central: todo DSAR_FULFILLED carrega um hash (nunca fica sem prova).
    check(
      'dsar_fulfilled_hash_chk',
      sql`${t.eventType} <> 'DSAR_FULFILLED' or ${t.payloadHash} is not null`,
    ),
  ],
)

/**
 * Tickets do formulário PÚBLICO de intake (issue #399, GAP-2; `docs/legal/takedown-e-remocao-titular.md`
 * §2). Cada envio do titular (autor externo sem conta — titular B) abre UM ticket com a `received_at` que
 * MARCA o início do SLA de 15 dias (Art. 19, II). A gravação do ticket emite `DSAR_RECEIVED` na MESMA
 * transação (`createTakedownTicket` em `src/server/legal/takedown-intake.ts`) — o `dsar_audit_event.case_id`
 * aponta de volta para o `id` deste ticket.
 *
 * MINIMIZAÇÃO (Art. 6º, III): guarda só o necessário para localizar o conteúdo e entender o pedido —
 * `source_url` e/ou `display_name` (ao menos um; validado no domínio) + `message`. `contact_email` é
 * OPCIONAL (retorno ao titular; nunca condição). NENHUM documento é exigido. Sem `updated_at`: o `status`
 * evolui pelo fluxo do operador (fora desta fatia), mas a fatia mínima só INSERE (recebimento).
 */
export const takedownTicket = pgTable(
  'takedown_ticket',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tipo do pedido (name_removal | full_removal | other). Texto (espelha dsar_audit_event.request_type);
    // o domínio (`normalizeTakedownIntake`) garante um valor conhecido antes do INSERT.
    requestType: text('request_type').notNull(),
    // Identificação do conteúdo: URL de origem E/OU nome exibido. Ao menos um é não-nulo (regra de domínio).
    sourceUrl: text('source_url'),
    displayName: text('display_name'),
    // O pedido em texto livre (obrigatório). Saneado (strip C0) na borda — anti-500.
    message: text('message').notNull(),
    // Contato OPCIONAL para resposta (não é condição de atendimento — Art. 6º, III). Nullable.
    contactEmail: text('contact_email'),
    // Locale em que o formulário foi enviado (metadado; ajuda a responder no idioma do titular).
    locale: text('locale'),
    // Status do ciclo de vida do ticket. Nasce 'received'; a evolução (verified/fulfilled/rejected) é do
    // fluxo do operador (GAP-4/GAP-7). Base para a varredura de SLA sobre tickets abertos.
    status: text('status').notNull().default('received'),
    // Data de RECEBIMENTO = início do SLA de 15 dias. Um ticket nasce recebido (defaultNow).
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    // GAP-7 (#400): nível de alerta de SLA já REGISTRADO para o ticket (none|yellow|red|overdue). A
    // varredura diária (`scanDsarSla`) só AVANÇA este valor conforme a idade cruza 10/13/15 dias —
    // registrar o nível AQUI (em vez de emitir e-mail: não há mailer/canal, human-gated) é o "alerta"
    // queryável e IDEMPOTENTE (não re-alerta o mesmo nível 2x). Nasce 'none'.
    slaLevel: text('sla_level').notNull().default('none'),
    // Quando a última transição de `sla_level` foi registrada (metadado do alerta). Nulo até o 1º alerta.
    slaAlertedAt: timestamp('sla_alerted_at', { withTimezone: true }),
  },
  (t) => [
    // Varredura do SLA: tickets por status em ordem de recebimento (o job de alertas 10/13/15 — GAP-7).
    index('takedown_ticket_status_received_idx').on(t.status, t.receivedAt),
  ],
)
