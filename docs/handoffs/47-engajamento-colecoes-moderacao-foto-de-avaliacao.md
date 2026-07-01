# Handoff 47 — Engajamento (2ª leva): Coleções, Moderação de avaliação, Foto da avaliação

> Continuação direta do **Handoff das 4 raízes** (ADR-0027 engajamento + ADR-0028 notificações), cujas issues #362/#363/#371/#372 estão **feitas, mergeadas e em produção** (main `4fec98b`, 2026-07-01). Esta fase pega as **próximas 3 fatias** do épico de engajamento (#360): **#364 Coleções**, **#365 Moderação de avaliação**, **#366 Foto da avaliação**. Todas já **destravadas** (dependem só de #362/#363, que estão prontas).

## Escopo desta fase

Três fatias independentes de valor, cada uma no fluxo de 8 passos do `CLAUDE.md`, **um PR por issue**:

- **#364 — Coleções** (sobre o Salvar do #362). Agrupar receitas salvas em coleções nomeadas, privadas e opcionais, estilo Instagram (M:N). Balde "Todos" = o conjunto de saves (não é linha de coleção). Depende de #362 (`recipe_save`). **Tem migração.**
- **#365 — Moderação de avaliação** (sobre a Avaliação do #363). Report→Curador para avaliações, reusando o caminho reativo que já modera receita/imagem. As **colunas de moderação já existem** em `recipe_review` (reservei em #363). Depende de #363. **Tem migração** (o `report` precisa passar a mirar uma avaliação).
- **#366 — Foto da avaliação** (sobre a Avaliação do #363). Upload de foto do prato cozinhado numa avaliação — **só upload/câmera, NUNCA IA**. A **coluna `photo_url` já existe** em `recipe_review` (reservei em #363). Depende de #363. **Provavelmente SEM migração** (a coluna existe; é caminho de upload + UI).

Fora de escopo aqui (fatias seguintes, já destravadas mas não desta leva): #367 aggregateRating-SEO, #368 popularidade-misturada, #369 aposentar-o-Voto, #373/#374 (notificações).

## O que ler primeiro (aterrado no código real)

1. **ADR-0027** (`docs/adr/0027-modelo-engajamento-avaliacao-salvar-colecoes-ranking.md`): decisão **2** (Salvar+Coleções), **3–4** (Avaliação + Foto), **7** (Moderação da avaliação).
2. **CONTEXT.md** verbetes: **Coleção**, **Salvar / Receita salva**, **Foto da avaliação**, **Avaliação**, **Moderação reativa** (o parágrafo já cobre avaliações), **Imagem da receita** (pra contrastar com a Foto da avaliação).
3. Código pronto que estas fatias estendem:
   - **#364**: `src/server/recipe/social.ts` (`applySave`/`applyUnsave`, gate `eligibleToSaveByViewer` em `src/domain/recipe-pool.ts`); a UI do Salvar em `src/components/recipe/recipe-engagement-controls.tsx`. `collection`/`collection_item` **não existem** — esta fatia cria.
   - **#365**: `src/server/recipe/moderation.ts` → **`applyImageModeration` é o espelho exato** pra `applyReviewModeration` (FOR UPDATE, preserva a 1ª moderação, resolve o report). A tabela `report` (schema.ts, ~linha 988) hoje tem `recipe_id NOT NULL`. A rota de Curador espelha `src/app/api/curate/reports/[id]/remove-image/route.ts`. A leitura de avaliações (`src/server/recipe/review.ts` `loadRecipeReviews`) **já filtra `moderated_at IS NULL`** — moderar só precisa do caminho de ESCRITA.
   - **#366**: `src/server/images/image-store.ts` — seam **`ImageStore.store({ bytes, contentType, pathPrefix })` → `{ url }`**, + `delete(url)`/`owns(url)`. O **padrão de upload é o avatar**: `src/app/api/me/avatar/route.ts`. A avaliação vive em `src/server/recipe/review.ts` + rotas `src/app/api/recipes/[id]/reviews/*` + UI `src/components/recipe/recipe-review-section.tsx`.

