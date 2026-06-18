# Handoff 21 — **Prompt aberto** (#87 Aviso pós-geração + #88 free_text, backend+UI) + **polish** (tagline / idioma no footer / bootstrap de admin) · épico #53 em **8/10** · próxima: #60 ou #61 (multi-blocker)

**Sessão anterior (continuação da 20):** entregou e mergeou, pelos 8 passos do `CLAUDE.md` (cada passo em subagente fresco via `Workflow`; loop principal só orquestra/integra/green-gate-solo):

| Entrega | PR | O que (fonte de verdade: `gh pr diff <N>`) |
|---|---|---|
| **#85** form de Receita de catálogo | #89 | fecha o placeholder "em breve" do console `/admin` (#63); `catalog-recipe-form.tsx` → `POST /api/curate/recipes` |
| **#87** Aviso de restrição PÓS-geração | #90 | `decidePostGenerationRestrictionNotices` (recipe-restrictions.ts) escaneia a **Receita gerada**; rota faz **união** pré+pós; todos os modos; ADR-0004 |
| **#88** prompt aberto (`free_text`) backend | #90 | `CreationMode += free_text`, `origin += ai_free_text`, migration 0009; `POST /api/generations {mode:'free_text', freeText}`; reusa generateRecipe/classify/persist; texto cru → LLM (estrutura vem da saída) |
| **#88** prompt aberto UI | #92 | toggle **Estruturado ↔ Prompt aberto** em `/create` (textarea); `SortToggle` generalizado p/ reuso; reusa o render de resultado/avisos do #58 |
| **Polish** (tagline, idioma, admin) | #91 | ver abaixo |

Estado final em `main`: **`712f67b`**, working tree limpo, full suite **733/733** (era 699 no início desta continuação → 724 → 733).

## Pedidos do usuário nesta sessão (todos FEITOS)

