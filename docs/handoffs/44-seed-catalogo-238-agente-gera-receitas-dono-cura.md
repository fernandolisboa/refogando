# Handoff 44 — #238 Seed do catálogo: o AGENTE gera ~220 receitas; o dono CURA depois

## TL;DR / Escopo

Semear o **catálogo** (`origin=catalog`) com **~220 receitas geradas por IA** — a peça final do épico SEO/Descoberta (ADR-0020: "seed AI-curado, nunca copiar da web"). **REFRAME do dono (muda o #238):** ele **NÃO quer mais ser HITL na CRIAÇÃO**. O **agente/LLM (Claude — eu + subagentes num Workflow) GERA as ~220 receitas em batches paralelos e grava no banco**; o dono é HITL **só na CURADORIA depois** — entra todo dia e cura algumas (aprovar/editar/rejeitar). Ou seja: a IA cria o rascunho do catálogo; a pessoa refina aos poucos.

Seguir o **fluxo de sempre, paralelizado (8 passos)**. Mas **antes** há uma decisão de domínio que precisa de `/grill-with-docs` (ver "Decisão central" abaixo) porque ela CONGELA schema.

## ⚠️ DECISÃO CENTRAL (grill + ADR ANTES de codar) — o estado de "pendente de curadoria"

Hoje o modelo assume que receita de catálogo **já nasce curada** (`createCatalogRecipe` insere e pronto). Mas no fluxo novo as 220 entram **CRUAS** e precisam ficar **ESCONDIDAS até o dono curar**. O problema concreto:

- `createCatalogRecipe` insere `origin=catalog`, `visibility=private`, **`owner_id=NULL`** (`src/server/curate/create.ts:45-99`).
- `eligibleForPublicRead` (`src/domain/recipe-detail-route.ts:132-140`) é **true** quando `owner_id IS NULL OR public`, e `resultKind!='playful'` e `moderation_removed_at IS NULL`. ⇒ **uma receita de catálogo owner-null fica PÚBLICA/indexável NO INSTANTE em que é inserida**, antes de qualquer curadoria. O mesmo vale pro pool do feed (`eligibleForPool`, `src/domain/recipe-pool.ts:22-35`).
- **NÃO existe coluna de "review_required"/"curado" no nível da RECEITA** — só no nível da IMAGEM (`recipe_image.review_required`, `schema.ts:311-341`, dos #226/#227). A fila do Curador hoje é de imagens, não de receitas.

**Então #238 precisa de um estado de retenção pra receita.** Opções a grelhar (é fork de schema → decidir com o dono + ADR):
- **(A)** Nova coluna no `recipe` (ex.: `curated_at timestamptz NULL` ou `review_status`) + **gatear `eligibleForPublicRead`/`eligibleForPool`** pra exigir curado; + **fila do Curador pra RECEITAS** (estende a de imagens, #226/#227, ADR-0007). Limpo, mas é migração + toca o caminho quente de elegibilidade (cuidado pra não esconder receitas de catálogo JÁ existentes — backfill `curated_at=now()` nas atuais).
- **(B)** Reusar um estado existente (ex.: inserir como `resultKind='playful'` ou `moderation_removed_at=now()` como "tombstone de pendência") — SEM migração, mas **semanticamente errado** (playful = resultado lúdico; moderation = removido por moderação) e polui as métricas/telas de moderação. Provavelmente rejeitar.
- **(C)** Inserir num **owner técnico** (um user "curadoria") com `visibility=private` → não-elegível (não é owner-null nem público) até a curadoria flipar pra catálogo. Evita migração de schema mas inventa um owner sintético (atrito com ADR-0011 "catálogo é owner-null").

→ **Recomendado: (A)** (alinha com o épico Curador #226/#227 e dá uma fila de curadoria de receitas que o dono vai usar todo dia). Mas é o dono quem decide — **`/grill-with-docs` primeiro**, depois ADR + migração.

## O que a geração precisa produzir (forma do `createCatalogRecipe`)

Insira via **`createCatalogRecipe(db, input)`** (`src/server/curate/create.ts:45-99`) — NÃO via `persistGeneration` (este **rejeita** `origin=catalog`: `PersistOrigin` exclui catalog, `src/server/generation/persist.ts:44`). Shape do `input` (campos do `recipe` + `recipeTranslation` + `recipeIngredient`):

- `originalLocale` ('pt-BR' ou 'en-US'), `titulo`, `descricao`, `passos: string[]`, `notas`.
- `cozinha` — **slug de `vocabulary_term` ATIVO** (kind='cozinha'); o seed da migração 0033 tem **15 cozinhas ativas** (`americana` incluída pós-épico #313). Validar contra os ativos (`src/domain/vocabulary.ts` + o leitor data-driven, ADR-0025) — receita não pode referenciar cozinha inativa.
- `categoria` (enum `CATEGORIAS`), `restricoes` (enum array, default `{}`), `porcoes`, `dificuldade`, tempos (`tempoAtivoMin ≤ tempoTotalMin`, constraint `schema.ts:241`).
- `ingredientes[]`: `{ rawText, quantidade (string|null — numeric(10,3) trafega como STRING), unidade (enum|null) }`. `ingredientId` nasce NULL (resolução deferida).
- O `createCatalogRecipe` já: congela `slug` por locale (`slugForNewTranslation`, `src/server/recipe/slug.ts`, #229), põe `provenance='escrita_por_pessoa'` (confiável), `visibility='private'`, `owner_id=NULL`, `lineage_id` default fresh.

**Quem gera:** EU (Claude) + subagentes num **Workflow**, em **batches paralelos** — cada subagente produz N specs estruturados (JSON no shape acima) pra um conjunto de pratos/cozinhas; um **seed script** (tsx) insere via `createCatalogRecipe`. Não precisa chamar o Gemini de texto (o LLM que gera SOU eu). **Bilíngue:** como eu gero, dá pra **gerar pt-BR + en-US direto** (2 `recipeTranslation` por receita) e pular a auto-tradução (que está DEFERIDA, ADR-0014 — hoje só o `originalLocale` é populado). Decidir no plano: bilíngue-na-geração (recomendado, evita o backfill de tradução) vs só-pt-BR-agora.

**Distribuição:** ~220 / 15 cozinhas ≈ ~15 por cozinha; cobrir as `CATEGORIAS` e variar `restricoes`. Sem duplicar pratos. (Detalhe do plano.)

## Dados derivados pós-insert (pra aparecer em busca + feed)

- **Embeddings (#119, ADR-0008):** `embedTranslation(db, recipeId, locale)` (`src/server/embedding/recompute.ts:30-56`) — backfill por receita/locale APÓS inserir. **Precisa da Gemini key** (mesma key de imagem). Sem embedding a busca **textual** funciona, mas a **semântica** não casa. Rodar como script (template abaixo).
- **Slug (#229):** já congelado no `createCatalogRecipe` — sem backfill.
- **Tradução 2º locale (#187/ADR-0014):** auto-tradução NÃO existe; ou gerar bilíngue na geração (recomendado) ou deixar só-pt-BR e popular en-US depois (curadoria/admin).
- **Vocabulário:** só slugs de cozinha **ativos** (migração 0033).

## Imagens — DEFERIDAS (budget). Estimativa de custo

**NÃO gerar imagem pra cada receita agora.** Modelo `gemini-3.1-flash-image` (Nano Banana 2); snapshot de preço em `src/domain/image-cost.ts:44-50` (output **$60/1M tokens**; âncora ADR-0017 = ~1290 tokens/imagem ⇒ **~$0.077/imagem**, testado em `test/unit/image-cost.test.ts:25`).

- **220 imagens ≈ $17 USD** (só output; ~$17–22 com prompt/thinking). A ~R$5,5–6,0/USD ⇒ **~R$95–105** (FX aproximado, sem cotação ao vivo). **Custo único, modesto** — não é estouro, mas:
- **Recomendado:** gerar imagem **só na/após a curadoria** (por receita APROVADA), não nas 220 cruas — espalha o gasto, não desperdiça imagem em rascunho rejeitado, e reusa o pipeline existente (`/api/recipes/[id]/image/generate`, `src/server/images/image-generator.ts`; custo grava no ledger `image_generation`, #224). A UI já trata receita SEM imagem (placeholder paisagem — visto no #5/PR#340). Os tetos diários (#167, `src/domain/image-quota.ts`) são da UI por-usuário; um script os ignora, mas confirmar a Gemini key/billing ([[gemini-live-gates-and-billing]]).

## Fluxo (8 passos, paralelizado) — adaptado ao #238

1. **Explorar** (já adiantado neste handoff; aprofundar o estado-de-curadoria + a fila do Curador #226/#227).
2. **Plano** aterrado: a decisão (A/B/C) do estado pendente, o shape da geração, bilíngue-ou-não, a distribuição por cozinha, o seed script, o backfill de embeddings, e a curadoria.
   - **ANTES do plano: `/grill-with-docs`** pra fechar o estado-de-pendência (fork de schema) + ADR.
3. **Plan-review** multi-lente adversarial (Workflow): domínio/ADR (elegibilidade, owner-null, immutabilidade do origin ADR-0002), qualidade-das-receitas, schema/migração, custo/budget, cobertura de teste.
4. **Ajustes do plano.**
5. **Implementar** (worktree): migração (se A) → seed script → **Workflow que gera as ~220 em batches paralelos** (subagentes produzem specs; o script insere via `createCatalogRecipe`) → backfill de embeddings → fila/UI do Curador pra receitas (se não existir). TDD onde fizer sentido (a geração de dados é menos test-first; testar o seed/elegibilidade/curadoria).
6. **Code-review** multi-lente + verificação adversarial.
7. **Ajustes.**
8. **Validar** (ui focado + CI) → mergear. **Depois:** rodar o seed + o backfill **contra a Neon real** (script, NÃO migração — geração de dados não é migração) → **avisar o dono** que as 220 estão no banco prontas pra curar.

## Landmines / gotchas

- **Receita de catálogo fica PÚBLICA no insert** (owner-null) — resolver o estado-de-pendência ANTES de inserir 220, senão elas vão ao ar cruas. (A decisão central.)
- **`persistGeneration` REJEITA `origin=catalog`** — usar `createCatalogRecipe`.
- **Scripts contra a Neon:** `tsx --env-file=.env.local` com a conn **UNPOOLED** (`DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING`) — template `scripts/backfill-recipe-slugs.ts`. **Seed/backfill de DADOS roda como SCRIPT, nunca como migração** (migração é schema; aplica on-deploy). `.env.local` = a DB de prod ([[dev-db-not-migrated-real-app-validation-boundary]]).
- **`origin` é IMUTÁVEL** (trigger DB, ADR-0002) — inserir já como `catalog`.
- **`quantidade` é numeric(10,3) ⇒ STRING** no Drizzle (nunca number).
- **Suíte node completa flaka na Neon** (db descartável) — rodar focado + confiar na CI ([[imagens-perfil-admin-initiative]] gotcha).
- **Worktree isolado** + node_modules hardlink ([[use-worktree-isolation-parallel-sessions]]); editar paths ABSOLUTOS do worktree.
- **Merge:** `gh pr merge --squash --delete-branch` falha no git local (worktree segura a branch) mas o merge REMOTO acontece — confirmar `gh pr view --json state`=MERGED + deletar branch remota à mão; ff local de `main` pode abortar por untracked colidindo (limpar antes); CI ~6min ([[search-quality-qa-2026-06-27]] gotchas de merge).

## Onde ler primeiro (real, file:line)

- `src/server/curate/create.ts:45-99` — **`createCatalogRecipe`** (o insert do catálogo).
- `src/server/generation/persist.ts:44,180-359` — `persistGeneration` (rejeita catalog; referência do shape de translation/ingredient).
- `src/domain/recipe-detail-route.ts:132-140` + `src/domain/recipe-pool.ts:22-35` — **elegibilidade** (o gate a mudar).
- `src/db/schema.ts:140-261` (recipe), `:381-427` (recipeTranslation), `:429-475` (recipeIngredient), `:499-522` (recipeEmbedding), `:311-341/:362-379` (recipe_image/image_generation).
- `src/server/embedding/recompute.ts:30-56` — `embedTranslation` (backfill).
- `src/server/recipe/slug.ts` — slug; `src/domain/recipe-gen-schema.ts` — shape de geração; `src/domain/vocabulary.ts` — enums; migração `0033` — seed das 15 cozinhas.
- `src/domain/image-cost.ts` + `image-gen-config.ts` — modelo/custo de imagem.
- ADRs: 0020 (SEO/seed AI-curado), 0019 (descoberta/catálogo raso), 0007 (Curador), 0011 (catálogo owner-null), 0002 (origin imutável), 0008 (embeddings), 0014 (tradução deferida), 0017 (modelo de imagem), 0022/#224 (custo de imagem), 0025 (vocabulário data-driven).
- Memória: [[seo-bilingual-discovery-initiative]], [[vocabulary-data-driven-adr-0025]], [[image-studio-initiative]], [[gemini-live-gates-and-billing]].

## Critério de saída

~220 receitas de catálogo (bilíngue se decidido) **no banco**, em estado **pendente de curadoria** (NÃO públicas até curar), com embeddings, slugs e cozinha válida; uma **fila/UI de curadoria de receitas** pro dono aprovar/editar/rejeitar algumas por dia; imagens DEFERIDAS (geradas por receita aprovada, depois). Testes verdes, ADR do estado-de-pendência escrito, seed + backfill rodados na Neon, **dono avisado**.

## Suggested skills (próxima sessão)

- **`grill-with-docs`** — PRIMEIRO: fechar o estado "pendente de curadoria" (fork de schema) + sharpen vocabulário/ADR.
- **`to-issues`** (talvez) — se o dono quiser fatiar (migração + seed + curadoria-UI + backfill) em issues GH.
- **`tdd`** — pro seed/elegibilidade/curadoria (a parte testável).
- **Workflow** (multi-agente) — a GERAÇÃO das ~220 em batches paralelos + os reviews adversariais (plan-review, code-review), como nas sessões #5/#313/#279.
- **`handoff`** — ao fim.

---

## Prompt de kickoff (copiar e colar numa sessão nova)

Vou semear o catálogo do Refogando (#238) com ~220 receitas geradas por IA — a peça final do épico de SEO/Descoberta. MUDANÇA IMPORTANTE em relação ao plano antigo (que me punha como HITL na criação): eu NÃO quero criar as receitas à mão. Quero que VOCÊ (o agente/LLM + subagentes, num Workflow) GERE as ~220 receitas em batches paralelos e grave no banco; eu vou ser HITL só na CURADORIA depois — entro todo dia e curo algumas (aprovar/editar/rejeitar). Ou seja: a IA cria o rascunho do catálogo; eu refino aos poucos. Quero o fluxo de sempre, COMPLETO e paralelizado (8 passos: explorar → plano → plan-review multi-lente adversarial → ajustes → implementar via TDD em worktree → code-review multi-lente adversarial → ajustes → validar+mergear), com a geração das receitas em batches paralelos pelo próprio modelo. As imagens ficam DEFERIDAS por causa de budget (~$17/~R$100 pelas 220) — gerar imagem só por receita aprovada na curadoria, depois. Leia primeiro o handoff auto-suficiente em docs/handoffs/44-seed-catalogo-238-agente-gera-receitas-dono-cura.md, que aterra tudo no código real (createCatalogRecipe, elegibilidade owner-null, embeddings, vocabulário, scripts contra a Neon) e aponta a DECISÃO CENTRAL que precisa de /grill-with-docs ANTES de codar: hoje uma receita de catálogo fica pública no instante do insert (owner-null → eligibleForPublicRead), então as 220 precisam de um estado de "pendente de curadoria" pra não irem ao ar cruas — é fork de schema, então grelhe a decisão (nova coluna + fila do Curador pra receitas vs reusar estado existente) e escreva o ADR antes de implementar. Comece pelo /grill-with-docs dessa decisão.
