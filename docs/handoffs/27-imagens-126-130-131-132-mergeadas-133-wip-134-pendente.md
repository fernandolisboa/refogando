# Handoff 27 — Imagens: #126/#130/#131/#132 mergeadas; #133 EM ANDAMENTO (branch WIP); falta #133 + #134

## Escopo
Iniciativa **Imagens de receita + Perfil + Split do Admin** (PRD #122). O **perfil** já estava completo (handoff 26). Esta sessão entregou **toda a parte de imagens até a geração por IA** e **começou a moderação**. Falta: terminar **#133** (moderar só a imagem — há uma branch WIP) e fazer **#134** (`/admin/ai`, torna os tetos configuráveis). `main` em `3555913`.

## Feito nesta sessão (tudo mergeado, verde, cada um com review adversarial multi-lente + CI isolada)
| PR | Issue | Entrega |
|----|-------|---------|
| #143 | #126 | Avatar + **fundação `ImageStore`** (seam Real/Fake/Throwing, Vercel Blob; `users.image`) |
| #144 | #130 | Entidade **`recipe_image`** ref-counted + FK `recipe.image_id` + upload de foto (rota `/api/recipes/[id]/image`); leitura `imageUrl` no detalhe/feed/busca |
| #145 | #131 | **Carry-forward** ao versionar (editar/derivar/regenerar herdam `image_id`) + classificador puro `src/domain/image-review.ts` + aviso "revisar a foto" |
| #147 | #132 | **Geração por IA** (seam `ImageGenerator`, Gemini `gemini-3.1-flash-image` REST sem SDK) + **teto 24h deslizante** (ledger `image_generation`) + selo "✨ gerada por IA" |

Follow-ups criados/registrados: **#146** (`deleteOwnRecipe` não roda ref-count → blob órfão no hard-delete); **presets de estilo** do #132 deferidos (refino é só prompt livre).

## #133 EM ANDAMENTO — branch `feat/133-image-moderation` (NÃO mergeada; commit WIP)
Já feito nessa branch (typecheck verde):
- **Schema/migração 0018:** colunas `moderated_at/_reason/_by` em `recipe_image` + CHECK de consistência (`(moderated_at IS NULL) = (moderated_by IS NULL)`) + índice parcial. Espelha as colunas de moderação de `recipe` (#18).
- **Núcleo** `applyImageModeration` em `src/server/recipe/moderation.ts` (espelha `applyModerationRemove`): seta `moderated_*` na `recipe_image` apontada pela receita do report; **preserva a 1ª moderação**; resolve o report; **NÃO derruba a receita do pool** (NÃO toca `recipe.moderation_*`). Discriminated union com `no_image` (422). Cuidado já resolvido: **`FOR UPDATE` NÃO pode no lado nulável de outer join** → o select do report usa `innerJoin recipe` + um select separado `FOR UPDATE` em `recipe_image`.
- **Rota** `POST /api/curate/reports/[id]/remove-image` (curador-only, motivo obrigatório; mapeia 200/400/404/409/422). Espelha `.../remove`.
- **Gate de pool da imagem** no feed (`feed.ts`) e busca (`search.ts` `displayTailSql`): `AND ri.moderated_at IS NULL` no LEFT JOIN de `recipe_image` → imagem moderada some do público.

**FALTA terminar #133 (nesta ordem):**
1. **Gate do DETALHE (owner vê, público não):** em `src/server/recipe/load.ts`, carregar `recipe_image.moderated_at` (junto de `blob_url`/`provenance`) → `LoadedRecipeRows.imageModerated`. Em `src/domain/recipe-read.ts`, `ResolveInput.imageModerated` + na projeção esconder `imageUrl`/`imageAiGenerated` quando `imageModerated && !canManage` (o Owner — `canManage` — ainda vê; público/não-dono não). Espelha o padrão `imageUrl`/`imageAiGenerated` já existente.
2. **UI da fila** `src/components/admin/moderation-queue.tsx`: dentro do disclosure de remoção (já tem textarea de motivo), adicionar um 2º botão de confirmação **"Remover só a imagem"** → `handleRemoveImage` (espelha `handleRemove`, POST `.../remove-image`, trata `sem_imagem`). i18n em `moderacao.*` (pt-BR + en-US): `removerImagem`, `removendoImagem`, `erroSemImagem`.
3. **Testes:** integração da rota (gating curador/anon/usuario; motivo obrigatório; modera a imagem + resolve report; receita CONTINUA no pool; `no_image` 422) + gate de pool (feed/busca sem a imagem moderada) + detalhe (Owner vê, anônimo/não-dono não). UI da fila (ação remover-imagem). Prior art: `test/integration/moderation.test.ts`, `test/integration/anon-contract.test.ts`, `test/ui/recipe-detail.test.tsx`.
4. **Review adversarial** (Workflow) → corrigir achados → **CI isolada verde** → squash-merge.

## Depois: #134 — `/admin/ai` (torna os tetos configuráveis)
- Estende `/api/admin/config` com `imageGen { enabled, model, dailyCapByRole }` (hoje a config é só `defaultModel` — singleton `app_config`; ver `src/app/api/admin/config/route.ts`). Seção `/admin/ai` (só admin) no layout do admin (`src/app/admin/*`, `src/components/admin/*`).
- **Liga a config à geração:** o #132 já deixou a porta aberta — `decideImageQuota` recebe `cap` por PARÂMETRO e `capForRole`/`DAILY_IMAGE_GEN_CAP_BY_ROLE` são os defaults FIXOS em `src/domain/image-quota.ts`; o `RealGeminiImageGenerator` aceita `model` em `GenerateImageInput`. #134 substitui os defaults pelos valores da config (e gate `enabled`). Guarda `cap<=0` já existe em `decideImageQuota`.

## Ler primeiro (referência — não duplico)
- **PRD/ADRs:** #122 + `docs/prd/imagens-perfil-admin.md`; `docs/adr/0016-imagem-da-receita-entidade.md`, `docs/adr/0017-contrato-geracao-imagem-ia.md`; `CONTEXT.md` (termos _Imagem da receita_, _Handle_).
- **Memória:** `imagens-perfil-admin-initiative.md` (grafo + decisões + gotchas desta sessão), `ci-merge-and-parallel-agent-gotchas.md`.
- **Código-âncora:** seams em `src/server/images/{image-store,image-generator}.ts`; núcleo `src/server/recipe/image.ts` (upload/geração/ref-count); `src/server/recipe/moderation.ts` (moderação); puros `src/domain/{image-quota,image-prompt,image-review}.ts`.

## Inegociáveis (ADR-0016/0017 + CONTEXT)
- Imagem é **entidade** `recipe_image` ref-counted (nunca coluna-URL). Carry-forward herda `image_id`. **Teto conta EVENTOS** (ledger `image_generation`), NÃO linhas `recipe_image` (são reapadas → devolveriam o slot). Moderação = **flag** na imagem (`moderated_at`), some do público em toda parte, Owner vê no privado; receita **continua no pool** (eixo ORTOGONAL a remover-do-pool #18). Geração: Gemini **REST sem SDK**, bytes→blob num passo, só Owner logado, selo "gerada por IA". Seams **Real/Fake/Throwing**; testes **nunca** tocam Vercel Blob nem Gemini. `image_id`/proveniência crua **nunca vazam** no DTO (só `imageUrl` + booleano `imageAiGenerated`).

## Landmines / gotchas (vividos nesta sessão — leia!)
- **`gh run watch --exit-status | tail` MASCARA o exit code** (vira o do `tail`, sempre 0). SEMPRE conferir o resultado real com `gh run view <id> --json conclusion` antes de mergear. (Quase mergeei um CI vermelho do #131 por causa disso.)
- **Backtick (`) dentro das strings do script de Workflow QUEBRA o parse** (termina o template literal). Nas reviews, montar os prompts com aspas simples ou `array.join('\n')`; nunca usar ` para identificar código dentro da string.
- **Editar campo TRADUZÍVEL dispara `applyEdit → embedTranslation → RealEmbedder` que LANÇA.** Qualquer teste de integração que edite título/descrição/passos/notas precisa `setEmbedder(new FakeEmbedder())` (o #131 pegou isso só na CI).
- **Teto de geração:** NUNCA contar linhas `recipe_image` (reapadas) — usar o ledger `image_generation`. O review do #132 pegou isso como HIGH (regenerar a mesma receita driblava o teto).
- **`FOR UPDATE` no lado nulável de outer join estoura no Postgres** — no #133 use innerJoin + select FOR UPDATE separado da tabela nulável.
- **Migração:** `npx drizzle-kit generate` (offline, sem DB). Inspecione o `.sql` e grepe `search_vector|hnsw|gin` (phantom DDL). 0016/0017/0018 saíram limpas.
- **Gate humano do Gemini:** `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` NÃO está no `.env.local` — geração ao vivo não funciona até alguém adicionar a key (como foi o Blob token do #126). Código/testes fecham verdes sem ela (FakeImageGenerator). NÃO bloqueia #133/#134.
- **Sem Docker local:** integração + unit rodam só na **CI** (Testcontainers). Local: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run --project ui`, `next build` (com `BETTER_AUTH_SECRET=dummy...`). Confiar na CI isolada pro resto.
- **Branch/merge:** sempre branch de `origin/main` (local desatualiza); commit só via branch+PR (classifier bloqueia main direto, handoffs incluídos); `gh pr merge <n> --squash --delete-branch` SÓ após CI verde; NUNCA `--auto` (mergeia na hora sem esperar CI).

## Critério de saída por fatia (AFK — sem human gate)
TDD/implementar → **review adversarial multi-lente por Workflow** → corrigir achados → gate local DB-free verde (typecheck/lint/ui/build) → **CI isolada verde** (confirmar via `gh run view --json conclusion`) → `gh pr merge --squash` → a issue fecha via "Closes #N".

## Skills sugeridas
Por issue, a sessão escolhe automaticamente: `tdd`, subagentes/Workflow de code-review, `verify`/`run` (útil pro avatar/imagem assim que a key do Gemini estiver ligada). `/handoff` ao fim da próxima leva.
