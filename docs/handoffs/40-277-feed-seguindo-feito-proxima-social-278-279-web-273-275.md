# Handoff 40 — #277 (feed Seguindo) FEITO; próximas: social #278/#279, web #273/#275 (paralelizáveis)

**Estado:** o **#277 (feed Seguindo + abas Explorar/Seguindo)** fechou (`main c802201`, PR #300, pelo
fluxo de 8 passos do `CLAUDE.md`). Restam **4 issues dev-ready** (todos os bloqueios já resolvidos) +
3 HITL. Contexto vivo (leia primeiro): a memória de projeto `novas-requisicoes-social-web-import.md`
+ os índices em `MEMORY.md`.

## O que esta sessão entregou (referência — NÃO re-fazer)
Ver o diff do **PR #300** + o comentário de fechamento da **#277** (detalhe completo).

| Parte | Onde | O quê |
|---|---|---|
| Loader | `src/server/recipe/feed.ts` | `feedQuery` **extraído** (template único) → `loadFeed` (wrapper, byte-idêntico) + **`loadFollowingFeed`**. Gate via `followeesPublicSqlFragment`. |
| Gate SQL | `src/server/recipe/visibility-sql.ts` | **`followeesPublicSqlFragment(alias, ids)`** = `visibility='public' AND origin<>'web_imported' AND owner_id IN (ids)`. Catálogo sai por `NULL ∉ IN`; constantes (playful/removida) + imagem moderada herdadas do template. `sql.join(ids.map(id => sql\`${id}::uuid\`))` (bind por id; **requer ids não-vazio** — caller curto-circuita). |
| Seam | `src/server/user/follow.ts` | **`listFollowingIds`** (alive-gated, server-only, sem limit). |
| Rota | `src/app/api/feed/following/route.ts` | **SÓ-logada** (`requireSession`→401 anon/desativada), **`Cache-Control: no-store`** (per-viewer). `parseFeedLimit` extraído p/ `recipe-feed-read.ts` (fonte única das 2 rotas). |
| Página | `src/app/[locale]/following/page.tsx` | Server fina; locale de `params` (URL, ADR-0020); `generateMetadata` **noindex**. |
| Ilha | `src/components/recipe/following-feed.tsx` | Fetch **COM cookie** (oposto do `DiscoveryFeed` `omit`); **reset atômico por locale** (`cursorRef.current=null` SÍNCRONO no corpo do effect); empty state cause-neutro `<h2>` fora da live region. |
| Nav | `src/components/site-header.tsx` | Rótulo **Explorar/Explore** (valor de `nav.home`, key mantido) + aba **Seguindo/Following** (logado, desktop+mobile) + **`isActive` locale-aware** (`splitLocalePrefix`). |
| i18n | `pt-BR.ts`/`en-US.ts` | `nav.home` (valor), `nav.seguindo`, namespace `seguindoFeed`. |

**Achados-chave reusáveis:**
- O **plan-review adversarial (5 lentes)** pegou ANTES de codar: faltava `no-store`, faltava
  `origin<>'web_imported'` defense-in-depth, o `isActive` estava quebrado sob locale-prefix, e o reset
  precisava ser atômico.
- O **diff-review adversarial (3 lentes + verify-each)** pegou **1 race REAL** que o plan-review não viu:
  `cursorRef.current=null` deferido no `setTimeout` vs o callback inicial do `IntersectionObserver` ao
  trocar de locale → podia abortar a página-1 e travar em 'loading'. **Lição (de novo): rode o
  diff-review sobre o CÓDIGO.** O verify-each rebaixou 6 falsos-positivos honestamente.

## Próxima ordem de trabalho — 4 dev-ready, todos DESTRAVADOS

Dependências (todas já resolvidas): **#278**←#274 ✅ · **#279**←#269 ✅ · **#273**←(nada) · **#275**←#271 ✅.

### Recomendado: **#278 a seguir** (fecha o loop do #277)
- **#278** "Cozinheiros pra seguir" (trilho recomendados, v1 = popularidade global, sem boost
  personalizado). É a **ponte que o empty state do #277 já aponta** (a CTA `seguindoFeed.vazioCta`
  "Explorar receitas" é o placeholder; quando #278 existir, o rótulo volta a "Descobrir cozinheiros").
  Query nova de popularidade + **excluir já-seguidos** (reusa o grafo `user_follow`/#274) + trilho na UI.
  **SEM migração.** Superfície: feed/home — pouco overlap com busca/admin.

### Paralelização (worktrees off `origin/main`)
- ✅ **Par seguro p/ 2 agentes: #278 + #273** — superfícies **independentes** (trilho social no feed
  ×  admin de import). Zero overlap, nenhuma migração compartilhada.
- ⚠️ **#279 e #275 NÃO em paralelo entre si** — ambos tocam a **superfície da Busca**
  (`search-experience` / `/api/search` / `search.ts`) → conflito. **Sequencie:** #279 → depois #275.
- ⚠️ **#279 GERA MIGRAÇÃO** (índice **pg_trgm GIN em `users(name/handle)`** que o #269 deferiu) — mantenha
  #279 como a **única** issue com migração em voo (worktrees paralelos + 2 migrações = colisão de número,
  ex.: `0032`). Só `db:generate` (offline) — **NUNCA `db:migrate` local** (`.env.local` é prod).

