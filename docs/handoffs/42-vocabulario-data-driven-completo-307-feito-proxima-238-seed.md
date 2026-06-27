# Handoff 42 — Épico #313 (vocabulário data-driven) 100% + #307 modal de seguidores: ambos FEITOS. Próxima: #238 seed de catálogo (HITL)

**Fase:** Desenvolvimento AFK concluída. Os dois streams do handoff 41 estão **mergeados e fechados**.
**Data:** 2026-06-27. **Main:** `d07a45b`.

## O que foi entregue

### Stream 1 — Épico #313: vocabulário culinário data-driven (ADR-0025) — ✅ COMPLETO e FECHADO

`cozinha` saiu do `pgEnum` hard-coded e virou vocabulário **controlado data-driven** (tabela `vocabulary_term`), com o pedal **"Outra" → sugestão → fila do Curador** e CRUD de Admin. As 8 fatias, cada uma por pipeline AFK (worktree off `origin/main` → plano → plan-review multi-lente → TDD → diff-review 3-lentes+verify → fix → squash-merge no foreground com CI verde):

**Fatia A (migração mecânica, comportamento preservado):**
- **#314** (PR #323, migração **0033**) — tabela `vocabulary_term` (`kind`/`status` enums de código, `slug` text, `label_pt_br`/`label_en_us` NULLABLE, `sort`, timestamps; **`UNIQUE(slug)` CRU** = `unique()` real, não `uniqueIndex()`, p/ a FK do #318 referenciar) + seed de **15 cozinhas** (14 + `americana`). Fonte única: `src/domain/vocabulary-term.ts` (`COZINHA_SEED`). Seed = INSERT à mão acoplado na `.sql` gerada (drizzle não gera dados).
- **#315** (PR #324) — `loadVocabulary(db, kind, escopo)` (`active` | `display`=active+deprecated; `suggested` nunca) com cache TTL curto, **snapshot congelado** (`Object.freeze`) anti-envenenamento; validação de escrita NÃO usa o cache (lê DB-direto).
- **#316** (PR #327) — validação por injeção: `parseFacetParams`/`parseBriefing` recebem o conjunto-ativo (puros/sync); `loadActiveCozinhaSlugs` DB-direto; bordas de escrita enum-limitadas via `loadEnumStorableActiveCozinhas` (ponte temporária `active ∩ COZINHAS` até o flip).
- **#317** (PR #326) — rótulos vêm do reader: `CozinhaVocabProvider` (server→client, escopo active) + `pickCozinhaLabel` (fallback locale→locale→slug); `cozinhaLabel` removido dos 2 i18n; detalhe usa rótulo já resolvido no boundary (escopo display).
- **#318** (PR #328, migração **0034**) — **O FLIP** (escrito à mão, grep da `.sql`): `recipe.cozinha` e `briefing.cozinha` viram `text` + **FK → `vocabulary_term(slug)` ON DELETE RESTRICT**; `::cozinha[]`→`::text[]` em `search.ts`; **`DROP TYPE cozinha`** (tudo numa migração); `COZINHAS as const` removido, `type Cozinha = string`; `z.enum` de geração vira `buildRecipeGenSchema(activeSlugs)` (lista vazia → `z.string()`), threaded nos 3 call sites de `generateRecipe`. **`americana` agora LIVE end-to-end.**

**Fatia B (features, sem deploy):**
- **#319** (PR #330) — "Outra" na AUTORIA (briefing + edição, não na saída da IA): `suggestCozinha` (slug = `slugify∘foldIntent`, dedup vs active+deprecated+suggested, multi-owner). IA emite `null`; servidor estampa o slug `suggested` pós-geração. **Contenção total**: `suggested` ausente em faceta/display/JSON-LD `recipeCuisine`/OG (texto cru só pro dono no edit). Publish NÃO bloqueado.
- **#320** (PR #331) — fila do Curador (role `curador`, no console de moderação): aprovar (2 rótulos obrigatórios + correção de slug canônico opcional, repointa recipe+briefing FK-safe), mesclar (repointa todas as receitas anexadas → ativo, tombstone `merged`), rejeitar (recipe.cozinha→null, tombstone `rejected`). **Tombstone nunca DELETE**; `briefing.cozinha` imutável (ADR-0006) exceto na correção-de-slug; transacional + `FOR UPDATE` no termo só + anti-corrida `ja_resolvido`.
- **#321** (PR #329) — Admin CRUD (role `admin`, `/admin/vocabulario`): add (slug+2 rótulos→active), editar rótulos, depreciar (active→deprecated). **Guarda source-status** (admin não muta `suggested`/`merged`/`rejected` — não aprova UGC fora da fila). `culinary-profile.ts`: assertion slugs-citados⊆semeados + sem hard-delete de slug citado.

