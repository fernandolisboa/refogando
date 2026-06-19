# Handoff 25 — **tracker corrigido + backlog real** · épico de UI #53 segue **COMPLETO/fechado** · próxima fase: **decisão de direção** (recomendado #104 chatbot flutuante, ou tech-debt #52 / housekeeping #78/#79)

**Complementa, não substitui:** o **handoff 23** (conclusão do épico de UI #53 — Minhas criações #61 ← #17/#20/#21/#22) e o **handoff 24** (sessão PARALELA: `/recipes` virou feed cronológico **#103**, substituindo o browse #98). Este doc só **corrige a foto do tracker** (a sessão anterior listou followups que na verdade estavam fechados) e fixa a **próxima direção**. Não re-deriva o que 23/24 já cobrem.

## ⚠️ DUAS sessões rodam em paralelo neste repo (confirmado de novo)

Enquanto eu fechava o épico de UI, a outra sessão entregou **#103** (feed `/recipes`) e escreveu o **handoff 24** — `origin/main` avançou de `0b0e013` → `29a207a` por baixo de mim. **Reforça [[use-worktree-isolation-parallel-sessions]]:** sempre worktree dedicado off `origin/main`; `git fetch` + cheque `git rev-list --count origin/main..HEAD` ANTES de cada green-gate; rebase se main avançou e tocou seus arquivos; diff 3-dot `origin/main...HEAD` (o 2-dot engana quando main avança); `node_modules` por **hardlink** (`cp -al`, symlink quebra `next build`); endpoint **direto** de Postgres nos testes (`TEST_DATABASE_URL="${TEST_DATABASE_URL//-pooler/}"`); `--force-with-lease` funciona; verifique push com `git ls-remote`. NÃO toque no dir compartilhado nem no worktree/stash da outra sessão.

## Correção do tracker (a confusão desta conversa)

A sessão anterior chamou de "followups" issues que **já estavam FECHADAS** — daí você as viu fechadas. Estado real verificado:

| Issue | Estado | Nota |
|---|---|---|
| #16, #62 | **CLOSED** | Comunidade (voto/favorito/popularidade) — backend+UI, sessões anteriores |
| #18 | **CLOSED** | Moderação reativa (report + remoção do pool) |
| **#51** | **CLOSED (fechei nesta sessão)** | `requireRole` **já era fail-closed** (`guard.ts:56-62`: `decideRole(...) !== 'allow' → 403`; papel `null`/desconhecido → `toSession`→null → não-allow → 403) e **coberto por teste** (`test/domain/access.test.ts` E11; `test/server/admin-access.test.ts` `role:null→denied`). Issue estava **stale-aberta** — fechada com comentário apontando o código+testes |
| #103, #98 | **CLOSED** | `/recipes` feed (#103) substituiu o browse (#98) — sessão paralela |
| #53 | **CLOSED** | Épico de UI — 10/10 |

## Backlog REAL (6 issues abertas, verificadas via `gh issue list --state open`)

1. **#104** [needs-triage] — *Design: Conversa como chatbot flutuante (lateral) em vez de página própria; folding do prompt aberto.* **Feature/UX** — itera o modo conversa (#60, hoje página própria `/conversation`) pra um widget flutuante lateral + "folding" do prompt aberto. **A design NÃO está fixada** (needs-triage): exige decidir o shape (flutuante em todas as telas? só onde? como o prompt aberto "dobra" nisso? mobile?). 
2. **#52** [enhancement, needs-triage] — *Extrair predicado de visibilidade-comunidade `(owner_id IS NULL OR visibility=public)` pra fonte única.* **Refactor** de baixo risco e segurança-adjacente: o predicado está **copiado ~6× em SQL** (`src/server/recipe/search.ts:96,306,356,376,465`) + JS (`src/domain/recipe-pool.ts:24`) + `recipes/[id]/route.ts` (isPublicRead). Extrair um fragmento SQL/constante única reduz drift. (NB: o gate de POOL é 3-dim — `eligibleForPool` em recipe-pool.ts; #52 é só a dimensão de visibilidade.)
3. **#78** — confirmar migrate-on-build pelo build log (housekeeping, baixa).
4. **#79** — limpar schema `neon_auth` não usado em prod (housekeeping, baixa; precisa OK do usuário pra mexer em prod).
5. **#30** [ready-for-human] — bootstrap de labels+milestones (BLOQUEADO: precisa o usuário definir a taxonomia).
6. **#1** [ready-for-agent] — o PRD umbrella (doc; aberto como referência de produto).

## Próxima fase — recomendação (decisão é do usuário; perguntar EM CHAT)

Não há fatia "óbvia" na fila. Recomendação por valor/risco:
- **#104 (chatbot flutuante)** — maior valor de produto (itera o feature de destaque, foi ideia do próprio usuário). Mas é `needs-triage`: **começar por uma decisão de design** (`/grill-with-docs` ou `/prototype` p/ fixar o shape do widget + o folding do prompt aberto; respeitar a arquitetura do chat do #60 — NDJSON streaming, `conversation-experience.tsx`, `/conversation/[id]` retomada) → depois `/impeccable`. Maior esforço.
- **#52 + #78/#79** — caminho de baixo risco / "deixe melhor que achou": dedup do predicado (#52) + housekeeping. Rápido, contido, hardening.
- **Nova feature / escopo novo** — `/to-prd` → `/to-issues` a partir do PRD #1 ou de um pedido novo.
- **QA da jornada** — `/qa` ou `/verify` agora que a UI inteira existe (buscar → feed → ver → criar [estruturado/prompt aberto/conversa] → salvar/publicar → minhas criações).

Meu voto: se for continuar produto, **#104 com passo de design primeiro**; se for higiene/segurança, **#52 + #78/#79**.

## Ler primeiro
- **Handoff 23** (conclusão do épico UI #53 + arquitetura de linhagem/edição/regeneração + decisão anon read-only). **Handoff 24** (feed `/recipes` #103). **CONTEXT.md**, **PRD #1**, ADRs (0002/0005/0006/0009/0010/0011-atualizado/0013/0015).
- Modo conversa (base do #104): `src/components/recipe/conversation-experience.tsx`, `src/app/conversation/[id]/page.tsx`, `src/app/api/conversations/stream/route.ts` (NDJSON).
- #52: `src/server/recipe/search.ts` (6× o predicado), `src/domain/recipe-pool.ts`, `src/app/api/recipes/[id]/route.ts`.

## Suggested skills
- **Pergunta de DIREÇÃO em chat** (não modal) — primeira ação. 
- **#104**: `/grill-with-docs` ou `/prototype` (fixar o design do chatbot flutuante) → `/impeccable` (UI) — em **worktree dedicado**.
- **#52**: `/request-refactor-plan` ou direto via `tdd` — em worktree dedicado.
- **`Workflow`** (explore/plan-com-review/code-review adversarial) + **Agent PRESO a worktree** pra implementação; green-gate autoritativo solo (endpoint direto). **`/qa`**/`/verify` se for testar a jornada.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. O épico de UI #53 está COMPLETO e fechado (10/10): app navegável ponta-a-ponta (buscar → feed /recipes → ver → criar [estruturado/prompt aberto/conversa] → salvar/publicar → minhas criações/editar/derivar/regenerar). main mais recente inclui Minhas criações (#61 ← #17/#20/#21/#22, handoff 23) e o feed /recipes (#103, sessão paralela, handoff 24). Comece lendo @docs/handoffs/25-tracker-corrigido-backlog-real-proxima-direcao.md (corrige a foto do tracker e fixa a próxima direção) e, se precisar de detalhe, os handoffs 23 e 24. PRIMEIRA AÇÃO: NÃO há fatia na fila — me pergunte EM CHAT (não no modal, que perde texto) qual a próxima direção. Backlog REAL aberto (6 issues, verificado): #104 (design: conversa como chatbot flutuante lateral + folding do prompt aberto — needs-triage, design NÃO fixada), #52 (refactor: extrair o predicado de visibilidade-comunidade `(owner_id IS NULL OR visibility=public)` pra fonte única — está copiado ~6× em src/server/recipe/search.ts + JS em recipe-pool.ts + route.ts), #78 (confirmar migrate-on-build), #79 (limpar schema neon_auth em prod — precisa meu OK), #30 (labels/milestones — BLOQUEADO em taxonomia, decisão humana), #1 (PRD umbrella, doc). Já fechadas (não são followups): #16/#62/#18 (Comunidade/Moderação, sessões anteriores), #51 (requireRole JÁ era fail-closed em guard.ts:56-62 + testado em test/domain/access.test.ts e test/server/admin-access.test.ts — issue estava stale, fechei). Recomendação: se for produto, #104 começando por um passo de DESIGN (/grill-with-docs ou /prototype pra fixar o shape do widget flutuante + o folding do prompt aberto, respeitando a arquitetura do chat #60: NDJSON streaming em conversation-experience.tsx + /conversation/[id]) e depois /impeccable; se for higiene/segurança, #52 + #78/#79; ou escopo novo via /to-prd→/to-issues; ou QA da jornada via /qa//verify. DISCIPLINA INEGOCIÁVEL (duas sessões rodam concorrentes no MESMO working dir e a main avança por baixo de você): trabalhe SEMPRE num worktree dedicado (git worktree add -b feat/<n> ../refogando-wt-<x> origin/main), hardlink-copie node_modules (cp -al, NUNCA symlink — quebra next build/Turbopack), use o endpoint DIRETO do Postgres nos testes (TEST_DATABASE_URL="${TEST_DATABASE_URL//-pooler/}"), e ANTES de cada green-gate faça git fetch + cheque se origin/main avançou (se sim e tocou seus arquivos, git rebase origin/main e green-gate o estado REAL; diff 3-dot origin/main...HEAD, o 2-dot engana). force-with-lease funciona em branch de feature; verifique push com git ls-remote. NÃO toque no dir compartilhado /home/ferna/projects/refogando nem no worktree/stash da outra sessão. Processo: 8 passos do CLAUDE.md, cada passo em subagente fresco PRESO ao worktree (Agent pra implementar sequencial; Workflow read-only pra explorar/planejar-com-review/code-review multi-lente com verificação adversarial, aplicando só achados confirmados). Loop principal SÓ orquestra/integra e roda o green-gate autoritativo SOZINHO no worktree (npm run typecheck && npm run lint && TEST_DATABASE_URL=direto npm test [node+ui ~330s] && BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build) após CADA implementação E fix. Gotchas: branch de origin/main, Closes #N em inglês, squash-merge gh pr merge <N> --squash --delete-branch + git fetch --prune, gate real é o check checks (Vercel não-bloqueante mas migra cópia-de-prod), next build exige BETTER_AUTH_SECRET, NUNCA commitar docs/plans/.playwright-mcp/screenshots/e2e specs (seam de teste é jsdom em test/ui/), db:generate (NÃO db:migrate, que é prod) + grep search_vector|hnsw|using gin em migration nova. Princípios: CONTEXT.md (termos são lei, URL em inglês), ADRs (0002 origin imutável+trigger / 0005 derivada+diff / 0006 sessão+regeneração / 0011 atualizado: anon read-only sem geração / 0013 playful), receita é o centro e compliance é toque leve, linguagem simples e direta em pt-BR. Ao fim da fase, /handoff → docs/handoffs/26-*.md.
