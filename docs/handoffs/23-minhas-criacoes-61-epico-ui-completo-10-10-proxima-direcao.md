# Handoff 23 — **Minhas criações** (#61 ← #17/#20/#21/#22) entregue · **épico de UI #53 COMPLETO (10/10) e FECHADO** · próxima fase: **sem fatia na fila → direção do usuário** (followups vs nova feature)

**Sessão anterior (continuação da 22):** entregou e mergeou a última fatia do épico #53 — **Minhas criações** — pelos 8 passos do `CLAUDE.md` (cada passo em subagente fresco; loop principal só orquestra/integra/green-gate-solo). **Esta sessão sofreu uma colisão de working dir com outra sessão paralela e migrou para isolamento por worktree** (ver Landmines — é o aprendizado mais importante daqui).

| Entrega | PR | O que (fonte de verdade: `gh pr diff <N>`) |
|---|---|---|
| **#17** Receita derivada + diff congelado | #99 | editar NÃO-própria forka `origin='user_edited'`, `parentRecipeId`, snapshot de tradução+ingredientes, `derived_diff` JSONB congelado (`{v:1,ingredientes,restricoes,campos}`). **Única migration do bloco: 0011** (`recipe.derived_diff`). recipe-read estendido (parentRecipeId/lineageKind/derivedDiff, owner-gated) |
| **#21** Edição in-place + apagar | #101 | editar a PRÓPRIA = UPDATE in-place (allowlist, nunca origin/owner/visibility); apagar = **HARD delete** (cascatas + SET NULL preservam derivadas de terceiros, historia 200); flip `vinculoPerdido` no recipe-read; `persistGeneration` self-defende posse |
| **#20** Regeneração (versão imutável) | #102 | nova linha `lineage_kind='regenerated'`, `parentRecipeId`=predecessora, **origin HERDADO** (ai_* only — `PersistOrigin`), nova generation na MESMA `creation_session`, prompt recuperado por modo (transcript/briefing/free_text), `embedTranslation` re-roda; origem não-recuperável → 409 `sem_fonte_para_regenerar`. `persistGeneration` ganhou param opcional `lineage` |
| **#22** Acesso anônimo (DESCOPADO) | #106 | **decisão do owner: geração anônima REMOVIDA** (protege quota do LLM). Anônimo = read-only; toda escrita/geração fail-closed (401). Cancelados efêmero/claim/persist-on-signup. **ADR-0011 atualizado** + teste de contrato (`anon-contract.test.ts`: leitura pública 200, escrita/geração 401 zero-linhas). NENHUM código de produto novo |
| **#61** UI Minhas criações | #107 | `/me/recipes` (lista own incl. private/playful/removida) + editar/apagar + derivar + regenerar + diff view + **gating anônimo** (convite a entrar/criar conta). `GET /api/me/recipes` owner-scoped. `/impeccable`. jsdom |

Estado final em `main`: **`0b0e013`**, full suite **938** (era 733 no início do épico). **Épico #53 FECHADO** (10/10; comentário de conclusão no #53). App navegável ponta-a-ponta: buscar → ver → criar (estruturado / prompt aberto / conversa) → salvar/publicar → minhas criações (editar/derivar/regenerar/apagar).

## ⚠️ Landmine #1 (o aprendizado desta sessão): ISOLAMENTO POR WORKTREE é obrigatório