### Stream 2 — #307: modal de lista completa de seguidores/seguindo — ✅ FEITO e FECHADO

PR #325 (`ce512be`), sem migração. Contador do perfil abre **modal** com a lista COMPLETA paginada por **cursor lossless** (base64url de `created_at::text` full-precision — **não** `Date.toISOString` que trunca micros), keyset de ordem MISTA `desc(createdAt), asc(id)`. Rotas `/api/u/[handle]/{followers,following}` **COOKIE-FREE/anon/never-401**, cursor forjado validado (UUID-regex + `Date.parse`) anti-500. Gate soft-deleted (contador == lista). Reusa `Sheet`. Diff-review pegou 4 MED reais (load-more apagava a lista, double-click duplicava, cursor-500 na rota anon, sem loading).

## Landmines/gotchas DURÁVEIS que este dev pegou (evite re-aprender)

1. **CI vermelho foco-vs-suíte-inteira (custou 1 ciclo):** uma mudança de write-path que passa a validar contra o DB quebra testes de integração PRÉ-EXISTENTES que não re-semeiam. Concreto: #316 → 27 testes de geração caíram em 400 (set-ativo vazio após `truncateAll`). **Fix permanente:** `test/setup.ts` re-semeia o baseline de cozinhas no `beforeEach` global (espelha prod). **Sempre rode também os testes pré-existentes que tocam a rota/schema/assinatura mudada — não confie só no foco.**
2. **`americana` ativa-na-tabela-mas-não-no-pgEnum até #318:** entre #314 e #318 a coluna ainda é o enum de 14 valores; bindar `americana` no `::cozinha[]` daria 22P02/500. Por isso a ponte `loadEnumStorableActiveCozinhas` (deletada no #318). ⇒ **nos forks paralelos, mergear #316 ANTES de #317** (o estado solo de #316 não regride; o de #317-solo ofereceria `americana` rejeitada).
3. **Forks paralelos precisam de fences de arquivos disjuntos** no prompt (#316∥#317 em 2 worktrees; #319∥#321). Único overlap real = i18n (namespaces distintos → 3-way additivo limpo no rebase do 2º a mergear).
4. **Vazamento de slug `suggested`:** `resolveCozinhaLabel` (#317) cai no slug cru quando ausente do vocab → contenção (#319) gateia recipeCuisine/OG a `active` via Set injetado (builder SEO continua puro/sync, sem DB no render anônimo/cacheável).
5. **`suggestCozinha` INSERT só DEPOIS de todos os gates** (cap/validação/early-return) — senão cria termos órfãos no 400/429/502 E vira bypass do teto de geração.
6. **Orquestração:** o tool Workflow entrega `args` JSON-**stringificado** (faça `JSON.parse`); `db:generate` SEMPRE no cwd da worktree; testes node locais via `node --env-file=.env.local node_modules/vitest/vitest.mjs run <files> --project node` (sem Docker → usa Neon, endpoint direto via `DATABASE_URL_UNPOOLED`); `gh pr merge --delete-branch` falha no git local mas o merge remoto acontece; "Closes #N" em INGLÊS; CI ~6min, sem auto-merge.

## Próxima ação

**#238 — seed de catálogo (200 receitas + cânone)** é o que resta da fila de dev relevante, e foi **destravado** por esta entrega (a faceta `americana` agora existe e é semeável/filtravel). É **HITL/curadoria** (gerar via nosso-AI + curadoria humana, nunca copiar a web — ADR-0020), então **não é AFK puro**: precisa do dono/curador no loop. É o último filho aberto do épico SEO #187. Ver [[seo-bilingual-discovery-initiative]] e o relatório de dimensionamento (#311, `docs/...`).

Outros abertos (todos HITL/decisão do dono, fora de AFK): **#308** (Descobrir cozinheiros → busca dedicada de pessoas — `needs-info`, precisa grelhar), **#270** (escolha de logo entre as 15 direções), **#276** (advogado), **#180** (DesignSync remoto).

## Critério de saída (cumprido)

`pgEnum cozinha` e `COZINHAS as const` removidos; `cozinha` 100% data-driven com FK; usuário sugere via "Outra", Curador aprova/mescla/rejeita, Admin gere a taxonomia — tudo sem deploy; modal de seguidores com paginação por cursor; épico #313 e issues #314-#321/#307 fechados; CI verde em cada merge; migrações 0033/0034 aplicam on-deploy.
