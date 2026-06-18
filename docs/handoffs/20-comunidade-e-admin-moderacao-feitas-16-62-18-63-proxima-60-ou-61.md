# Handoff 20 — **Duas fatias verticais ponta-a-ponta** numa sessão (#16+#62 Comunidade · #18+#63 Admin/Moderação) · épico #53 em **8/10** · próxima: #60 ou #61 (ambas multi-blocker)

**Sessão anterior (estendida):** entregou e mergeou **DUAS fatias verticais completas** pelos 8 passos do `CLAUDE.md`, cada passo num subagente fresco via `Workflow`; o loop principal só orquestrou/integrou (verificação contra a árvore real + green-gate autoritativo SOZINHO + commit/PR/merge):

| Fatia | Backend | UI | O que entregou (fonte de verdade: `gh pr diff <N>`) |
|---|---|---|---|
| **Comunidade** | #16 (PR #80, `bc40a0b`) | #62 (PR #81, `2791119`) | voto/favorito (PK composta, FK cascade), ordenação por Popularidade na busca (gated, só Comunidade), `RecipeView` social leak-safe; UI de engajamento (otimista) + `SortToggle` |
| **Admin/Moderação** | #18 (PR #83, `9f1a00f`) | #63 (PR #84, `b9c642c`) | Report + remover-do-pool (≠ despublicar) + fila do Curador; console `/admin` role-gated com 4 seções (config/papéis, moderação, traduções stale, curadoria) |

