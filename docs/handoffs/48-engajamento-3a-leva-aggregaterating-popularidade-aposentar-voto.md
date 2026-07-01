# Handoff 48 — Engajamento (3ª leva): aggregateRating-SEO, Popularidade misturada, Aposentar o Voto

> Continuação direta do **Handoff 47** (`docs/handoffs/47-engajamento-colecoes-moderacao-foto-de-avaliacao.md`). A **2ª leva** está **FEITA, mergeada e em produção** (main `c5a7e37`, 2026-07-01): **#364 Coleções** (PR#383, migr 0039), **#366 Moderação de avaliação** (PR#384, migr 0040), **#365 Foto da avaliação** (PR#385, sem migração). Esta fase pega as **3 fatias de engajamento restantes** do épico **#360** + as **2 de notificação** do épico **#361/ADR-0028**.

## O que foi entregue na 2ª leva (não re-fazer — ler os PRs/diffs)
- **#364 Coleções** (PR#383): tabelas `collection`/`collection_item` (M:N privada), `src/server/recipe/collections.ts`, `applyUnsave` limpa `collection_item` em transação, `/me/saved` + picker no detalhe. **Read-path dos salvos re-aplica o gate `viewerReadableSqlFragment`** (não vaza receita de 3º que virou privada/removida).
- **#366 Moderação de avaliação** (PR#384): `report` polimórfico (`review_id` nullable + CHECK XOR), `applyReviewModeration` (espelha `applyImageModeration`), `applyReview` DELETE ganhou `isNull(moderatedAt)` (moderação durável contra delete-and-repost), fila do Curador virou união aditiva por `target`. `loadAggregate`/`loadRecipeReviews` **já filtram `moderated_at IS NULL`**.
- **#365 Foto da avaliação** (PR#385): multipart, `ImageStore` `pathPrefix:'reviews'`, **strip de EXIF/GPS server-side via `sharp` com clamp anti-DoS** (`limitInputPixels:24M` + `resize(2048,fit:inside)`), foto no card do Curador. `sharp@0.34.5` virou dep direta.

Fundação congelada: **ADR-0027** (`docs/adr/0027-modelo-engajamento-avaliacao-salvar-colecoes-ranking.md`) + **PRD #360**. Notificações: **ADR-0028** + **PRD #361**.

## Escopo desta fase (5 issues, ready-for-agent)

| Issue | O que | Migração | Ordem |
|---|---|---|---|
| **#367** aggregateRating-SEO | JSON-LD emite `aggregateRating` (reverte ADR-0020 dec.7) | não | **1ª** (isolada, pode ir já) |
| **#368** Popularidade misturada | `popularityScore` puro + wiring no ranking | provável não (constantes em `app_config`) | **2ª** (destrava #369) |
| **#369** Aposentar o Voto | DROP `recipe_vote` + tira like/voto da UI/API | **sim (0041)** | **3ª (só APÓS #368)** |
| **#373** Notificações N2 | eventos de curadoria/moderação | ? (ADR-0028) | independente |
| **#374** Notificações N3 | eventos de avaliação (ponte c/ engajamento) | ? | depois de #363/#366 (feitos) |

Ler os corpos: `gh issue view 367|368|369|373|374`. **Ordem crítica: #368 ANTES de #369** (o Voto só sai quando a Popularidade cobre a descoberta). #367 é independente e pode andar em paralelo. Serializar quem tem migração/toca `search.ts` (só #369 tem migração; #368 e #369 tocam `search.ts`+`recommended-cooks` → serializar #368→#369).

## O que ler primeiro (aterrado no código real)