## Ordem e dependências (recomendado: serial, cada branch off origin/main pós-merge da anterior)

`#364` é **isolada** (área do Salvar/coleções). `#365` e `#366` **ambas mexem na área da Avaliação** (`review.ts`, `recipe-review-section.tsx`, rotas de review) → se paralelas, colidem. Além disso `#364` e `#365` **têm migração** → numeração Drizzle colide se geradas em paralelo (a próxima é `0039`).

**Recomendação:** rodar **serial** `#364 → #365 → #366`, cada worktree partindo do `origin/main` **já com a anterior mergeada** (foi o que funcionou nas 4 raízes — elimina 100% dos conflitos de `report`/`review.ts`/`recipe-review-section.tsx` e de numeração de migração). `#366` por último porque provavelmente não tem migração (menor risco). Se quiser paralelizar, `#364` pode andar sozinha, mas finalize a migração dela e a de `#365` em ordem.

## Princípios inegociáveis (por issue)

**#364 Coleções**
- `collection` `(id, user_id → users cascade, name, created_at)`, **UNIQUE(user_id, name)**. `collection_item` `(collection_id → collection cascade, recipe_id → recipe cascade, created_at)`, **PK composta**.
- **Privadas** (só o dono vê). **Opcionais** — salvar NÃO obriga escolher coleção. **M:N** (uma receita salva em 0+ coleções). Coleção vazia é válida.
- **O SAVE é a fonte de verdade do "salvo": apagar o save remove a receita de TODAS as coleções do usuário.** ⚠️ LANDMINE: a FK `collection_item.recipe_id → recipe` **não** faz isso sozinha (o save é `(user_id, recipe_id)`, não a receita). O `applyUnsave` (social.ts) precisa **também** deletar os `collection_item` daquele `recipe_id` nas coleções DAQUELE usuário. Teste isto explicitamente.
- Só se adiciona a coleção uma receita **já salva** (ou salvar+coleção juntos). Balde "Todos" = todos os saves do usuário (derivado, não linha).