**Múltiplas sessões/agentes rodam concorrentemente no MESMO working dir** (`/home/ferna/projects/refogando`). Esta sessão colidiu com a sessão de **browse #98/#100**: o commit de #17 caiu numa branch com o NOME da outra fatia (`feat/recipes-browse-all`) e o WIP de browse foi parar em `stash@{0}`. Recuperei (#17 estava íntegro em `…-v2` → PR #99) e migrei TODO o resto (#21/#20/#22/#61) para um **worktree dedicado** `refogando-wt-mc`. Regras (memória [[use-worktree-isolation-parallel-sessions]]):
- **SEMPRE** `git worktree add -b feat/<n> ../refogando-wt-<x> origin/main` e trabalhe SÓ ali. Um worktree por sessão serve pra fatias sequenciais (`git fetch && git checkout -B feat/<próxima> origin/main` entre elas). Subagentes de implementação devem ser PRESOS ao path do worktree e proibidos de tocar o dir compartilhado / outros worktrees / o stash.
- **`node_modules`: hardlink-copie, NÃO symlink.** `cp -al .../node_modules ./node_modules` (instantâneo, mesma fs). Symlink quebra `next build` (Turbopack: "Symlink … points out of the filesystem root"). `.env.local` pode ser symlink.
- **Testes: use o endpoint DIRETO do Postgres.** Sessões concorrentes churnam DBs efêmeros no pooler do Neon → `database "refogando_test_<rand>" does not exist` derruba a suíte node inteira (padrão = infra, não regressão). Prefixe: `TEST_DATABASE_URL="${TEST_DATABASE_URL//-pooler/}"`.
- **`origin/main` se move por baixo de você** (a outra sessão mergeia). Antes do green-gate de cada fatia: `git fetch` e cheque `git rev-list --count origin/main..HEAD`; se main avançou e tocou arquivos seus, **rebase** (`git rebase origin/main`, resolva i18n) e green-gate o estado REAL de merge. `git diff --stat origin/main` (2-dot) ENGANA quando main avançou — use o 3-dot `origin/main...HEAD` pra ver só o seu.
- **`git push --force-with-lease` FUNCIONA** em branch de feature (usado p/ repushar #21 rebasado). Push normal propaga; verifique sempre com `git ls-remote origin <branch>` (um quirk silencioso já dropou um push — daí o `…-v2` do #17).

## Convenções/estado que esta sessão fixou (a próxima herda)

- **Backend de linhagem JÁ EXISTIA no schema** (scaffold): `recipe.parent_recipe_id` (self-FK ON DELETE set null), `lineage_kind` enum `['regenerated','edited']`, trigger `recipe_origin_immutable` (P0001 em UPDATE de `origin` — set só no INSERT), CHECK `recipe_playful_private_chk`. Por isso o bloco inteiro teve **1 migration só** (0011, `derived_diff`).
- **Helpers reusados** (não reinvente): `src/server/recipe/{edit.ts (applyEdit/decideStale), visibility.ts (guard-order+pgCode+404-leak-safe), load.ts, regenerate.ts, derive.ts, owner-edit.ts, list-mine.ts}`; `src/server/curate/create.ts` (shape de INSERT de recipe_ingredient — `quantidade` string|null, nunca number); `src/server/generation/persist.ts` (agora com `existingSessionId` + `lineage` opcionais); `src/domain/recipe-diff.ts` (diff congelado), `recipe-list-read.ts`, `recipe-read.ts` (RecipeRow tem parentRecipeId/lineageKind/derivedDiff/vinculoPerdido + projeção owner-gated do diff).
- **Autorização = POSSE, nunca papel** (#17/#20/#21/#61): catálogo (ownerId NULL) ou outro dono → **404** (não 403, não vaza existência); ordem dos guards load-bearing (isUuid→404 → requireSession→401 → SELECT barato de posse → trabalho). Para #20 o gate (posse+origin+fonte) é o 1º toque de DB, ANTES do Claude (nenhuma chamada paga indevida).
- **Anônimo = read-only** (ADR-0011 atualizado): busca + leitura de pública (200); escrita/geração 401 fail-closed. Sem geração/efêmero/claim anônimo. A UI convida a entrar/criar conta na ação logada.
- **`GET /api/me/recipes`** é owner-scoped e **NÃO filtra pool** (o dono vê as próprias private/playful/removidas; a lista mostra selo "fora do acervo" pra removida). NÃO reusar helper de `recipe-pool.ts` aí.

## Próxima fase — **NÃO HÁ FATIA NA FILA** (o épico de UI acabou); pergunte a DIREÇÃO em chat

O épico #53 (camada de apresentação) está 10/10 e fechado. Não há mais fatia óbvia. **Comece perguntando ao usuário, EM CHAT** (modal perde texto), qual a próxima direção. Opções plausíveis:
- **Followups de polish** (baixa prioridade, abaixo): #16/#62 `voteCount` no DTO de busca; #18 (dedup/rate-limit de report, paginação da fila do Curador, cap no motivo); #78 (confirmar migrate-on-build pelo build log); #79 (limpeza `neon_auth`).
- **Endurecer deploy/produção** (rate-limit nas rotas de geração agora que são account-only mas ainda custam; observabilidade; o "earliest session heuristic" do #20 se uma Receita passar a ter múltiplas sessions).
- **Nova feature / novo épico** (rodar `/to-prd` → `/to-issues` a partir do PRD #1 ou de um pedido novo).
- **QA da jornada ponta-a-ponta** agora que a UI existe (`/qa` ou `/verify` rodando o app de verdade).

## Followups / itens abertos (não bloqueiam)

- **#78** confirmar migrate-on-build pelo build log; **#79** limpeza `neon_auth`. Baixa prioridade.
- **#16/#62:** expor `voteCount` no DTO `SearchResult` (voto/contagem por-resultado na busca; hoje só no detalhe).
- **#18 (low):** dedup/rate-limit de report; paginação da fila do Curador; cap no motivo.
- **#20 nota:** `regenerate.ts` acha a creation_session por `(recipeId, userId)` ordenada por `createdAt` limit 1 — correto pro shape atual (1 session/recipe); revisitar se uma Receita passar a ter várias sessions.
- **#61 deviação aceita:** `/me/recipes` usa guest-guard + fetch no CLIENTE (espelha create/conversation), não server self-fetch — fail-closed, ok.
- **Geração anônima removida:** se um dia quiser anon-gerar, será preciso rate-limit + voltar a permitir o seam (e o ADR-0011 reflete a decisão atual de NÃO permitir).
- **Higiene de git:** a outra sessão deixou `feat/recipes-browse-all` (local, no dir compartilhado) e `stash@{0}` (WIP de browse dela) — **não são meus**, não mexer; ela recupera. Meu worktree `refogando-wt-mc` foi removido ao fim desta sessão.

## Landmines / gotchas de ambiente (CONFIRMADOS)

- **(Ver Landmine #1 acima — worktree isolation é o principal.)**
- **Green-gate autoritativo roda SOZINHO** no worktree, endpoint direto: `npm run typecheck && npm run lint && TEST_DATABASE_URL=<direto> npm test (node+ui, ~330s) && BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build`. Rodei após CADA implementação E após CADA fix.
- **Relatórios de subagente vêm parciais:** sempre `git diff origin/main...HEAD --name-only` (3-dot) + grep de stray (`docs/plans`/`.playwright-mcp`/screenshots/`e2e/*.spec`) ANTES do green-gate. Outputs grandes de Workflow → `/tmp/.../tasks/<id>.output`, processe com `node -e` (parse+digest), não leia cru.
- **Code-review multi-lente com verificação adversarial** continua pagando: #17/#21/#20/#22/#61 → cada achado REFUTADO por um cético que relê o código real (rebaixou "critical/high" inflados e refutou falsos-positivos; mas pegou bugs reais no #61: PATCH com locale obsoleto, erro escondido atrás do dialog). Aplique só os confirmados; agrupe por causa raiz.
- **`AskUserQuestion` perde texto ao rejeitar** → direção/decisões em chat. **`next build` exige `BETTER_AUTH_SECRET`**. jsdom é a seam de teste de frontend ("E2E" nas ACs = teste jsdom em `test/ui/`); **NUNCA** Playwright commitado/`.playwright-mcp`/screenshots. Handoffs/PRs via branch; `Closes #N` em inglês; squash-merge `--delete-branch` + `git fetch --prune`.
- **DDL fantasma do drizzle:** resolvido desde 0007; 0011 saiu limpa. `db:generate` (NÃO `db:migrate`, que é prod) + grep `search_vector|hnsw|using gin`; o test DB efêmero aplica os `.sql`; Vercel migra prod no deploy (provado pela cópia-de-prod do check do PR).

## Ler primeiro (no repo / GitHub — não duplicado aqui)

- **PRD #1**, **`CONTEXT.md`**, **ADRs** `0002` (origin imutável + trigger), `0005` (edição derivada com diff), `0006` (sessão de criação + regeneração imutável), `0011` (**atualizado** — anon read-only, sem geração), `0013` (result_kind/playful). 
- **Diffs das PRs #99/#101/#102/#106/#107** pro detalhe. **Handoffs 21 e 22** pro contexto de prompt aberto e modo conversa.
- **Seams de linhagem/edição:** `src/server/recipe/{derive,owner-edit,regenerate,list-mine}.ts`, `src/domain/{recipe-diff,recipe-list-read,recipe-read}.ts`, `src/server/generation/persist.ts`, `src/app/api/recipes/[id]/{route,derive,regenerate}/route.ts`, `src/app/api/me/recipes/route.ts`, `src/app/me/recipes/page.tsx`, `src/components/recipe/{my-recipes-list,recipe-edit-form,derive-experience,recipe-diff-view,lineage-version-controls,recipe-detail-actions}.tsx`.

## Critério de saída (já atingido)

Épico #53 fechado 10/10; suíte verde (938); app navegável ponta-a-ponta; seam de teste de frontend (jsdom) verde no CI. Não há fase de saída pendente — a próxima sessão define o próximo objetivo com o usuário.

## Suggested skills

- **Pergunta de DIREÇÃO em chat** (NÃO no modal) — primeira ação: não há fatia na fila, o épico acabou. Ofereça followups vs deploy-hardening vs nova feature vs QA.
- **`/qa`** ou **`/verify`** — agora que a UI existe, vale exercitar a jornada de verdade.
- **`/to-prd` → `/to-issues`** — se a direção for uma feature/épico novo.
- **`Workflow`** (explore/plan-com-review/code-review) + **Agent** PRESO A WORKTREE pra implementação. **`tdd`** + integração Postgres (endpoint direto) pra qualquer backend. **`/impeccable`** pra UI.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. Na sessão anterior a ÚLTIMA fatia do épico de UI #53 foi entregue e mergeada — **Minhas criações** (#61 ← os 4 blockers #17 Receita derivada+diff PR #99, #21 edição in-place+apagar PR #101, #20 regeneração imutável PR #102, #22 contrato anônimo PR #106; UI PR #107) — e o **épico #53 foi FECHADO 10/10**. Estado final em main 0b0e013, full suite 938, app navegável ponta-a-ponta (buscar→ver→criar [estruturado/prompt aberto/conversa]→salvar/publicar→minhas criações). Comece lendo o handoff @docs/handoffs/23-minhas-criacoes-61-epico-ui-completo-10-10-proxima-direcao.md (o que foi entregue, a arquitetura de linhagem/edição, a decisão de produto anon read-only, os followups, e — crítico — a disciplina de WORKTREE). PRIMEIRA AÇÃO: como NÃO há fatia na fila (o épico de UI acabou), me pergunte EM CHAT (não no modal, que perde texto) qual a próxima direção — opções: followups de polish (#16/#62 voteCount no DTO de busca; #18 dedup/rate-limit de report+paginação fila do Curador; #78 confirmar migrate-on-build; #79 limpeza neon_auth), endurecer produção/deploy (rate-limit, observabilidade), nova feature/épico (`/to-prd`→`/to-issues`), ou QA da jornada (`/qa`/`/verify`). DISCIPLINA INEGOCIÁVEL (aprendizado desta sessão — múltiplas sessões compartilham o working dir e COLIDIRAM): trabalhe SEMPRE num worktree dedicado (`git worktree add -b feat/<n> ../refogando-wt-<x> origin/main`), hardlink-copie node_modules (`cp -al`, NUNCA symlink — quebra next build/Turbopack), use o endpoint DIRETO do Postgres nos testes (`TEST_DATABASE_URL="${TEST_DATABASE_URL//-pooler/}"`, senão o pooler concorrente derruba a suíte), e ANTES de cada green-gate faça `git fetch` + cheque se origin/main avançou (a outra sessão mergeia por baixo de você — se avançou e tocou seus arquivos, `git rebase origin/main` e green-gate o estado REAL; use diff 3-dot `origin/main...HEAD` que o 2-dot engana). `git push --force-with-lease` funciona em branch de feature; verifique a propagação com `git ls-remote`. NÃO toque no dir compartilhado /home/ferna/projects/refogando nem no worktree/stash da outra sessão. Processo: pipeline de 8 passos do CLAUDE.md, cada passo em subagente fresco PRESO ao worktree (Agent pra implementar — sequencial, sem corrida de edição; Workflow read-only pra explorar/planejar-com-review/code-review multi-lente com verificação adversarial, aplicando só os achados confirmados). O loop principal SÓ orquestra/integra e roda o GREEN-GATE autoritativo SOZINHO no worktree (npm run typecheck && npm run lint && TEST_DATABASE_URL=direto npm test [node+ui ~330s] && BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build) após CADA implementação E fix. Gotchas: branch de origin/main, Closes #N em inglês, squash-merge gh pr merge <N> --squash --delete-branch + git fetch --prune, gate real é o check checks (Vercel não-bloqueante mas migra cópia-de-prod), next build exige BETTER_AUTH_SECRET, NUNCA commitar docs/plans/.playwright-mcp/screenshots/e2e specs (a seam de teste é jsdom em test/ui/), db:generate (NÃO db:migrate) + grep search_vector|hnsw|using gin em migration nova. Princípios: CONTEXT.md (termos são lei, URL em inglês), ADRs (0002 origin imutável+trigger / 0005 derivada+diff / 0006 sessão+regeneração / 0011 atualizado: anon read-only sem geração / 0013 playful), receita é o centro e compliance é toque leve, linguagem simples e direta em pt-BR. Ao fim da fase, /handoff → docs/handoffs/24-*.md.