- **#367**: `src/domain/recipe-seo.ts` (o JSON-LD; remover o comentário "Voto ≠ nota"); `src/server/recipe/review.ts` `loadAggregate` (91-110) já dá **média CRUA `avg(rating)::float8` + `count(*)::int` filtrando `moderated_at IS NULL`** — reusar; o gate de índice atual (mesmo de hoje). **Nunca** o Bayesiano no markup. Testes: `recipe-seo` puro (emite ≥1 review não-moderada+indexável; omite 0/noindex; comunidade E catálogo).
- **#368**: criar `src/domain/popularity.ts` (`popularityScore` PURO). Constantes tunáveis espelham **`src/server/**/image-gen-config.ts`** (fonte única em `app_config`, sem deploy). Wiring: `src/server/recipe/search.ts` (sort "popularidade", SQL CRU) e `src/server/user/recommended-cooks.ts` (hoje usam `vote_count`/`apreço = votos+favoritos`) → **substituir por `popularityScore`** (saves + nota Bayesiana + frescor), self-apreciação já excluída (`user_id <> owner_id`). `C` = média global das notas, computada+cacheada. ⚠️ **LANDMINE: a leitura de review no ranking DEVE carregar `moderated_at IS NULL`** (herança do #366 — o seam de leitura filtra, mas uma query de ranking NOVA em `search.ts`/`recommended-cooks` precisa replicar o predicado; senão nota de review moderada infla o ranking). Testes EXAUSTIVOS do puro: **5★/1 NÃO supera 4,5★/200**; receita nova (0 sinal) senta na média global e sobe por recência (**nunca afunda**); self-save/self-nota excluídos.
- **#369**: `src/components/recipe/recipe-engagement-controls.tsx` (tirar like/`voteCount`), rotas `src/app/api/recipes/[id]/{vote,unvote}/route.ts` (remover), `src/domain/vote.ts` + `applyVote`/`countVotes` em `src/server/recipe/social.ts` (remover), tabela `recipe_vote` (schema.ts ~920 → **DROP, migração 0041**), `loadSocialState`/`ViewerSocialState` (tira `viewerVoted`/`voteCount`). **Grep limpo** de `recipe_vote`/`voteCount`/`decideVote` ao fim. Só entra **depois** que #368 tirou o voto de `search.ts`/`recommended-cooks`.
- **#373/#374**: base = **#371 notificações** (já em prod; `src/server/**/notification*`, `renderNotification` puro, emit best-effort dentro do escritor). #374 engancha o emit "nova avaliação na sua receita" DENTRO de `applyReview` (que é o único a chamar `decideReview` — passar por lá preserva a guarda de auto-avaliação). Ler ADR-0028 + PRD #361.