Também: **handoff 19** (PR #82). Estado final em `main`: **`b9c642c`**, working tree limpo, full suite **692/692** (576 no início → 615 → 628 → 656 → 692). Épico #53: **8 de 10** (#54–#59 + #62 + #63). **Restam #60 e #61.**

## ✅ PRIORIDADE #0 (prod) — não havia o que fazer

Já estava resolvida na entrada (prod migrado + migrate-on-build em `vercel.json`/PR #77, provado). Os 4 preview deploys desta sessão (#80/#81/#83/#84) passaram migrando uma branch Neon cópia-de-prod → forte evidência de que o migrate-on-build roda. Residuais abertos, baixa prioridade: **#78** (confirmar pelo build log que o `drizzle-kit migrate` roda mesmo) e **#79** (limpeza do schema `neon_auth`).

## Ganhos transversais desta sessão (a próxima herda)

- **🔒 `requireRole` agora é FAIL-CLOSED** (corrigido em #18, `src/server/auth/guard.ts`): era fail-OPEN — usuário autenticado com papel `null`/desconhecido passava o guard de Curador (`decideRole` retorna `unauthenticated`, e o guard só barrava `forbidden`). Agora `if (decideRole(...) !== 'allow') return 403`. Afeta TODAS as rotas role-gated (`curate/*`, `admin/*`). Teste: `test/unit/guard-role.test.ts`. **Memória `requireRole-fail-open-despite-comments` atualizada p/ RESOLVIDO** — mas a lição segue viva (o plano de #18 RE-afirmou "fail-closed" lendo comentários; o code-review pegou como bug real). Confie no fluxo, não nos comentários.
- **Landmine do DDL fantasma do drizzle: resolvido a partir do 0007.** Porque o `0007_snapshot.json` (de #16) é um retrato COMPLETO, o `db:generate` parou de re-emitir DDL fantasma — a **0008 (#18) saiu limpa sozinha**, sem podar. **Memória `drizzle-meta-snapshots-stale-phantom-ddl` atualizada.** Ainda assim: `grep -iE "search_vector|hnsw|gin"` em toda migration nova como rede.
- **Gate de POOL agora tem 3 dimensões ortogonais:** `(owner NULL OR visibility='public')` [#13] · `result_kind <> 'playful'` [ADR-0013] · `moderation_removed_at IS NULL` [#18]. Fonte única em `src/domain/recipe-pool.ts` (`eligibleForPool`); o SQL cru replica a cláusula. Qualquer leitura/escrita de pool nova DEVE incluir as três.

## O processo que FUNCIONOU (reuse)

Três workflows parametrizados de 8 passos (explore∥4 → plan → plan-review∥4 adversarial → fix-plan → implement → code-review∥5 → fix), cada passo em subagente fresco, escrevendo o código real na branch. O loop principal cria a branch ANTES; depois: verifica o relatório contra a árvore real, roda o green-gate SOZINHO, commita/PR/mergeia.

- **UI** (reusável): `/home/ferna/.claude/projects/-home-ferna-projects-refogando/0673a830-e78f-459e-bb9f-e8da4a1b1267/workflows/scripts/implement-ui-slice-wf_082836b0-e42.js`. `Workflow({scriptPath, args:{issue,title,branch,planSlug,routeFiles[],consumes,acceptance,sliceGuidance,deps}})`. Roda `vitest --project ui`+typecheck+lint; escreve rascunho em `docs/plans/` → **`rm -rf docs/plans` antes do commit**.
- **Backend** (2 variantes escritas esta sessão, adaptáveis): `.../bff6210f-.../workflows/scripts/backend-slice-16-comunidade-wf_d64f7b68-27a.js` e `backend-slice-18-moderacao-wf_9d7472d1-f2c.js`. TDD red→green + gera migration. Edite `CTX`/lentes/ACs pro novo escopo.

**Aprendizado reconfirmado (DUAS vezes esta sessão):** `filesChanged`/`i18nKeysAdded` dos relatórios vêm **PARCIAIS** (#62 disse `i18nKeysAdded:[]` tendo adicionado o namespace inteiro; #63 não listou `src/app/admin/page.tsx`). **SEMPRE** `git status --porcelain` + `git diff --stat origin/main`. E LEIA o que parece placeholder: o #63 marcou a criação de Receita de catálogo como "em breve" (a parte de Ingrediente canônico ficou funcional) → followup **#85**.

## Decisões que #18/#63 fixaram

- **Moderação (ADR-0003/0011):** tabela `report` (reporter/recipe/motivo/status pending→resolved) + 3 colunas denormalizadas de moderação em `recipe` (`moderation_removed_at`/`reason`/`by`, CHECK de consistência, `moderated_by ON DELETE SET NULL`). **Remover-do-pool ≠ despublicar** (dimensões independentes; republish não ressuscita moderada). Owner mantém a linha privada; votos persistem; favoritadores deixam de ver. Moderação é DEPOIS do report, NUNCA gate de publicação. Múltiplos reports por receita; remove resolve só o report atual e preserva a proveniência da 1ª remoção. Report mira a `recipe` (identidade única entre locales). #17 (editar→derivada) deferido — a moderação não muta a base.
- **Console `/admin`:** Server Component fino que lê a sessão via `getAuth().api.getSession(headers())` e despacha por `decideAdminAccess` PURO (`src/server/auth/admin-access.ts`) — anônimo→`/sign-in`, sem papel→`AccessDenied`, senão→`AdminConsole`. Gating fail-closed testado em `test/server/admin-access.test.ts` (a matriz que o jsdom não alcança). Seções inacessíveis são ESCONDIDAS; Curador NÃO vê Config/Papéis. Seções cliente consomem rotas via fetch (ADR-0010). Sem cor destrutiva (peso/posição de botão diferencia Manter/Remover).

## Próxima sessão — **FORK DE DIREÇÃO** (o usuário escolhe; em CHAT, não no modal)

Restam **2 fatias da Wave 2**, ambas **multi-blocker** (o padrão "single-blocker" desta sessão e da #62 não se aplica mais):
- **#60** Modo conversa (chat) ← **#12** (streaming + destilação p/ Receita), **#15** (persistência, retomada, apagar transcript) — 2 blockers de backend.
- **#61** Minhas criações + editar própria + derivada ← **#17** (derivada/editar não-própria + diff), **#20** (regeneração), **#21** (edição in-place + apagar + ON DELETE SET NULL), **#22** (acesso anônimo efêmero) — 4 blockers.
- **#85** (pequeno): UI de criação estruturada de Receita de catálogo — **backend pronto** (`/api/curate/recipes`), só falta o form no console. Quick win que fecha o placeholder de #63.

Opções p/ a próxima sessão:
- **(A) Quick win + começar chat:** fechar **#85** (rápido, backend pronto) e então começar a cadeia de **#60** pelo backend **#12** (streaming/destilação é o fundacional), depois #15, depois a UI #60.
- **(B) Cadeia #61:** os 4 blockers de backend (#17 derivada é fundacional p/ "minhas criações" E p/ o curator-edit referenciado em #18) → depois a UI #61.
- **(C) Só #60 ou só #61 ponta-a-ponta**, fazendo os blockers de backend e a UI na mesma sessão (são sessões maiores que as desta vez).

**Recomendação:** pergunta de direção ao usuário em chat. Default sensato = **(A)** — #85 fecha um gap conhecido com baixo custo, e #60 tem menos blockers que #61 e é uma feature de destaque. Cada blocker de backend usa `tdd` + integração Postgres; cada UI usa o workflow de UI reusável.

## Itens DEFERIDOS / followups (não bloqueiam)

- **#85** — criação estruturada de Receita de catálogo no console (placeholder "em breve" em `catalog-curation.tsx`).
- **#18 (low):** dedup/rate-limit de report (índice parcial único `(recipe_id, reporter_id) WHERE status='pending'`); paginação/LIMIT da fila do Curador; cap no tamanho do motivo; extrair `loadPoolGate` único; arms mortos no switch do keep route.
- **#16/#62:** expor `voteCount` no DTO `SearchResult` p/ voto/contagem por-resultado na busca (hoje só na tela de detalhe).
- **#62 nit:** affordance de carregando além de `opacity`; a montagem em `page.tsx` (Server Component) não tem teste jsdom.
- **drizzle:** regenerar/commitar snapshots meta 0005/0006 (limpeza definitiva; já mitigado de fato a partir do 0007).

## Landmines / gotchas de ambiente (CONFIRMADOS)

- **Green-gate autoritativo roda SOZINHO** (sem Workflow concorrente): `npm run typecheck` && `npm run lint` && `npm test` (= `vitest run`, node+ui, ~330s solo; `TEST_DATABASE_URL` já no env) && `BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build`. UI só: `npx vitest run --project ui`. Ruído inofensivo do jsdom: "Not implemented: navigation to another Document".
- **`next build` EXIGE `BETTER_AUTH_SECRET` (≥32 chars)**.
- **Branch de `origin/main`**; `git push` após cada commit; squash-merge `gh pr merge <N> --squash --delete-branch` + `git fetch --prune`; **`Closes #N` em INGLÊS** no corpo do PR (fechou #16/#62/#18/#63 sozinho). Gate real = check **`checks`** (GitHub Actions, ~2–3min); Vercel não-bloqueante mas passou em todos.
- **`AskUserQuestion` perde texto ao rejeitar** → fork de direção e autorizações em **chat**.
- **Rascunho de plano** do workflow de UI vai em `docs/plans/` → `rm -rf docs/plans` antes do `git add`. NUNCA commitar `.playwright-mcp/`, screenshots, scripts de probe. **Handoff via branch + PR** (nunca direto no main).

## Ler primeiro (no repo / GitHub — não duplicado aqui)

- **Épico #53** (8/10; #60/#61 + blockers), **PRD #1** (`docs/prd/refogando.md`), **`CONTEXT.md`** (termos são lei, incl. os de moderação que #18 adicionou; URL em inglês), **ADRs** `0003` (voto/favorito/popularidade/moderação), `0008` (tiering), `0010` (route handlers via fetch), `0011` (gating), `0013` (playful⇒privada), `0004`/`0015` (âmbar/accent), `0014`/`0001` (bilíngue).
- **Diffs das PRs #80/#81/#83/#84**. **Handoffs 18 e 19** pro contexto da Wave 1 e da fatia de Comunidade.
- **Rotas a consumir** quando os blockers de #60/#61 fecharem: handlers em `src/app/api/` (chat/streaming p/ #60; creation-sessions/generations/derivada/regeneração p/ #61).

## Critério de saída (da próxima fase)

UI vertical: verde em lint/types/`npm test` (node+ui) + `next build` com secret; jsdom cobrindo as jornadas; `/impeccable` satisfeito; validação onde não for DB-mutante; squash-merge + issue fechada + épico atualizado. Backend: `tdd` + integração Postgres verdes + migration limpa (grep). Ao fim, `/handoff` → `docs/handoffs/21-*.md`.

## Suggested skills

- **Pergunta de direção** (em chat) antes de tudo — escolher #85/#60/#61.
- **`Workflow`** com os `scriptPath` acima — UI (reusar) e backend (adaptar um dos 2).
- **`tdd`** + integração Postgres — p/ os blockers de backend de #60 (#12,#15) ou #61 (#17,#20,#21,#22).
- **`/impeccable`** — central nas fatias de UI (#85, #60, #61).
- **`triage`** — ao mover/abrir issues destravando a Wave 2.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. Na sessão anterior foram entregues DUAS fatias verticais ponta-a-ponta e mergeadas no main: Comunidade (#16 backend PR #80 + #62 UI PR #81) e Admin/Moderação (#18 backend PR #83 + #63 UI PR #84), além do handoff 19; épico #53 agora em 8/10 (Wave 1 #54–#59 + #62 + #63); estado final em main b9c642c, full suite 692/692. Comece lendo o handoff @docs/handoffs/20-comunidade-e-admin-moderacao-feitas-16-62-18-63-proxima-60-ou-61.md (o que as fatias entregaram e onde, as decisões fixadas, os ganhos transversais, os 3 workflows parametrizados de 8 passos, os itens deferidos, e o estado dos blockers restantes da Wave 2). A PRIORIDADE #0 de prod (login 500) está RESOLVIDA desde antes (migrate-on-build em vercel.json/PR #77, provado pelos 4 preview deploys desta sessão); só restam os residuais baixa-prioridade #78 (confirmar pelo build log que o drizzle-kit migrate roda) e #79 (limpeza neon_auth). GANHOS TRANSVERSAIS que você herda: (1) requireRole agora é FAIL-CLOSED em todo o app (corrigido em #18, src/server/auth/guard.ts: if decideRole(...) !== 'allow' return 403; antes papel null/desconhecido passava o guard de Curador) — mas a lição segue viva, NÃO confie nos comentários de guard.ts/access.ts, verifique o fluxo (o plano de #18 re-afirmou errado e o code-review pegou); (2) o landmine do DDL fantasma do drizzle se resolveu a partir do 0007 (o snapshot 0007 é completo, então db:generate não re-emite fantasma; a 0008 saiu limpa) — ainda assim faça grep -iE search_vector|hnsw|gin em toda migration nova; (3) o gate de POOL agora tem 3 dimensões ortogonais — (owner NULL OR visibility public) [#13], result_kind != playful [ADR-0013], moderation_removed_at IS NULL [#18] — fonte única em src/domain/recipe-pool.ts (eligibleForPool), e qualquer leitura/escrita de pool nova DEVE incluir as três. Contexto de processo: o desenvolvimento segue o pipeline de 8 passos do CLAUDE.md, cada passo num subagente fresco (Agent pra um passo, Workflow pra fan-out/pipeline) — o loop principal só orquestra e integra; há 3 workflows parametrizados prontos: UI reusável em /home/ferna/.claude/projects/-home-ferna-projects-refogando/0673a830-e78f-459e-bb9f-e8da4a1b1267/workflows/scripts/implement-ui-slice-wf_082836b0-e42.js (Workflow({scriptPath, args:{issue,title,branch,planSlug,routeFiles,consumes,acceptance,sliceGuidance,deps}}); roda vitest --project ui+typecheck+lint, escreve rascunho em docs/plans/ que VOCÊ remove com rm -rf docs/plans antes do commit) e dois de BACKEND (TDD red→green + gera migration) em /home/ferna/.claude/projects/-home-ferna-projects-refogando/bff6210f-760e-464e-9d9a-5139c3a62a17/workflows/scripts/backend-slice-16-comunidade-wf_d64f7b68-27a.js e backend-slice-18-moderacao-wf_9d7472d1-f2c.js (adapte CTX/lentes/ACs); SEMPRE verifique o relatório contra a árvore real (git status --porcelain/git diff --stat origin/main) pois filesChanged/i18nKeysAdded vêm PARCIAIS (aconteceu 2x: #62 disse i18nKeysAdded vazio tendo adicionado o namespace inteiro; #63 não listou a page /admin) e LEIA o que parece placeholder (o #63 deixou a criação de Receita de catálogo como "em breve" → followup #85). PRIMEIRA AÇÃO — me pergunte EM CHAT (não no modal AskUserQuestion, que perde texto ao rejeitar) a DIREÇÃO desta sessão: restam só 2 fatias da Wave 2, ambas MULTI-blocker — #60 Modo conversa (chat) ← #12 (streaming+destilação) e #15 (persistência/retomada/apagar); #61 Minhas criações ← #17 (derivada), #20 (regeneração), #21 (edição in-place+apagar), #22 (acesso anônimo efêmero) — mais o followup pequeno #85 (UI de criação de Receita de catálogo, backend /api/curate/recipes já pronto, fecha o placeholder de #63); recomendo (A) fechar o #85 (quick win) e começar a cadeia de #60 pelo backend #12, porque #60 tem menos blockers que #61 e é feature de destaque, mas confirme comigo; cada blocker de backend usa tdd + integração Postgres, cada UI usa o workflow de UI reusável, fazendo backend e UI da mesma fatia na mesma sessão quando der (vertical slice ponta-a-ponta, como #16→#62 e #18→#63). Gotchas: rode o green-gate autoritativo SOZINHO (npm run typecheck && npm run lint && npm test [vitest node+ui ~330s, TEST_DATABASE_URL no env] && BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build); branch de origin/main, git push após cada commit, squash-merge gh pr merge <N> --squash --delete-branch + git fetch --prune, Closes #N em inglês no corpo do PR, gate real é o check checks do GitHub Actions (Vercel não-bloqueante mas passou em todos, migrando uma branch Neon cópia-de-prod), pollar gh pr checks <N> --watch; rascunho de plano removido antes do commit e NUNCA commitar .playwright-mcp/, screenshots ou scripts de probe; handoffs/PRs sempre via branch (classificador bloqueia direto no main). Princípios: CONTEXT.md (termos são lei, convenção de URL em inglês), ADRs (0003 voto/favorito/popularidade/moderação; 0008 tiering; 0010 route handlers via fetch; 0011 gating; 0013 playful⇒privada; 0004/0015 âmbar/accent; 0014/0001 bilíngue), receita é o centro e compliance é toque leve, linguagem simples e direta em pt-BR. Ao fim da fase, rode /handoff gerando docs/handoffs/21-*.md + prompt de kickoff.
