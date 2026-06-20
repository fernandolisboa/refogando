import { sql } from 'drizzle-orm'
import {
  pgTable,
  pgEnum,
  serial,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  vector,
  index,
  uniqueIndex,
  primaryKey,
  check,
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { COZINHAS, CATEGORIAS, RESTRICOES, UNIDADES } from '@/domain/vocabulary'
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
import { REPORT_STATUSES } from '@/domain/report'
import { TRANSCRIPT_ROLES } from '@/domain/transcript'

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
export const cozinhaEnum = pgEnum('cozinha', COZINHAS)
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
// Papel da fala na Transcrição durável (issue #15). Fonte única: TRANSCRIPT_ROLES de
// @/domain/transcript (user/assistant) — espelha roleEnum/strengthEnum importando do
// kernel. DB type 'transcript_role', DISTINTO de roleEnum (DB type 'role', papéis de
// Usuário): o TS id é `transcriptRoleEnum`, NUNCA `roleEnum` (já em uso ~linha 71).
export const transcriptRoleEnum = pgEnum('transcript_role', TRANSCRIPT_ROLES)

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
    cozinha: cozinhaEnum('cozinha'),
    categoria: categoriaEnum('categoria'),
    restricoes: restricaoEnum('restricoes').array().notNull().default(sql`'{}'`),
    porcoes: integer('porcoes'),
    dificuldade: integer('dificuldade'),
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
    // Quem subiu/gerou (#130). ON DELETE set null (espelha recipe.moderatedBy): apagar o usuário NÃO
    // apaga a imagem (a Receita que a referencia — possivelmente já no catálogo — sobrevive). NULLABLE.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
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
 */
export const imageGeneration = pgTable(
  'image_generation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    // Unicidade do handle no banco (#128): a borda gera/edita garantindo livre, mas a UNIQUE
    // é a última linha contra corrida (dois signups simultâneos com o mesmo slug → 23505).
    uniqueIndex('users_handle_uq').on(t.handle),
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

// ── Config de aplicação (#5.AC2 — modelo default) ──────────────────────────────
//
// Singleton: só pode existir a linha id=true (CHECK app_config_singleton_chk torna o
// singleton garantia de banco, não só convenção de PK). `default_model` é text livre
// (não enum): o conjunto válido é detalhe de runtime; o handler valida por allowlist.
export const appConfig = pgTable(
  'app_config',
  {
    id: boolean('id').primaryKey().default(true),
    defaultModel: text('default_model').notNull().default('claude-opus-4-8'),
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
  cozinha: cozinhaEnum('cozinha'),
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

// ── Social: Voto + Favorito (issue #16, ADR-0003) ──────────────────────────────
//
// Relações PURAS (sem payload): cada linha é "este Usuário votou/favoritou esta
// Receita". Estrutura IDÊNTICA entre as duas, espelhando recipeTag/recipeEmbedding:
//  - PK composta (user_id, recipe_id): satisfaz AC1 (votar 2× = UM voto — a re-inserção
//    colide na PK) E cobre o lookup leak-safe "este viewer votou?" (EXISTS por PK).
//    Desfazer = DELETE da linha (sem updatedAt/deletedAt — voto/favorito são descartáveis).
//  - FK ON DELETE cascade em AMBAS (sem órfãos): apagar Usuário ou Receita limpa os votos.
//    Despublicar é UPDATE de visibility, NUNCA DELETE ⇒ os votos PERSISTEM (AC5).
//  - índice btree em recipe_id: cobre COUNT(*) WHERE recipe_id=? (a Popularidade) e o
//    LEFT JOIN agregado na Busca da Comunidade.
//
// NÃO há CHECK de não-autovoto (owner_id mora em `recipe`, não aqui; um CHECK cross-table
// exigiria trigger). O não-autovoto é imposto no SERVIDOR (src/server/recipe/social.ts via
// src/domain/vote.ts) — `applyVote` é o ÚNICO escritor de recipe_vote e o único a chamar
// `decideVote`. Qualquer FUTURO escritor de voto DEVE chamar `decideVote` (risco residual
// documentado, sem rede de banco).
export const recipeVote = pgTable(
  'recipe_vote',
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
    index('recipe_vote_recipe_id_idx').on(t.recipeId),
  ],
)

export const recipeFavorite = pgTable(
  'recipe_favorite',
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
    index('recipe_favorite_recipe_id_idx').on(t.recipeId),
  ],
)

// ── Moderação reativa: Report (issue #18, ADR-0003/0011) ───────────────────────
//
// ENTRADA da moderação: qualquer Usuário autenticado reporta uma Receita do POOL; a linha
// entra na FILA do Curador (status='pending'). O Report mira a RECEITA (recipe_id, não o
// locale): a moderação tem identidade única entre pt-BR/en-US (AC4 — uma decisão afeta a
// Receita em TODOS os locales). Estrutura espelha recipeVote/recipeFavorite (FK cascade ao
// recipe/users), mas COM payload (reason/status/resolução) — não é relação pura.
//
// MÚLTIPLOS reports por Receita são permitidos (a fila agrega; a 1ª remoção preserva a
// proveniência — ver moderation.ts). Dedup por (recipe,reporter) é followup, não-AC.
export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
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
    // Fila do Curador: pending ordenada por data de criação.
    index('report_status_created_idx').on(t.status, t.createdAt),
  ],
)
