# Handoff 65 — Perfil e receita do dono sem self-fetch; listas sem colunas pesadas

**Sessão:** 2026-10-13. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `b723c3a`, depois do #569). **Migração:** nenhuma. Continuação da auditoria do handoff 64 (itens D e H, passo 1).

## 1. O que foi entregue

- **Sem self-fetch HTTP.** O perfil público (`/{locale}/u/[handle]`) e o caminho do dono do detalhe (`/{locale}/recipes/[id]`, ramo privado) chamavam a própria API por HTTPS (`fetch(getBaseUrl()/api/...)`): duas invocações de função por visita. Agora chamam direto os loaders que as rotas também usam:
  - `src/server/user/public-profile.ts` → `loadPublicProfile(db, rawHandle, requestLocale)`; `null` = 404.
  - `src/server/recipe/detail-view.ts` → `loadRecipeDetailView(db, { id, requestLocale, headers })`; `null` = 404.
  - As rotas `GET /api/u/[handle]` e `GET /api/recipes/[id]` viraram wrappers finos; o contrato HTTP não mudou.
  - `src/server/auth/guard.ts` ganhou `requireSessionFromHeaders(headers)`; `requireSession(req)` delega a ele.
- **Código morto removido:** `getBaseUrl()` (o fallback por `Host`, que o próprio comentário apontava como risco de SSRF) e `src/server/http/handle-response.ts`. Fica `getBaseUrlFromEnv()`.
- **Listas enxutas:** `listMyRecipes`, `listPublicRecipesByOwner` e `hydrateRecipeListItems` (salvos, coleções, despensa, cardápio) carregam das traduções só `locale`, `titulo`, `provenance` e `slug`. `descricao`/`passos`/`notas`/`stale` não eram lidos por ninguém. `resolveName` aceita o tipo estreito `TranslationNameRow` (`src/domain/recipe-read.ts`).
- ADR-0020 ganhou uma linha de atualização; o relatório `docs/perf/2026-10-13-auditoria.md` marca D e H (colunas) como resolvidos.

## 2. O que ler primeiro

1. `src/server/recipe/detail-view.ts` — o gate do detalhe por UUID e por que ele recebe `headers` (e não um `viewerId`).
2. `test/integration/detail-loaders.test.ts` — desfechos leak-safe e a prova de que o valor do loader é JSON-puro (a página recebe o mesmo que o antigo `res.json()`).
3. `docs/perf/2026-10-13-respostas.md` — as respostas ao Fernando sobre o item 1 e os achados A–J, com a ordem dos próximos PRs.

## 3. Princípios inegociáveis

- **Página não faz fetch da própria API.** Server Component chama o loader de `src/server/` que a rota também usa (mesmo padrão de `feed.ts` e do caminho público do detalhe).
- **O loader do detalhe decide se e quando ler a sessão:** o ramo privado só depois do gate; o público só com cookie. Não trocar `headers` por `viewerId` resolvido antes.
- **Loaders de lista não carregam texto pesado.** Se uma lista precisar de `descricao`, carregue só onde é exibido.

## 4. Landmines

- Os dois Postgres locais escutam na 5433: o cluster `17/perf` aceita `postgres:postgres`; o `17/main` não. `pg_ctlcluster 17 perf start`. `TEST_DATABASE_URL` sempre inline, nunca exportado.
- Dois agentes rodando vitest ao mesmo tempo no mesmo cluster se atropelam (`truncateAll`/banco temporário somindo). Rode um de cada vez.

## 5. Próximos passos (aprovados pelo Fernando em 2026-10-13)

Ordem em `respostas-2026-10-13.md` §"Ordem proposta":
1. Item 1 + J: `'/get-session': false` no rate limit; um refetch de sessão e de notificações por volta à aba (hoje 4 + 2); emenda curta no ADR-0028 (e marcá-lo implementado).
2. Busca: full-text dos títulos e trigram usando os GIN (sem migração, resultado idêntico) + bug do curinga `%`/`_` no ILIKE; cache de 10 min da receita da semana com tag.
3. Cache das páginas públicas (A): tema por script pré-pintura, leituras do layout com `unstable_cache` + tags.
4. Migração 1: ingrediente cru do C + colunas normalizadas da Despensa (E). Migração 2: derivados WebP da capa (~1280 px e ~400 px), original guardado, `srcset`, backfill (I).
5. UI: gaveta "Criar" lazy com pré-carga e fallback para `/create` + largura 512 px (`sm:max-w-lg`) (G).
6. Em espera: HNSW (B) e paginação das listas (H passo 2), até o catálogo crescer.

## 6. Critério de saída

PR mergeado com painel limpo e "checks" verde.