1. **Prompt aberto** (a feature nova): o usuário queria, além da criação estruturada (#58), um **prompt aberto** — escrever em texto livre o que quer. **Decisão de design (registrada em ADR-0006):** NÃO pré-parsear o texto num Briefing via 2º LLM; passar o texto **cru** pro LLM de geração (que já devolve saída estruturada `RecipeGenSchema`) e derivar a estrutura da **saída**; a segurança é o **Aviso pós-geração** (#87, que faltava e vale pra todos os modos). Virou #87 (base) + #88 (modo `free_text`, backend+UI). É um modo distinto do #58 (form) e do #60 (chat) — e **precursor do #60** (chat = prompt aberto + conversa).
2. **Primeiro admin:** `scripts/grant-role.mjs` + `npm run grant-role -- <email> <papel>` (JS puro com `postgres`, sem dep nova, via `node --env-file=.env.local`). Resolve o ovo-e-galinha (a UI de Papéis do `/admin` exige um admin que não existe). **O usuário roda** (`! npm run grant-role -- fernandoigorlisboa@pm.me admin`) — muta prod (gated). Depois promove pela UI.
3. **Seletor de idioma → footer:** saiu do `site-header`, foi pro `site-footer` (`shell.test` atualizado: switcher no footer cascateia o locale na chrome).
4. **Tagline:** `app.tagline` = **"Cozinhe qualquer ideia" / "Cook up any idea"** (era "Receitas com IA, em pt-BR e en-US" — a menção à localização era requisito de bootstrap, não identidade; amarrava se entrar es/ja/it). É um string em `messages.app` — trocar é trivial; o placeholder de exemplo do prompt aberto (pt-BR "curry vegano de grão-de-bico") também é trocável.

## Convenções/estado que esta sessão fixou (a próxima herda)

- **🔒 `requireRole` é FAIL-CLOSED** (desde #18, `src/server/auth/guard.ts`): `if (decideRole(...) !== 'allow') return 403`. Vale p/ TODA rota role-gated. **Memória `requireRole-fail-open-despite-comments` = RESOLVIDO**, mas a lição segue (não confie nos comentários; verifique o fluxo).
- **DDL fantasma do drizzle: resolvido a partir do 0007** (snapshot completo). A 0008 e a 0009 saíram limpas sozinhas. Ainda: `grep -iE "search_vector|hnsw|gin"` em migration nova como rede (cuidado: "gin" casa substring de "ori**gin**").
- **Gate de POOL = 3 dimensões ortogonais:** `(owner NULL OR visibility='public')` [#13] · `result_kind <> 'playful'` [ADR-0013] · `moderation_removed_at IS NULL` [#18]. Fonte única `src/domain/recipe-pool.ts` (`eligibleForPool`). Qualquer leitura/escrita de pool nova DEVE incluir as três.
- **Aviso de restrição agora roda PÓS-geração** (`decidePostGenerationRestrictionNotices`, recipe-restrictions.ts): escaneia a Receita GERADA (match do `rawText` dos ingredientes contra `ALLERGEN_CONTRADICTIONS` por fronteira não-alfanumérica, igualdade de palavra). A rota faz **união** pré (briefing) + pós (receita), dedup por restrição. Não bloqueia (âmbar, ADR-0004). Pega drift do LLM mesmo no structured.
- **Criação:** `CreationMode = conversation | structured | free_text`; `Origin += ai_free_text`. `free_text` persiste o texto cru em `creation_session.free_text` (sem briefing). `buildFreeTextPrompt` em briefing.ts. Validação 400 ANTES do LLM (`free_text_vazio` < ~10 chars; `free_text_muito_longo` > `OBSERVACOES_MAX=2000`).
- **Console `/admin`** (#63/#85): Server Component fino → `decideAdminAccess` puro (`src/server/auth/admin-access.ts`); seções escondidas por papel (Curador não vê Config/Papéis); 4 áreas funcionais + form de Receita de catálogo.
- **`SortToggle` é genérico** (`SortToggle<T>`): serve a ordenação da Comunidade (#62) E a alternância de modo do /create (#88).
- **i18n:** seletor de locale no footer; tagline novo; namespaces `criar` (prompt aberto), `curadoria`/`admin`/`moderacao` (console). Paridade pt-BR/en-US obrigatória (teste recursivo).

## Próxima sessão — **FORK DE DIREÇÃO** (o usuário escolhe; em CHAT)

Restam **2 fatias do épico #53**, ambas **multi-blocker** (o épico segue 8/10; o prompt aberto #88 foi bônus fora do épico):
- **#60** Modo conversa (chat) ← **#12** (streaming + destilação p/ Receita), **#15** (persistência, retomada, apagar transcript). **O prompt aberto (#88) já pavimentou:** chat = prompt aberto + multi-turno; #12 (streaming) é o blocker fundacional (estender o seam `src/server/claude/client.ts`, hoje single-shot via `FakeClaudeClient`).
- **#61** Minhas criações + editar/derivar ← **#17** (derivada), **#20** (regeneração), **#21** (edição in-place + apagar), **#22** (anônimo efêmero). 4 blockers — a maior.

**Recomendação:** pergunta de direção em chat; default sensato = **#60** (menos blockers que #61, feature de destaque, já pavimentada pelo #88). Cada blocker de backend = `tdd` + integração Postgres; cada UI = workflow de UI reusável; backend+UI da mesma fatia na mesma sessão quando der (vertical slice, como #16→#62, #18→#63, #87→#88).

## Followups / itens abertos (não bloqueiam)

- **#78** confirmar migrate-on-build no deploy (preview deploys passam; falta o build log); **#79** limpeza `neon_auth`. Baixa prioridade.
- **#16/#62:** expor `voteCount` no DTO `SearchResult` → voto/contagem por-resultado na busca (hoje só no detalhe).
- **#18 (low):** dedup/rate-limit de report (índice parcial único); paginação da fila do Curador; cap no motivo; extrair helper `loadPoolGate` único.
- Tom: tagline (#1 escolhida; alternativas no PR #91) e o exemplo do placeholder do prompt aberto são trocáveis.
- drizzle: regenerar/commitar snapshots meta 0005/0006 (limpeza definitiva; já mitigado de fato).

## Landmines / gotchas de ambiente (CONFIRMADOS)

- **Green-gate autoritativo roda SOZINHO** (sem Workflow concorrente — mesma árvore, uma branch por vez): `npm run typecheck` && `npm run lint` && `npm test` (= `vitest run`, node+ui, ~330s; `TEST_DATABASE_URL` no env) && `BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build`. **O green-gate completo pegou DUAS regressões esta sessão** que os runs direcionados dos workflows não pegaram (uma asserção `CREATION_MODES` desatualizada; etc.) — por isso SEMPRE rode a suíte inteira na integração, nunca confie só nos targeted runs do workflow.
- **NÃO editar a árvore enquanto um Workflow roda** nela (mesma working tree). Trabalho "em paralelo" = decidir/propor enquanto o workflow cozinha; as EDIÇÕES serializam (workflow termina/mergeia → então edita).
- **`next build` exige `BETTER_AUTH_SECRET` (≥32 chars)**. Ruído inofensivo do jsdom: "Not implemented: navigation".
- **Relatórios de workflow vêm PARCIAIS** (`filesChanged`/`i18nKeysAdded`): SEMPRE `git status --porcelain` + `git diff --stat origin/main`; LEIA o que parece placeholder (o #63 escondeu um placeholder → virou #85). Reusos podem tocar arquivos de outras fatias legitimamente (ex.: `SortToggle` genérico tocou `search-experience` do #62) — confirme via suíte.
- **Branch de `origin/main`**; `git push` após commit; squash-merge `gh pr merge <N> --squash --delete-branch` + `git fetch --prune`; **`Closes #N` em INGLÊS** no corpo do PR (fechou tudo sozinho). Gate real = check **`checks`** (~2-3min); Vercel não-bloqueante mas passou em todos (migra branch Neon cópia-de-prod → prova as migrations, incl. `ALTER TYPE ADD VALUE` da 0009).
- **`AskUserQuestion` perde texto ao rejeitar** → fork de direção/autorizações em **chat**. **Rascunho de plano** do workflow de UI → `rm -rf docs/plans` antes do `git add`. NUNCA commitar `.playwright-mcp/`/screenshots/probes. Handoffs/PRs via branch (classificador bloqueia direto no main).

## Ler primeiro (no repo / GitHub — não duplicado aqui)

- **Épico #53** (8/10; #60/#61 + blockers), **PRD #1**, **`CONTEXT.md`**, **ADRs** `0003` (voto/favorito/popularidade/moderação), `0004` (Aviso âmbar), `0006` (sessão de criação — agora com `free_text`), `0008` (tiering), `0009` (advisory/schema único), `0010` (route handlers via fetch), `0011` (gating), `0013` (playful⇒privada), `0015` (design/accent).
- **Diffs das PRs #89–#92** pro detalhe. **Handoffs 19 e 20** pro contexto de Comunidade e Admin/Moderação.
- **Workflows parametrizados** (reusar/adaptar): UI em `/home/ferna/.claude/projects/-home-ferna-projects-refogando/0673a830-e78f-459e-bb9f-e8da4a1b1267/workflows/scripts/implement-ui-slice-wf_082836b0-e42.js`; backend em `.../bff6210f-.../workflows/scripts/backend-slice-{16-comunidade,18-moderacao,87-88-prompt-aberto}-*.js`.
- **Seam de geração a estender p/ #60:** `src/server/claude/client.ts` (hoje single-shot; #12 = streaming) e `src/domain/{briefing,generation,recipe-gen-schema}.ts`.

## Critério de saída (da próxima fase)

UI vertical: verde em lint/types/`npm test` (node+ui) + `next build` com secret; jsdom cobrindo as jornadas; `/impeccable`; squash-merge + issue fechada + épico atualizado. Backend: `tdd` + integração Postgres + migration limpa (grep). Ao fim, `/handoff` → `docs/handoffs/22-*.md`.

## Suggested skills

- **Pergunta de direção** (chat) antes de tudo — #60 vs #61.
- **`Workflow`** (UI reusável + backend adaptável); loop principal só orquestra/integra/green-gate-solo.
- **`tdd`** + integração Postgres — blockers de #60 (#12,#15) ou #61 (#17,#20,#21,#22).
- **`/impeccable`** — fatias de UI. **`triage`** — ao mover issues.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. Na sessão anterior foram entregues e mergeadas: o MODO PROMPT ABERTO (texto livre → Receita) ponta-a-ponta — #87 (Aviso de restrição pós-geração, transversal) backend PR #90 + #88 (modo free_text) backend PR #90 e UI PR #92 —, o form de Receita de catálogo #85 (PR #89, fecha o placeholder do console /admin), e um polish (PR #91): tagline novo "Cozinhe qualquer ideia"/"Cook up any idea" (sem menção a localização), seletor de idioma movido pro footer, e o script npm run grant-role pra criar o primeiro admin. Estado final em main 712f67b, full suite 733/733. Comece lendo o handoff @docs/handoffs/21-prompt-aberto-87-88-mais-polish-proxima-60-ou-61.md (o que foi entregue e onde, as convenções fixadas, os 3+1 workflows parametrizados, os followups, e o estado dos blockers restantes). A PRIORIDADE #0 de prod (login 500) está RESOLVIDA desde várias sessões (migrate-on-build em vercel.json/PR #77, provado pelos preview deploys); só restam residuais baixa-prioridade #78 (confirmar migrate-on-build pelo build log) e #79 (limpeza neon_auth). GANHOS TRANSVERSAIS que você herda: (1) requireRole é FAIL-CLOSED em todo o app (guard.ts: if decideRole(...) !== 'allow' return 403) — mas NÃO confie nos comentários de guard.ts/access.ts, verifique o fluxo; (2) o DDL fantasma do drizzle se resolveu a partir do snapshot 0007 (0008 e 0009 saíram limpas) — ainda faça grep search_vector|hnsw|gin em migration nova (cuidado: "gin" casa substring de "origin"); (3) o gate de POOL tem 3 dimensões ortogonais — (owner NULL OR visibility public) [#13], result_kind != playful [ADR-0013], moderation_removed_at IS NULL [#18] — fonte única em src/domain/recipe-pool.ts (eligibleForPool); (4) o Aviso de restrição agora roda PÓS-geração (decidePostGenerationRestrictionNotices, escaneia a receita gerada, união pré+pós) além do pré; (5) CreationMode = conversation|structured|free_text, free_text guarda o texto cru em creation_session.free_text e reusa generateRecipe/classify/persist (estrutura vem da saída, não pré-parse). Processo: pipeline de 8 passos do CLAUDE.md, cada passo em subagente fresco (Agent pra um passo, Workflow pra fan-out) — o loop principal SÓ orquestra, integra e roda o green-gate AUTORITATIVO SOZINHO; há workflows parametrizados prontos: UI reusável em /home/ferna/.claude/projects/-home-ferna-projects-refogando/0673a830-e78f-459e-bb9f-e8da4a1b1267/workflows/scripts/implement-ui-slice-wf_082836b0-e42.js (args {issue,title,branch,planSlug,routeFiles,consumes,acceptance,sliceGuidance,deps}; roda vitest --project ui+typecheck+lint; escreve rascunho em docs/plans/ que VOCÊ remove com rm -rf docs/plans antes do commit) e três de BACKEND (TDD red→green + gera migration) em /home/ferna/.claude/projects/-home-ferna-projects-refogando/bff6210f-760e-464e-9d9a-5139c3a62a17/workflows/scripts/backend-slice-{16-comunidade,18-moderacao,87-88-prompt-aberto}-*.js (adapte CTX/lentes/ACs). SEMPRE verifique o relatório do workflow contra a árvore real (git status --porcelain / git diff --stat origin/main) — filesChanged/i18nKeysAdded vêm PARCIAIS — e LEIA o que parecer placeholder. Rode o green-gate completo SOZINHO (npm run typecheck && npm run lint && npm test [node+ui ~330s, TEST_DATABASE_URL no env] && BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build): ele pegou duas regressões esta sessão que os runs direcionados não pegaram. NÃO edite a árvore enquanto um Workflow estiver rodando nela (mesma working tree, uma branch por vez); paralelize DECIDINDO enquanto o workflow cozinha, e serialize as edições. PRIMEIRA AÇÃO — me pergunte EM CHAT (não no modal, que perde texto ao rejeitar) a DIREÇÃO: restam só 2 fatias do épico #53, ambas multi-blocker — #60 Modo conversa/chat ← #12 (streaming+destilação, estender o seam single-shot de src/server/claude/client.ts) e #15 (persistência/retomada/apagar transcript); #61 Minhas criações ← #17 (derivada), #20 (regeneração), #21 (edição in-place), #22 (anônimo efêmero); recomendo #60 (menos blockers, feature de destaque, JÁ pavimentada pelo prompt aberto #88 — chat = prompt aberto + multi-turno), mas confirme; faça backend (tdd+integração Postgres) e UI (workflow reusável) da mesma fatia na mesma sessão como vertical slice quando der. Gotchas de git: branch de origin/main, git push após cada commit, squash-merge gh pr merge <N> --squash --delete-branch + git fetch --prune, Closes #N em inglês no corpo do PR, gate real é o check checks do GitHub Actions (Vercel não-bloqueante mas passa migrando uma branch Neon cópia-de-prod, incl. ALTER TYPE ADD VALUE), pollar gh pr checks <N> --watch; next build exige BETTER_AUTH_SECRET; NUNCA commitar docs/plans/, .playwright-mcp/, screenshots ou probes; handoffs/PRs sempre via branch. Princípios: CONTEXT.md (termos são lei, URL em inglês), ADRs (0003/0004/0006/0008/0009/0010/0011/0013/0015), receita é o centro e compliance é toque leve, linguagem simples e direta em pt-BR. Ao fim da fase, /handoff → docs/handoffs/22-*.md.