### Detalhe das outras 3
- **#279** busca mesclada Receitas+Cozinheiros por força-de-match — **reusa `searchUsers`
  (`server/user/search.ts`, #269)** com `includeEmail=false` + projeção pública própria. Email é **gate
  de DADOS** (coluna nem selecionada no caminho público). **Gera a migração pg_trgm GIN.**
- **#273** admin: domínios sugeridos click-to-add + probe de saúde (JSON-LD + robots). **Isolado** (área
  admin). Sem migração. Pode parar agora.
- **#275** 2º gatilho "buscar na web" no fim dos resultados (destravado por #271). Toca a Busca → **depois
  do #279**.

### HITL (por último, com o dono — NÃO-AFK)
- **#270** logo/favicon/OG. **#276** sign-off jurídico PI/LGPD + takedown (blocked; inclui PII no *path*
  do `source_url`). **#238** seed do catálogo (blocked; fecha o PRD #187 e o épico SEO).

## Princípios inegociáveis (revalidados)
- **Modelo B (ADR-0020/0024):** a home `/` e o perfil/`/api/u/[handle]` NÃO personalizam por viewer
  (anon-cacheável, byte-idêntico c/ e sem cookie). Superfícies personalizadas (feed Seguindo, futuros
  trilhos personalizados) são **separadas, só-logadas e não-indexáveis**. O #278 v1 é **popularidade
  GLOBAL** (não-personalizada) → pode até viver numa superfície anon; só não personalize a home.
- **Email/PII é gate de DADOS** (#269): no caminho público a coluna nem é selecionada. Mesma tese p/ #279.
- **Ownership = 404, NUNCA 403** (ADR-0011) p/ existência; rotas só-logadas usam 401 anon.
- **`ROLES` intacto** — Cozinheiro é lente social, não papel.
- **Pool gate = fonte única** (`domain/recipe-pool.ts eligibleForPool`); gates SQL crus replicam com
  comentário apontando pra lá (ou reusam os fragmentos de `visibility-sql.ts`).

## Landmines / gotchas de ambiente (reusáveis)
- **NUNCA `db:migrate` local** (`.env.local` É PROD). Só `db:generate` (offline) — inspecione o `.sql`.
  **#279 terá migração** (pg_trgm GIN); as outras 3 não.
- **`system-reminder` de "GitHub rate limit excedido"** = **FALSO ALARME** do harness (`gh api rate_limit`
  → 5000/5000). Verifique, não pare.
- **CI do Actions com LATÊNCIA** (~2min pro run aparecer) + um 2º push **CANCELA** o anterior
  (`concurrency` do `ci.yml`). `gh pr checks <n>` segue o head; espere o run surgir antes de concluir.
- **"Fecha #N" (PT) NÃO é keyword de fechamento do GitHub** — o PR #300 não auto-fechou #277 (fechei à
  mão). Use **close/fix/resolve** em inglês no corpo do PR se quiser auto-close.
- **Suíte node flaka local no Neon** com a suíte inteira → rode **focado por arquivo**. UI (jsdom) +
  domínio (puro) rodam local sem dor. Testcontainers sobe pgvector (precisa Docker); seam DB: semear no
  `beforeEach` (setup trunca antes); `translation_provenance` use `escrita_por_pessoa`/`automatica_*`
  (não inventar); **`recipe_playful_private_chk`**: playful ⇒ sempre private (não semeie playful público).
- **`git add` seletivo** (não varrer edições do dono) → `git diff --cached --stat` antes do commit.
- **Repo SEM auto-merge** → `gh pr merge --squash --delete-branch` no foreground quando CI verde.
  **Branch off `origin/main`** (a local drifta). **Worktree isolado** por agente em waves paralelas
  (hardlink node_modules; endpoint DIRETO do DB nos testes, sem `-pooler`).

## Reusar precedentes
- Feed loader + cursor keyset: `server/recipe/feed.ts` (`feedQuery` template); DTO `domain/recipe-feed-read.ts`.
- Ilha client com paginação por cursor: `discovery-feed.tsx` (seeded/anon) ou `following-feed.tsx`
  (cookie/reset-locale). **Tech-debt aberto:** extrair `useCursorFeed` (cursor/observer duplicados entre
  os dois) — bom 1º passo se for mexer em ambos.
- Lista só-logada client (guard de sessão + fetch com cookie): `my-recipes-list.tsx`.
- Busca de usuário (público vs admin difere só por `includeEmail`+projeção): `server/user/search.ts` (#269).
- Rota só-logada 401 + no-store per-viewer: `api/feed/following/route.ts` + `api/u/[handle]/follow` GET.
- Trilho/seção na superfície de descoberta: ver `search-experience.tsx` (seções) + `discovery-feed.tsx`.

## Pipeline de dev (reusar — pagou MUITO o aluguel)
Por fatia: **explorar** (Workflow, Explore agents paralelos) → **plano** (scratchpad) → **plan-review
adversarial** (Workflow N-lentes, schema estruturado) → **TDD** na branch/worktree off `origin/main` →
**diff-review adversarial 3-lentes + verify-each** (Workflow — é o que pega bug REAL) → fix →
typecheck/lint/i18n-parity + testes focados → PR → CI verde no foreground → squash-merge → fechar a issue
(keyword em inglês ou `gh issue close`).

## Critério de saída desta perna
#277 na `main` e **issue FECHADA** ✅. Backlog dev-ready: social **#278/#279**, web **#273/#275**.
HITL: #270, #276, #238. **Próximo passo concreto sugerido:** `gh issue view 278` e rodar o pipeline
(ou par paralelo **#278 + #273** em worktrees). #279 depois (com a migração pg_trgm GIN), #275 após #279.
