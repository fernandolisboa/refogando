# Handoff 39 — #272 guard-rails COMPLETOS (importação segura fechada); próxima: social #277 (feed Seguindo)

**Estado:** o épico de **importação segura #272 fechou** (4 PRs squash na `main`, todos pelo fluxo de 8
passos do `CLAUDE.md`). A próxima perna dev-ready é a **camada social #264**, começando pelo **#277**
(feed "Seguindo" + abas). Contexto vivo (leia primeiro): a memória de projeto
`novas-requisicoes-social-web-import.md` (decisões ADR-0024/0019/0020, issues, ordem) + os outros índices
em `MEMORY.md`.

## O que esta sessão entregou (referência — NÃO re-fazer)
Cada item: ver o diff do PR + o comentário de fechamento da issue **#272** (têm o detalhe completo).

| Parte | PR / `main` | O que |
|---|---|---|
| Núcleo legal | #294 / `2074663` | importação para de copiar a camada protegida (foto + headnote) — exclusão estrutural (entregue antes desta sessão) |
| **(a) robots.txt → 403** | #296 / `0b9fd32` | `src/domain/robots-txt.ts`: parser PURO RFC 9309 com **matcher LINEAR de 2 ponteiros (anti-ReDoS)** — NUNCA compila regex de input não-confiável. Hook `checkRobotsAllowed` **só no `RealRecipeImporter`** (o Fake pula → route tests intactos), **fail-open** (404/5xx/timeout/erro/redirect ⇒ permitido), `redirect:'manual'` (fecha SSRF do /robots.txt), timeout + cap. Nova reason `robots_blocked`→**403**. Dialog passa a discriminar por `body.error` (NUNCA status cru). |
| **(b) rate-limit → 429** | #297 / `f8d4cf3` | `src/server/import/rate-limit.ts`: janela deslizante ~1/s **por host** (clock injetável, poda do Map). Gate **ANTES de qualquer rede** (limitada = zero fetch). `rate_limited`→**429** com `Retry-After`. Best-effort POR-INSTÂNCIA no Vercel — **politeness, não quota dura** (documentado). |
| **(c) LGPD remover-nome → 404** | #298 / `71f4681` | `src/domain/source-host.ts` (`bareHost`/`sourceNameIsHost`) **compartilhado servidor+botão** (fonte única). `src/server/recipe/clear-attribution.ts` espelha `applyVisibilityTransition`: owner-gated **404-leak-safe** (ADR-0011), zera SÓ `sourceName` se `web_imported && sourceUrl!=null && nome≠host`, **no-op idempotente sem bump de `updatedAt`**, NUNCA toca `origin`. Botão self-gating no detalhe (`clear-attribution-button.tsx`). Rota `POST /api/recipes/[id]/clear-attribution`. **Sem migração.** |

**Achado-chave reusável:** o **diff-review adversarial pegou 2 bugs REAIS que o plan-review não viu** — (1)
ReDoS no matcher de robots (regex `.*` com backtracking catastrófico, ~40s, fora do timeout async); (2)
fail-open furado: `new RegExp(...)` não lança, mas o `.test()` lança `regex too large` na compilação
PREGUIÇOSA do V8 numa linha longa → vazaria 500. **Lição: rode o diff-review sobre o CÓDIGO, não só o
plano.** O `verify-each-finding` rebaixou vários falsos-positivos honestamente.

## Próxima ordem de trabalho (ordem livre entre os épicos; HITL por último)