**#365 Moderação de avaliação**
- **Reusa o caminho reativo** report→Curador (não inventa fluxo). A **unidade é a avaliação INTEIRA** (texto + foto juntos, quando a foto do #366 existir).
- **O DONO da receita NÃO remove** avaliação da própria receita — só o **Curador** (integridade da nota). O dono **reporta** como qualquer um. O autor **edita/apaga a própria**.
- `applyReviewModeration` espelha `applyImageModeration`: preserva a **1ª moderação** (re-moderar não sobrescreve), resolve o report. ⚠️ LANDMINE: o CHECK `recipe_review_moderation_consistency_chk` = `(moderated_at IS NULL) = (moderated_by IS NULL)` **exige setar `moderated_at` E `moderated_by` (e `moderated_reason`) JUNTOS** — setar só um estoura 23514 (foi o que pegou um teste em #363).
- Avaliação moderada **sai do público, do agregado e do ranking** — `loadRecipeReviews` já filtra `moderated_at IS NULL`; **confirme** que o agregado (média/contagem) e qualquer futuro ranking também filtram. Fila do Curador **leak-safe** (pode mostrar avaliação moderada sem vazar pra público).

**#366 Foto da avaliação**
- **Só upload/câmera, NUNCA IA.** `<input type="file" accept="image/*" capture>` no celular abre a câmera. **Sem eixo de proveniência, sem selo** (é sempre foto do usuário).
- **É do avaliador, não do dono.** ⚠️ NUNCA vira `recipe.image_id`, NUNCA entra na Galeria/linhagem, NUNCA vira `recipe_image`. Reusa **só o cano de blob** (`ImageStore.store({ pathPrefix: 'reviews' })`), exatamente como o avatar. Guarda a URL em `recipe_review.photo_url` (coluna **já existe**).
- Validação igual avatar: **2 MB**, `image/jpeg|png|webp`. **1 foto por avaliação** no v1. Apagar a avaliação deve apagar o blob (`ImageStore.delete`, no-op se não é nosso). A rota `POST /api/recipes/[id]/reviews` vira **multipart** quando há foto.

## Critério de saída (cada issue)

Migração (se houver) **gerada e inspecionada** no `.sql`; `npm run typecheck` + `npm run lint` verdes; testes provando cada AC (domínio puro exaustivo + integração jsdom+DB + UI); **code-review multi-lente adversarial** sem achado aberto; CI verde; squash-merge; **deploy de PROD confirmado**; issue auto-fechada por `Closes #N`.

## Gotchas de ambiente (herdados + o novo)

- **Worktree por issue off `origin/main`** (hardlink-copie `node_modules` com `cp -al`; symlink `.env.local`; NUNCA um symlink de `node_modules` — quebra o Turbopack/build). Sempre `cd` no worktree pra TODO comando git/npm. Confira `git worktree list` antes (pode haver outro agente).
- **`db:generate` roda DENTRO do worktree** (cwd) senão lê o schema errado e diz "no changes". **Sempre abra o `.sql` gerado** (histórico de DDL fantasma do Drizzle). **NUNCA `db:migrate` local** — migrate-on-deploy (`vercel.json` roda `db:migrate && build`). Próxima migração = **`0039`**.
- **Testes:** projeto `node` (DB Neon descartável, lento, flaka sob concorrência — rode FOCADO + confie na CI) e `ui` (jsdom, sem DB). Use o endpoint **direto** (sem `-pooler`).
- **Merge:** CI ~6min. `gh pr merge --squash --delete-branch` — o delete do branch LOCAL falha (o worktree segura o branch), mas o **merge remoto acontece**; confirme `gh pr view --json state` = MERGED e limpe worktree/branch à mão. **`Closes #N`** em inglês (PT "Fecha" não auto-fecha).
- **⚠️ Gotcha de ORQUESTRAÇÃO (custou ~900k tokens nesta fase):** se usar a ferramenta **Workflow**, **crave a config no próprio `.mjs`** (`const B = {...}` literal no topo) — o global **`args` chegou `undefined`** via `Workflow({scriptPath, args})`, e cada subagente de contexto fresco, sem assignment, **adivinhou o alvo e se espalhou por issues erradas**. Diagnóstico: `grep -o 'Worktree[^\\]*' <transcript>/agent-*.jsonl` — se aparecer ": undefined", o `args` não chegou.
- **Deploy:** o **preview Vercel do PR flaka** (branch Neon do preview) mesmo com o GitHub Actions verde — **gateie o merge no check "checks"** (GitHub Actions, autoritativo: typecheck+lint+build+suíte), NÃO no preview; e **confirme o deploy de PROD pós-merge** (o preview falhar não bloqueia; foi o caso do #363/PR#375).

## Reuso pronto (não reinvente)

- Regra `decide*` pura: `src/domain/vote.ts` / `src/domain/review.ts`. Núcleos `apply*/load*` com discriminated union + gate leak-safe: `src/server/recipe/social.ts`, `review.ts`, `moderation.ts`. Rota fina: `src/app/api/recipes/[id]/*`. i18n: `src/i18n/messages/{pt-BR,en-US}.ts` (SEMPRE os dois locais em sincronia — o tipo `Messages` reprova desalinho no typecheck).
- **#364**: espelhe o par `applyFavorite→applySave` pra os `applyCollection*`; a UI de escolha de coleção pendura no `recipe-engagement-controls.tsx`.
- **#365**: `applyImageModeration` (moderation.ts) + a rota `curate/reports/[id]/remove-image` são o molde 1:1.
- **#366**: `api/me/avatar/route.ts` é o molde de upload; `ImageStore` com `pathPrefix:'reviews'`.
