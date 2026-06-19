# Handoff 24 — **`/recipes` virou feed** (#103, substitui o browse #98) · épico de UI #53 segue FECHADO · próxima: **#104 (chatbot) é DECISÃO DE PRODUTO** ou tech-debt

**Continua a 23** (épico de UI #53 completo 10/10 e fechado). Esta sessão NÃO abriu fatia de épico — atacou um **bug pontual de UX** que sobrou e virou uma feature: o link **"Receitas" do nav → `/recipes` era link morto** (a rota nunca existiu; só `/recipes/[id]`, o detalhe). Esboçado no shell #54; a #56 fez a busca/browse virar a home `/` e ninguém reconciliou o nav → **404**. Consertei em duas etapas (a 2ª substitui a 1ª, a pedido do owner).

| Entrega | PR | O que (fonte de verdade: `gh pr diff <N>`) |
|---|---|---|
| **#98** Browse `/recipes` (facetado) | **#100** (merge) | `browse=1` no `/api/search` (lista o pool sem texto) + página `/recipes` com facetas. **Owner reagiu: "é a home menos o input, redundante."** → substituída pela #103 |
| **#103** `/recipes` vira **FEED** | **#105** (merge) | Feed plano cronológico (mais novos 1º), **scroll infinito, SEM filtros**. **Novo `GET /api/feed`** (cursor keyset). **REMOVE o `browse=1`** de #98 (search.ts/route.ts voltam ao estado pré-#98). Fecha #103 |
| **#104** Conversa como chatbot flutuante | — (OPEN, `needs-triage`) | **Ideia do owner, NÃO implementada.** Issue de DESIGN: bolha lateral em vez da página `/conversation`; folding do prompt aberto. Minha recomendação registrada na issue |

Estado em `main` ao mergear o #105: **`bbe6629`** (já se moveu — outras sessões mergearam #20/#21 no meio). Disciplina de worktree usada do início ao fim (`refogando-wt-98`, depois `refogando-wt-feed`); ambos removidos.

## O feed (#103) — arquitetura (o que a próxima sessão precisa saber)

- **`GET /api/feed?cursor=&limit=&locale=`** (`src/app/api/feed/route.ts`, runtime nodejs, anônimo ADR-0011). Route fino: canonicaliza locale, delega ao `loadFeed`, display ao `buildFeedResponse`. Borda **permissiva**: `limit` inválido → default (20, teto 50); `cursor` malformado → começo do feed, **nunca 400/500**.
- **`loadFeed`** (`src/server/recipe/feed.ts`): query SQL auto-contida, keyset `(created_at, id) < (cursor)` sob `ORDER BY created_at DESC, id DESC`, `LIMIT n+1`. **NÃO reusa `displayTailSql`** da busca (que pende de um CTE `numbered` sem `created_at`, que o cursor precisa) — reusa o **padrão** de double-LEFT-JOIN de tradução + o **gate de leitura canônico** (mesma grafia da busca). `created_at::text` no SELECT pro cursor round-tripar com precisão.
- **`recipe-feed-read.ts`** (domínio puro): `FeedHitRow = SearchHitRow & {created_at}`, `FeedResponse = {feed, nextCursor}`, `encodeCursor/decodeCursor` (base64 de `{c,i}`), `buildFeedResponse` (limit+1 → hasMore; nextCursor da ÚLTIMA linha da página). Reusa **`projectResult`** (agora **exportado** de `recipe-search-read.ts`).
- **`recipe-feed-experience.tsx`**: `IntersectionObserver` num sentinel auto-carrega + botão "Carregar mais" como **fallback acessível** (montado enquanto há mais, `disabled`+`aria-busy` ao carregar — preserva foco). `<ul>` FORA da live region (append não floda o leitor). i18n seção `feed` (substituiu `browse`).
- **v1 consciente:** SEM índice composto `(created_at, id)` ainda — Sort sobre o gate (tabelas minúsculas), como a busca defere os dela.

## ⚠️ Achado de segurança do review (corrigido — padrão a repetir)

O code-review adversarial multi-lente pegou um **500 anônimo de 1 requisição**: `decodeCursor` validava só a FORMA do objeto; um cursor base64 **bem-formado** com valor lixo (`{"c":"not-a-timestamp","i":"not-a-uuid"}`) passava e estourava o cast `::timestamptz`/`::uuid` no SQL (a rota não tem try/catch, de propósito). **Fix:** `decodeCursor` valida o VALOR (regex UUID + timestamptz textual) → cursor inválido vira `null` → começo do feed. Regressão `feed.test.ts` AC4 (`btoa({c:'not-a-timestamp',...})` → 200, não 500). **Lição:** toda borda "permissiva" precisa validar VALOR, não só forma, quando o valor vira cast SQL. (O review também pegou: encalhe em página vazia-com-cursor, falha de carregar-mais silenciosa, foco/aria-busy, flood de live region — todos aplicados.)

## 🔻 Tech-debt que esta sessão AGRAVOU (priorize #52)

**O gate de leitura canônico (`owner_id IS NULL OR visibility='public'` AND não-playful AND não-removida) agora está replicado em TRÊS lugares:** `src/domain/recipe-pool.ts`, `src/server/recipe/search.ts` (CTE `visible` + `semantic` + `ingredient_raw_hit`) e agora `src/server/recipe/feed.ts`. **#52** (OPEN, `enhancement`) é exatamente "extrair pra fonte única" — ficou mais relevante. Ao mexer no gate, mexa nos 3 (ou faça o #52 antes). O feed.ts tem o comentário-marcador `-- gate de pool #18: ver recipe-pool.ts` em paridade com a busca.

## Próxima fase — **direção do owner** (não há fatia óbvia; o épico acabou)

O owner sinalizou que **#104 (chatbot) "parece a última que deveríamos trabalhar"**. Mas **#104 é uma DECISÃO DE PRODUTO, não uma fatia pronta** — NÃO saia implementando uma bolha. Primeiro **alinhe o design** (em chat / `/grill-with-docs`), depois `/to-issues`, depois implemente. Pontos a decidir (já na issue #104):
1. Bolha flutuante **substitui** `/conversation` ou **expande** pra ela? (recomendação minha: expande — o fluxo Conversa tem artefato rico já pronto: streaming, destilação→Receita, transcript durável #15; bolha apertada pra isso).
2. **Fundir o prompt aberto (free_text, #88) no chatbot** → deixar **Criar = só estruturada**? (afia a distinção das telas).
3. Contextualidade: a bolha conversa referenciando a tela atual (ex.: "deixa isso vegano" vendo uma Receita)? (é o ganho real do padrão flutuante).

Alternativas se o owner não quiser #104 agora: **#52** (consolidar o gate — agora 3 réplicas), **#51** (requireRole fail-open — bug de segurança, ver [[requireRole-fail-open-despite-comments]]), **#78** (confirmar migrate-on-deploy pelo build log), **#79** (limpar `neon_auth`), ou **QA da jornada** (`/qa`/`/verify` rodando o app de verdade).

## Itens abertos / não bloqueiam

- **`feat/recipes-browse-all` (local, dir compartilhado) + `stash@{0}`**: resíduo do tangle de #98 com a sessão #17 (descrito na handoff 23 pelo outro lado). **#98 já está na main**, então o `stash@{0}` (era o WIP de browse) é **redundante** — `git stash drop` quando confirmar. A branch carregava wip de #17, mas #17 já mergeou (PR#99) — provavelmente dá pra apagar. **Não é da sessão atual mexer sem o owner confirmar** que não há nada único.
- O `browse=1` foi REMOVIDO do `/api/search` no #103 — se algum consumidor futuro quiser "listar tudo via busca", reintroduzir (mas o feed cobre o caso).

## Ler primeiro (no repo / GitHub — não duplicado aqui)

- **Handoff 23** (`docs/handoffs/23-*.md`) — épico completo, arquitetura de linhagem/edição, decisão anon read-only, e a **disciplina de WORKTREE** (Landmine #1, herdada verbatim — worktree dedicado, hardlink node_modules NÃO symlink, endpoint Postgres DIRETO `${TEST_DATABASE_URL//-pooler/}`, rebase quando origin/main avança, diff 3-dot).
- **PRD #1**, **`CONTEXT.md`**, ADRs `0010` (UI consome route handlers via fetch, não Server Actions), `0011` (anon read-only), `0003` (Catálogo editorial ignora sort).
- **Diffs PR #100 (#98) e #105 (#103)** pro detalhe. **Issue #104** pra a discussão do chatbot.
- Seams do feed: `src/app/api/feed/route.ts`, `src/server/recipe/feed.ts`, `src/domain/recipe-feed-read.ts`, `src/components/recipe/recipe-feed-experience.tsx`, `src/app/recipes/page.tsx`. Reuso: `src/domain/recipe-search-read.ts` (`projectResult` exportado).

## Critério de saída (atingido)

#103 mergeado (PR#105), #103 fechado, #104 registrado. Green-gate verde no worktree: typecheck/lint/`next build` (`/api/feed`+`/recipes` no manifesto) + 134 UI + integração (feed: pool+gate não-vácuo, paginação por cursor sem overlap, cursor inválido permissivo, **cursor forjado→200 não 500**; + regressão de busca #6/#9/#10/#14/#16 confirmando a reversão do browse). Sem fase de saída pendente — a próxima sessão define o objetivo com o owner.

## Suggested skills

- **Decisão de #104 em CHAT** (modal perde texto) — primeira ação se o owner escolher o chatbot: alinhe o design (bolha-expande-vs-substitui, folding do prompt aberto) ANTES de codar. **`/grill-with-docs`** pra cravar termos/ADR; depois **`/to-issues`**.
- **`/to-prd` → `/to-issues`** se virar feature/épico maior.
- **`Workflow`** (explore → plan-com-review → code-review multi-lente com verificação adversarial) + **`Agent` PRESO ao worktree** pra implementar; **`tdd`** + integração Postgres (endpoint direto) pro backend; **`/impeccable`** pra UI.
- **`/qa`** / **`/verify`** se a direção for endurecer/validar a jornada.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. O épico de UI #53 está FECHADO (10/10) e a sessão anterior consertou o último buraco de UX: o nav "Receitas"→`/recipes` era link morto, e `/recipes` agora é um **FEED** cronológico com scroll infinito (#103, PR#105 mergeado — substituiu o browse facetado #98/PR#100 e REMOVEU o `browse=1` do /api/search). Comece lendo o handoff @docs/handoffs/24-recipes-feed-103-substitui-browse-98-proxima-104-chatbot.md (a arquitetura do feed: `GET /api/feed` com cursor keyset em `(created_at,id)`, gate de leitura canônico, `projectResult` reusado; o achado de SEGURANÇA do review — cursor base64 bem-formado com valor lixo estourava o cast SQL → 500 anônimo, agora `decodeCursor` valida VALOR; e o tech-debt AGRAVADO: o gate canônico agora está replicado em 3 lugares — recipe-pool.ts, search.ts E feed.ts — ver #52) e o handoff 23 (@docs/handoffs/23-minhas-criacoes-61-epico-ui-completo-10-10-proxima-direcao.md) pra a disciplina de WORKTREE e a arquitetura de linhagem. PRIMEIRA AÇÃO: NÃO há fatia pronta na fila. O owner sinalizou que **#104 (Conversa como chatbot flutuante) "parece a última que deveríamos trabalhar"** — mas #104 é uma DECISÃO DE PRODUTO, não uma fatia: me pergunte EM CHAT (não no modal, que perde texto) se quer (a) alinhar o design do #104 e fatiá-lo [bolha flutuante SUBSTITUI vs EXPANDE pra /conversation/[id]; fundir o prompt aberto #88 no chatbot deixando Criar = só estruturada; conversa contextual referenciando a tela atual], (b) atacar tech-debt [#52 consolidar o gate de leitura agora replicado 3x; #51 requireRole fail-open — bug de segurança; #78 confirmar migrate-on-deploy; #79 limpar neon_auth], ou (c) QA da jornada ponta-a-ponta (`/qa`/`/verify`). Se for #104, alinhe o design em chat / `/grill-with-docs` ANTES de codar, depois `/to-issues`. DISCIPLINA INEGOCIÁVEL (múltiplas sessões compartilham o working dir e JÁ COLIDIRAM): trabalhe SEMPRE num worktree dedicado (`git worktree add -b feat/<n> ../refogando-wt-<x> origin/main`), hardlink-copie node_modules (`cp -al`, NUNCA symlink — quebra next build/Turbopack), use o endpoint DIRETO do Postgres nos testes (`TEST_DATABASE_URL="${TEST_DATABASE_URL//-pooler/}"`, senão o pooler concorrente derruba a suíte node inteira), e ANTES de cada green-gate `git fetch` + cheque se origin/main avançou (a outra sessão mergeia por baixo de você — se avançou e tocou seus arquivos, `git rebase origin/main` e green-gate o estado REAL de merge; diff 3-dot `origin/main...HEAD`, o 2-dot engana). `git push --force-with-lease` funciona em branch de feature; verifique a propagação com `git ls-remote`. NÃO toque no dir compartilhado /home/ferna/projects/refogando nem no `feat/recipes-browse-all`/`stash@{0}` (resíduo de outra sessão; o stash é redundante pós-#98 mas não é seu pra dropar sem o owner). Processo: pipeline de 8 passos do CLAUDE.md, cada passo em subagente fresco PRESO ao worktree (Agent pra implementar — sequencial; Workflow read-only pra explorar/planejar-com-review/code-review multi-lente com verificação adversarial — aplique só os achados CONFIRMADOS, o review pega bugs reais: pegou o 500 do cursor nesta sessão). O loop principal SÓ orquestra/integra e roda o GREEN-GATE autoritativo SOZINHO no worktree (npm run typecheck && npm run lint && TEST_DATABASE_URL=direto npm test [node+ui] && BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build) após CADA implementação E fix. Gotchas: branch de origin/main, Closes #N em inglês, squash-merge `gh pr merge <N> --squash --delete-branch` + `git fetch --prune` + remover o worktree, gate real é o check "checks" (Vercel não-bloqueante), next build exige BETTER_AUTH_SECRET, NUNCA commitar docs/plans/.playwright-mcp/screenshots/e2e specs (a seam de teste de frontend é jsdom em test/ui/), db:generate (NÃO db:migrate) + grep search_vector|hnsw|using gin em migration nova. Princípios: CONTEXT.md (termos são lei, URL em inglês — /recipes, /feed), ADRs (0010 fetch não Server Actions / 0011 anon read-only / 0003 Catálogo ignora sort), receita é o centro e compliance é toque leve, linguagem simples e direta em pt-BR, decisões reversíveis você decide (não bikeshed) e só grila o irreversível. Ao fim da fase, /handoff → docs/handoffs/25-*.md.
