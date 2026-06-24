# Handoff 35 — Estúdio de imagem #221 DEV completo; próxima ordem: tempo-de-preparo #188 (GRILL primeiro) → seed #238 (humano)

**Estado:** o **DEV do épico Estúdio de imagem por IA (#221) está 100% concluído e o épico FECHADO** na `main` (`1a4adde`). As 6 fatias #222–#227 mergeadas (PRs #253–#258), migrações **0025–0028** geradas (aplicam on-deploy). Cada fatia passou pelo pipeline: plano → review adversarial do PLANO (3 lentes) → TDD em worktree isolado → PR → review adversarial do DIFF (3 lentes: correção / aderência-ADR+invariantes / qualidade-de-testes) → fix → squash-merge com CI verde.

Ver o resumo de fechamento em `gh issue view 221` (comentário final) e a memória `image-studio-initiative.md`. **Não re-fazer nada disso.**

## O que esta sessão entregou (referência, não re-fazer)
- **#222** galeria + preview + selecionar/apagar (spine) — PR #253, **migração 0025**. Modelo de linhagem = chave OPACA `lineage_id` em `recipe`+`recipe_image`; reap-on-swap removido; rotas `POST /images/[id]/select` + `DELETE /images/[id]`; `DELETE /image` virou deselect; **derive cross-owner nasce com galeria vazia** (`image_id=NULL`, supera o carry-forward #131 SÓ no cross-owner; regenerate same-owner herda o lineage). Backfill recursivo na 0025.
- **#223** refino ancorado: base read-only no modal + template estruturado em `composeImagePrompt` — PR #254. Sem migração.
- **#224** cost-tracking — PR #255, **migração 0026** (colunas uso/custo nullable no ledger `image_generation`; `computeImageCost` puro com tabela de preço-snapshot; seam devolve `usageMetadata`).
- **#225** moderação × galeria — PR #256. Imagem moderada fica na galeria marcada "removida" + select bloqueado (409); reusa o gate público #133 (placeholder). Sem migração.
- **#226** restrição de conta — PR #257, **migração 0027** (1º gancho do ADR-0007: `users.image_gen_blocked_*` granular, distinto do `banned` inerte; generate 403 `geracao_bloqueada`; Curador bloqueia/desbloqueia na fila de moderação).
- **#227** review_required — PR #258, **migração 0028** (geração COM refino marca a imagem; fila proativa NÃO-bloqueante do Curador em `/admin/moderation`; remove/dismiss; **default-open intacto** — review_required NÃO gateia publicação, ADR-0020).

**Deploy / ops (p/ o dono):** migrações 0025–0028 aplicam no deploy (migrate-on-deploy). **Gotcha pós-deploy:** rodar `SELECT count(*) FROM recipe_image WHERE lineage_id IS NULL` (deve ser **0** — backfill da 0025). **Edge documentado** (corpo do PR #253): Receitas derivadas cross-owner PRÉ-existentes mantêm a face na linhagem da BASE (não vira membro da galeria do derivador; o hero renderiza normal, é só re-selecionar/apagar que não alcança) — candidato a data-fix futuro, não bloqueia.

## Próxima perna A — Tempo de preparo #188 (NÃO é dev direto: GRILL → ADR → migração → issues)
É um **campo invariante novo** da Receita → congela schema → **merece grill ANTES de codar** (`enhancement, needs-triage`; `gh issue view 188`). Rodar **`/grill-with-docs`** e só então fatiar. Furos a resolver (herdados dos handoffs 33/34, ainda válidos):
1. **Passos paralelos/de espera quebram a soma.** "Marinar 8h" + "picar 5 min": somar dá 8h05 de "trabalho", mas só 5 min ativos. Somar tudo superestima.
2. **Tempo ATIVO (mão na massa) ≠ TOTAL (relógio na parede).** schema.org separa `prepTime`/`cookTime`/`totalTime`, e o total **não** é a soma (passos se sobrepõem). Decidir: campo "ativo", "total", ou ambos; e se passo-de-espera entra com flag.
3. **Tie-in de SEO — fecha o follow-up do #234.** O JSON-LD Recipe (#234, já na main) **deixou de fora de propósito** `prepTime`/`cookTime`/`totalTime` (ver review do PR #247). #188 alimenta esses campos → registrar no ADR e plumbar em `buildRecipeJsonLd` (`src/domain/recipe-seo.ts`). A receita nasce/edita com tempo → o detalhe indexável ganha os campos schema.org.
- Saída do grill: ADR + glossário (`CONTEXT.md`) + migração (gerada) + issue(s) refatoradas. Só então dev pelo pipeline provado.
- **Ideia do dono (do handoff 34):** tempo por passo, total = soma — mas o grill precisa resolver os furos 1/2 antes de congelar.

## Próxima perna B — Seed do catálogo #238 (HITL/humano, por último)
`ready-for-human, blocked` (`gh issue view 238`); é o **último filho aberto do épico SEO #187** (por isso #187 segue aberto). Gerar com **nosso AI + curadoria humana** → `origin=catalog`; **NUNCA copiar texto/foto da web** (ADR-0019). **Depende do dono.** Faz sentido por último: agora as sementes já podem nascer com **imagem** (#221 pronto) e, quando #188 landar, com **tempo de preparo** — catálogo indexável completo.

## Pipeline de dev (reusar — provado nesta sessão e nas anteriores)
Por **fatia/onda**: subagente `isolation` (worktree off `origin/main`, hardlink node_modules) implementa com **TDD** → push/PR → **review adversarial 3-lentes** (Workflow com 3 agentes paralelos, schema estruturado) → **fix** dos must/should-fix → **poll de CI** → **squash-merge no foreground quando CI verde** (repo NÃO tem auto-merge) → cleanup do worktree (`git worktree remove --force` + `git branch -D`). Migrações **sequenciais** (cada uma gera off a main atualizada). O review adversarial do PLANO (antes de codar) **pegou o bug derive×galeria-vazia** e o do DIFF **pegou a suíte #130 não-atualizada ao no-reap** e o **leak-guard faltando** — vale o custo.

## Gotchas de ambiente (estáveis)
- **`.env.local` É PROD** — NUNCA `db:migrate`/`db:push` local; **só `npm run db:generate`** (`drizzle-kit generate`) + migrate-on-deploy. Grep o `.sql` novo por DDL não-intencional (`search_vector|hnsw|gin|NOT NULL|DROP`).
- Worktree off `origin/main` + **hardlink** node_modules (`cp -al`, nunca symlink — symlink quebra next build/Turbopack).
- Testar **focado**: `npx vitest run --project=ui <f>` (jsdom, sem DB) / `--project=node <f>` (Postgres real, endpoint **direto/unpooled** — strip `-pooler`). A suíte node completa flaka no Neon concorrente → confiar na CI no resto.
- **Migração na CI:** a suíte node aplica as migrações no DB descartável → a CI exercita a DDL (mas o **backfill** roda só contra dados existentes — DB de teste nasce vazio → backfill é raciocinado, não testado; comentar pré-flight de ops no `.sql`).
- Rota nova estática que usa `getBaseUrlFromEnv` precisa `export const dynamic='force-dynamic'` (não é o caso de rotas de API dinâmicas).
- Commits **via branch + squash PR** (handoffs também); merge **quando CI verde** (sem gate de preview; AFK = subagentes revisam). `requireRole(req,'curador')` é fail-closed.

## Critério de saída (perna A — #188)
Grill conclui → ADR + glossário + migração gerada + issue(s) fatiadas publicadas → dev pelo pipeline → tempo de preparo no schema + na UI de criar/editar + alimentando o JSON-LD (#234) → CI verde, reviews satisfeitos, migração na ordem. Depois: handoff novo apontando p/ #238 (humano).

## Suggested skills (próxima sessão)
- **`/grill-with-docs`** — ANTES do #188 (decisão que congela schema; resolver ativo-vs-espera, ativo-vs-total, e o tie-in JSON-LD do #234). **Não pular o grill.**
- **`to-issues`** — depois do grill, fatiar o #188 em issues (tracer-bullet).
- **`tdd`** — red-green em cada fatia.
- **`Workflow`** — orquestração do review adversarial 3-lentes por PR (e ondas em worktrees se paralelizar).
- **`handoff`** — ao fim da perna A.

---

## Prompt de kickoff — Tempo de preparo #188 (próximo)

```
Retomando o refogando: próxima é a perna de TEMPO DE PREPARO (#188), que é um CAMPO INVARIANTE NOVO da Receita e por isso NÃO é dev direto — rode /grill-with-docs PRIMEIRO. Leia docs/handoffs/35-estudio-imagem-221-dev-completo-proxima-188-grill-238-seed.md + gh issue view 188 + o ADR docs/adr/0020-*.md (SEO/JSON-LD) e o termo de Receita no CONTEXT.md. Contexto: o épico Estúdio de imagem #221 acabou de ser concluído e fechado (main 1a4adde, migrações 0025-0028). O #188 tem 3 furos a resolver no grill antes de congelar schema: (1) passos paralelos/de espera quebram a soma (marinar 8h + picar 5min ≠ 8h05 de trabalho); (2) tempo ATIVO (mão na massa) ≠ TOTAL (relógio na parede) — schema.org separa prepTime/cookTime/totalTime e o total não é a soma; decidir campo ativo/total/ambos + flag de passo-de-espera; (3) tie-in de SEO: o JSON-LD Recipe (#234, na main) deixou prepTime/cookTime/totalTime de fora DE PROPÓSITO esperando o #188 — registrar no ADR e plumbar em buildRecipeJsonLd (src/domain/recipe-seo.ts). A ideia do dono é tempo por passo, total = soma, mas o grill precisa fechar os furos 1/2. Saída do grill: ADR + glossário (CONTEXT.md) + migração GERADA (.env.local é PROD, nunca db:migrate local) + issue(s) refatoradas via /to-issues; só então dev pelo pipeline provado (worktree off origin/main + hardlink node_modules, TDD, PR, review adversarial 3-lentes via Workflow, squash-merge quando CI verde — repo sem auto-merge). Depois do #188 vem #238 (seed do catálogo, HITL/humano, blocked, último filho aberto do épico SEO #187 — depende do dono; gerar-com-nosso-AI + curadoria, origin=catalog, NUNCA copiar web, ADR-0019). NÃO comece o #188 sem grill nem o #238 (depende do dono).
```