## Princípios inegociáveis
- **aggregateRating = média CRUA + contagem REAL** (nunca o score Bayesiano); só com ≥1 review **não-moderada** E indexável; comunidade E catálogo. Estrelas/contagem já visíveis na página (exigência do Google, entregue pela fatia de Avaliação).
- **Popularidade não vira autoridade** — não promove ao catálogo, não garante segurança; o ranking segue **dentro da seção** (não reordena o pool inteiro). Pesos/`m` tunáveis sem deploy; só a **forma + guarda-corpos** são fixos.
- **Voto só é removido quando a Popularidade cobre a descoberta** (#369 depois de #368).
- **Migração só GERADA** (`db:generate` DENTRO do worktree), `.sql` inspecionado, **NUNCA `db:migrate` local** (migrate-on-deploy). Próxima = **0041** (a do #369).

## Fluxo por issue (o que funcionou nesta sessão — reusar)
Fluxo de 8 passos do CLAUDE.md, **um PR por issue**, cada worktree off `origin/main` já com a anterior mergeada:
1. **explore** (subagente Explore, read-only) → mapa em `$CLAUDE_JOB_DIR/tmp/`.
2. **plano** (o orquestrador autora, aterrado no mapa) → arquivo.
3. **plan-review adversarial** = 3 lentes em paralelo (correção/dados, segurança/leak, ADR-spec/ACs) → sintetizar correções autoritativas no plano. **Pegou ship-blockers ANTES de codar** (vazamento de visibilidade #364, evasão delete-and-repost #366).
4. **implement TDD** (1 subagente fresco, no worktree) → gera migração + inspeciona `.sql`, testes focados, commit local.
5. **verificação** (main loop): typecheck+lint independentes; inspecionar o `.sql`.
6. **code-review** = Workflow de 5 lentes (correção/segurança/adr-spec/qualidade/testes) → **cada achado verificado adversarialmente** (cético tenta refutar; default REFUTED). **Pegou o MAJOR de OOM do sharp no #365.**
7. **fix** (1 subagente) aplica só os CONFIRMED.
8. **merge**: push → PR `Closes #N` → pollar SÓ o check **`checks`** (GitHub Actions) → squash-merge → confirmar `state=MERGED` + **Vercel `success`** (deploy PROD) → limpar worktree/branch à mão.

## Landmines / gotchas de ambiente (confirmados nesta sessão)
- **Worktree por issue off `origin/main`**: `git worktree add -b feat/N ... origin/main` → `cp -al node_modules` (hardlink) → `ln -s .env.local`. `db:generate` roda DENTRO do worktree (cwd) senão lê schema errado.
- **`gh pr merge --squash --delete-branch`**: o delete do branch LOCAL **falha** (`'main' is already used by worktree`) mas o **merge REMOTO acontece** — confirmar `gh pr view --json state = MERGED` e limpar `git worktree remove` + `git branch -D` à mão.
- **`Closes #N` em inglês** (PT "Fecha" não auto-fecha).
- **CI ~10-13min**. O check **`checks`** é a porta (typecheck+lint+build+suíte); o preview **Vercel do PR pode flakar** mas aqui passou. **Flake conhecido: `test/ui/discovery-home.test.tsx` "LIMPAR a busca"** (race de `act`, não-relacionado) — falhou 1× no #366 e passou no re-run (`gh run rerun <id> --failed`). Se `checks` falhar, cheque se é ESSE teste (não seu diff) antes de mexer no código.
- **Testes**: projeto `node` (DB Neon descartável, lento, flaka sob concorrência → rodar FOCADO + confiar na CI) e `ui` (jsdom, sem DB). Endpoint DIRETO (sem `-pooler`).
- **Deploy PROD**: `Vercel success` no commit de merge = migração aplicada no Neon de prod + build. Confirmar sempre pós-merge (`gh api repos/.../commits/<sha>/status`).
- **Novo dep nativo** (ex.: `sharp` no #365): já em node_modules (transitivo); adicionar em package.json **E** sincronizar `package-lock.json` (o `npm ci` do CI valida os dois) — validar com `npm ci --dry-run`.
- **Orquestração via Workflow**: CRAVAR config no `.mjs` (`const B = {...}` literal) — `Workflow({scriptPath, args})` NÃO entrega `args`.

## Critério de saída (por issue)
Migração (se houver) gerada + `.sql` inspecionado; `npm run typecheck` + `npm run lint` verdes; testes provando cada AC; code-review 5-lentes+verificação sem CONFIRMED aberto; check `checks` verde; squash-merge; **deploy PROD confirmado**; issue auto-fechada por `Closes #N`. Ao fim das 5: os épicos **#360** e **#361** ficam 100% dev-completos → fechar os trackers.

## Suggested skills
- **`/grill-with-docs`** — SÓ se #368 revelar que a fórmula/os guarda-corpos precisam de decisão nova (os números são calibragem reversível; a forma está no ADR-0027). Provavelmente dispensável.
- **`tdd`** — o coração de #367/#368 é função pura (`recipe-seo`, `popularityScore`) testável exaustivamente; red-green.
- **`review`** — code-review adversarial multi-lente por PR (o padrão que pegou os ship-blockers desta sessão).
- **`verify`** / **`run`** — validar #367 na superfície real (o JSON-LD renderizado; testar com o Rich Results Test do Google) e #369 (like sumiu do detalhe/lista).