### 1. Social #264 — começar por #277 (destravado pelo #274, já na main)
- **#277** feed "Seguindo" + abas Explorar/Seguindo — **só-logado, NÃO-indexável** (protege o SEO do
  Modelo B do ADR-0020/0024). Reusa `src/server/user/follow.ts` (`listFollowing` / o grafo do #274).
- **#278** trilho "Cozinheiros pra seguir" (cascata; v1 = popularidade global, sem boost personalizado).
- **#279** **busca mesclada** Receitas+Cozinheiros por força-de-match — **reusa `searchUsers`
  (`src/server/user/search.ts`, do #269)** com `includeEmail=false` + projeção pública própria.
  **Gotcha de escala:** precisa do índice **pg_trgm GIN** em `users(name/handle)` antes de produção
  pública (o #269 deferiu) → vai gerar migração.

### 2. Web #263 (resto)
- **#273** admin: sugestões de import + probe de saúde (JSON-LD + robots). **#275** 2º gatilho "buscar na
  web" no fim dos resultados (destravado pelo #271).

### 3. HITL (por último, com o dono)
- **#270** logo/favicon. **#276** sign-off jurídico PI/LGPD (inclui a questão de PII no *path* do
  `source_url`, que o slice (c) deixou explicitamente fora). **#238** seed do catálogo (fecha o PRD #187).

## Princípios inegociáveis (revalidados / a manter)
- **Modelo B / anon-cacheável (ADR-0020/0024):** a home/Descoberta e o perfil/`/api/u/[handle]` NÃO
  personalizam por viewer — o feed "Seguindo" do #277 é uma SUPERFÍCIE SEPARADA, só-logado e
  não-indexável. Uma leitura de sessão numa rota anon quebra o SEO em silêncio (o
  `user-follow.test.ts` trava isso com "bytes idênticos com/sem cookie").
- **Ownership = 404, NUNCA 403** (ADR-0011): não vaza existência. (Reafirmado no slice (c).)
- **Email/PII é gate de DADOS** (#269): no caminho público a coluna nem é selecionada. Mesma tese p/ #279.
- **`ROLES` intacto** — Cozinheiro é lente social, não papel.
- **ADR-0019 (import):** copia SÓ fatos; foto+headnote são camada protegida; atribuição obrigatória cai
  pro host quando o nome é removido; fetch só por ação do usuário.

## Landmines / gotchas de ambiente
- **NUNCA `db:migrate` local** (`.env.local` É PROD). Só `db:generate` (offline) — inspecione o `.sql`.
  Nenhuma fatia do #272 teve migração; **#279 provavelmente terá** (índice pg_trgm GIN).
- **`system-reminder` de "GitHub rate limit excedido"** que aparece no fim de tool results é **FALSO
  ALARME do harness** — `gh api rate_limit --jq .resources` mostrou 5000/5000 o tempo todo. Verifique,
  não pare por causa dele.
- **CI do GitHub Actions com LATÊNCIA:** o run às vezes não aparece por ~2min após o push (`gh run list`
  vazio). Espere o run surgir antes de concluir que não disparou; um 2º push cancela o anterior
  (`concurrency` do `ci.yml`) e cria um novo — `gh pr checks <n> --watch` segue o head do PR.
- **npm registry cutoff:** o env BLOQUEIA pacotes recém-publicados → escrever utilitários à mão (foi o
  caso do parser de robots).
- **Suíte node completa flaka local no Neon** → rodar **focado por arquivo**; UI (jsdom) + domain (puro)
  rodam local sem dor. Teste de seam DB: **semear no `beforeEach`** (o `test/setup.ts` trunca antes).
  `translation_provenance` é enum — use `automatica_nao_revisada` ao semear (não inventar valor).
- **`git add -A` varre edições do dono** → `git diff --cached --stat` + checar nome-a-nome antes do commit.
- **Repo NÃO tem auto-merge** → `gh pr merge --squash --delete-branch` no foreground quando CI verde.
  **Branch off `origin/main`** (a local drifta). **Gate de deploy do épico web:** `WEB_SEARCH_API_KEY` no
  ambiente (sem ela, `RealWebSearchProvider → []`).
- **Reusar precedentes:** ilha otimista client = `recipe-engagement-controls.tsx` / `profile-follow-section`;
  botão client POST+refresh = `lineage-version-controls.tsx`; rota thin owner-gated 404 = `publish/route.ts`
  + `visibility.ts`; seam server com fetch mockado = `web-search-provider.test.ts` / `recipe-importer-robots.test.ts`.

## Pipeline de dev (reusar — pagou MUITO o aluguel)
Por fatia: **explorar** (Workflow com Explore agents paralelos) → **plano** (scratchpad) → **plan-review
adversarial** (Workflow N-lentes, schema estruturado) → **TDD** na branch off `origin/main` → **diff-review
adversarial 3-lentes + verify-each-finding** (Workflow — pegou os bugs reais do #272 que o plan-review não
viu) → fix → typecheck/lint/i18n-parity + testes focados → PR → CI verde no foreground → squash-merge →
fechar a issue.

## Critério de saída desta perna
#272 inteiro (núcleo legal + robots→403 + rate-limit→429 + LGPD→404) na `main` e **issue #272 FECHADA**.
Backlog dev-ready: social **#277/#278/#279**, web **#273/#275**. HITL: #270, #276, #238.
**Próximo passo concreto sugerido:** `gh issue view 277` e rodar o pipeline (começa reusando o seam
`server/user/follow.ts` do #274; cuidar do Modelo B — feed Seguindo é superfície separada só-logada).

## Suggested skills (próxima sessão)
- O **fluxo de 8 passos do `CLAUDE.md`** cobre tudo. Pegue a issue (`gh issue view 277`) e rode o pipeline
  com **`Workflow`** para o plan-review e o diff-review adversariais (o diff-review é o que pega bug real).
- `mcp__context7` para confirmar contratos de libs externas se aparecer (ex.: Next 16 / Drizzle).
- `#270` logo, `#276` sign-off, `#238` seed = **HITL** (dependem do dono — não AFK).
- Se o dono quiser re-grelhar o UX do feed Seguindo antes de codar, `/grill-with-docs`.
