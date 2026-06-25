# Handoff 38 — avulsas #267/#268/#269 FEITAS; épicos iniciados (#271 web, #274 social spine); #272 núcleo legal FEITO. Próxima: guard-rails do #272 + social #277/#278/#279

**Estado:** 6 PRs entregues nesta sessão, todos na `main` pelo fluxo de 8 passos do `CLAUDE.md`
(explorar → plano → plan-review adversarial → TDD → diff-review adversarial + verify → fix → verde →
squash-merge). **Não re-fazer.** Contexto vivo (leia primeiro): a memória
`novas-requisicoes-social-web-import.md` (decisões ADR-0024/0019 + issues + ordem) e os outros índices
em `MEMORY.md`.

## O que esta sessão entregou (referência — NÃO re-fazer)
Cada item: ver o diff do PR + o comentário de fechamento da issue (têm o detalhe completo).

| Issue | O que | PR / `main` |
|---|---|---|
| **#267** | avatar+nome vira **menu dropdown** (nova primitiva `ui/dropdown-menu.tsx` sobre Radix; Painel/Sair saem da nav→AuthSlot computa o gating; `modal=false` funciona no drawer mobile) | #289 / `48ec5d6` |
| **#268** | reorg da **nav do /admin** (grupos `role=group` Plataforma/Curadoria; navAi→"IA & Descoberta"; Aviso do catálogo → /admin/catalog mas **admin-only via `gateSection('admin')`**) | #290 / `b72d4df` |
| **#269** | **busca de usuários** nos Papéis (nome/@handle/email/ID); seam `searchUsers` (`server/user/search.ts`) **reusável pelo #279**: admin vs público diferem só por `includeEmail`+projeção pura; **email é gate de DADOS** (coluna nem selecionada no público). Extraiu `escapeLike`→`server/sql/like.ts` e `UUID_RE`→`domain/uuid.ts` | #291 / `ecb13ec` |
| **#271** | **provedor Brave** atrás do `WebSearchProvider` seam (query `site:`-por-domínio; fan-out limitado por `MAX_SITE_QUERIES=8`; re-filtra por `isUrlAllowed`; NUNCA lança; fail-closed sem chave) | #292 / `e41628d` |
| **#274** | **spine social**: tabela `user_follow` (migração **0031**), seam `server/user/follow.ts`, API `/api/u/<handle>/follow` POST/DELETE/GET, perfil anon ganha bloco social **SEM ler sessão** (Modelo B), ilha `ProfileFollowSection` | #293 / `3d68bd2` |
| **#272 (PARCIAL)** | importação **para de copiar a camada protegida** (foto+headnote): removeu `descricao` de `ImportedRecipe` (exclusão ESTRUTURAL), imagem já não nascia (guard add). **#272 segue ABERTO** p/ os guard-rails | #294 / `2074663` |

## Próxima ordem de trabalho (ordem livre entre os épicos; HITL por último)

### 1. Terminar #272 (continua ABERTO — o plan-review recomendou FATIAR; ver o comentário em #272)
Três slices independentes, idealmente um PR cada:
- **(a) robots.txt** — respeitar `Disallow` antes do fetch da receita. **Parser PRÓPRIO** (o env bloqueia
  npm novo — NÃO instalar `robots-parser`): pure `domain/robots-txt.ts` `isPathAllowedByRobots(txt,
  uaToken, path)` (grupo do nosso token OU `*`, longest-match com Allow vencendo empate, path =
  pathname+search, case-sensitive no path/insensitive na UA, suportar `*`/`$`, fetch-fail/404/timeout =
  PERMITIDO). Hook DENTRO do `RealRecipeImporter` (o Fake pula → route tests intactos). Nova reason
  `robots_blocked` → **403** (não 422). **GOTCHA:** o `import-recipe-dialog.tsx` hoje lê só `res.status`
  e rotula TODO 422 como "site sem dados estruturados" → precisa plumbar `reason`→mensagem + i18n.
- **(b) rate-limit** ~1 req/s/domínio — `server/import/rate-limit.ts` com clock injetável. **GOTCHA:**
  in-memory no Vercel é best-effort **por-instância** (NÃO garantia global) — documentar como politeness,
  não over-promise. `rate_limited` → **429**.
- **(c) LGPD remover-nome** — rota owner-gated que zera `sourceName` (atribuição cai pro host).
  **404 leak-safe** p/ não-dono/não-importada (ADR-0011, NUNCA 403). Gate em `sourceName != host` (senão
  é no-op invisível). Botão no detalhe (dono de importada com nome real). SEM migração.
- `#276` sign-off jurídico = **HITL** (depende do dono).

### 2. Social #264 (DESTRAVADO pelo #274)
- **#277** feed "Seguindo" + abas (Explorar/Seguindo; só-logado, NÃO-indexável — protege o SEO do
  Modelo B). Reusa `server/user/follow.ts` (listFollowing/o grafo).
- **#278** trilho "Cozinheiros pra seguir" (cascata; v1 = popularidade global).
- **#279** **busca mesclada** Receitas+Cozinheiros por força-de-match — **reusa `searchUsers`/#269** com
  `includeEmail=false` + uma projeção pública própria (`projectPublicCookResult`, sem role/email). Gotcha
  de escala: precisa do índice **pg_trgm GIN** em `users(name/handle)` antes de produção pública (o #269
  deferiu). Rota pública nova (não admin).

### 3. Web #263 (resto)
- **#273** admin: sugestões de import + probe. **#275** 2º gatilho "buscar na web" (destravado pelo #271).

### 4. HITL (por último, com o dono)
- **#270** logo/favicon. **#238** seed do catálogo (fecha o PRD #187). **#276** sign-off jurídico.

## Princípios inegociáveis (validados nesta sessão)
- **Modelo B / anon-cacheável (ADR-0020/0024):** o perfil/`/api/u/[handle]` e a home NÃO personalizam
  por viewer — contadores/listas são públicos no SSR; estado "eu sigo?/votei?" é client-side (ilha). Uma
  leitura de sessão na rota anon quebra o SEO SILENCIOSAMENTE → o `user-follow.test.ts` trava isso com
  "bytes idênticos com/sem cookie".
- **ADR-0019 (import):** copia SÓ fatos; foto + headnote são camada protegida (NÃO copiar); atribuição à
  fonte é OBRIGATÓRIA; allowlist é fonte única; fetch só por ação do usuário.
- **Email é gate de DADOS** (#269): no caminho público a coluna email NEM É SELECIONADA (não basta
  esconder na UI). Mesma tese p/ qualquer PII no #279.
- **Ownership = 404, NUNCA 403** (ADR-0011): não vaza existência.
- **`ROLES` intacto** — Cozinheiro é lente social, não papel.

## Landmines / gotchas de ambiente
- **NUNCA `db:migrate` local** (`.env.local` É PROD). Só `db:generate` (offline) — inspecione o `.sql`.
  Migração **0031** (user_follow) aplica on-deploy.
- **Gate de deploy:** Brave acende só com `WEB_SEARCH_API_KEY` no ambiente (HITL). Sem ela, `Real → []`.
- **npm registry cutoff:** o env BLOQUEIA pacotes recém-publicados → escrever o parser de robots à mão.
- **Suíte node completa flaka local no Neon** → rodar **focado por arquivo** + confiar na CI. UI (jsdom)
  + domain (puro) rodam local sem dor. Teste de seam DB: **semear no `beforeEach`** (o `test/setup.ts`
  trunca no beforeEach global ANTES — semear em `beforeAll` é apagado).
- **`git add -A` varre edições do dono** → `git diff --stat` + stage por caminho.
- **Lint `react-hooks/set-state-in-effect`**: NÃO chamar `setState` SÍNCRONO no corpo de `useEffect` —
  pôr no callback do timer/fetch ou tratar no event handler (pegou em #269 e #274).
- **Repo NÃO tem auto-merge** → `gh pr checks <n> --watch` em background (~5–6 min) → `gh pr merge
  --squash --delete-branch` no foreground. **Branch off `origin/main`** (a local drifta).
- Reusar precedentes: ilha otimista = `recipe-engagement-controls.tsx`; useSession+anon = `auth-slot`/
  `recipe-detail-actions`; primitiva Radix = `ui/sheet.tsx`/`ui/select.tsx`; provider HTTP fetch-mockado
  = o teste do Brave (`test/unit/web-search-provider.test.ts`).

## Pipeline de dev (reusar — pagou MUITO o aluguel nesta sessão)
Por fatia: **explorar** (Explore agents paralelos) → **plano** (scratchpad) → **plan-review adversarial**
(Workflow N-lentes, schema estruturado — pegou: gate de email mal-especificado e testes que iam quebrar
no #269; contadores-vs-listas inconsistentes e GET-state-via-id no #274; o fatiamento do #272) → **TDD**
na branch → **diff-review adversarial 3-lentes + verify-each-finding** (Workflow — pegou a regressão de
anel-de-foco WCAG no #267; rebaixou o "major" do fan-out no #271) → fix → typecheck/lint/i18n-parity +
testes focados → PR → CI verde no foreground → squash-merge → fechar a issue. **O verify-each-finding
filtra os falsos-positivos** (rebaixou achados "major" pra nit com bom raciocínio várias vezes).

## Critério de saída desta perna
3 avulsas (#267/#268/#269) + 2 primeiros-passos de épico (#271 web, #274 social spine) + núcleo legal do
#272 — todos na `main` (`2074663`). Backlog dev-ready: **#272 guard-rails (a/b/c)**, social
**#277/#278/#279**, web **#273/#275**. HITL: #270, #276, #238. Próximo passo concreto sugerido: terminar
o **#272** (robots → 403, rate-limit → 429, LGPD remover-nome → 404) OU iniciar o **#277** (feed Seguindo,
reusa o `user-follow` seam).

## Suggested skills (próxima sessão)
- O **fluxo de 8 passos do CLAUDE.md** cobre tudo. Pegue a issue (`gh issue view <n>`) e rode o pipeline
  (Workflow p/ plan-review + diff-review adversariais).
- `mcp__context7` p/ confirmar contratos de API externos (foi usado p/ o Brave no #271; robots.txt é RFC
  9309 — pode confirmar wildcards `*`/`$` e a regra de longest-match).
- `#270` logo, `#276` sign-off, `#238` seed = **HITL** (dependem do dono — não AFK).
- Se o dono quiser re-grelhar UX antes de codar, `/grill-with-docs`.
