# Handoff 64 — Auditoria de performance: bundle, busca da home, índices e waterfalls

**Sessão:** 2026-10-13. **Branch:** `claude/performance-audit-rj4e07` (um PR sobre a main em `6b06b5c`). **Migração:** `0075_perf_indexes` (só `CREATE INDEX`, nenhuma coluna). **Merge:** pendente.

Documento auto-suficiente: o que a auditoria achou, o que entrou neste PR (sem mudar UI, regra ou saída de função), onde mora e o que ficou como proposta.

---

## 1. O que foi entregue

- **zod fora do bundle de toda página (−65 KB gzip, −283 KB brutos).** O `RestricoesPerfilProvider` do root layout importava `domain/restricoes-perfil.ts`, que criava um schema zod no topo do módulo; o zod inteiro ia para as 37 rotas. A validação estrita (`parseListaRestricoes`) mudou para `domain/restricoes-perfil-parse.ts`, importado só pelas 3 rotas que recebem a lista. O mesmo para `MENU_NOTE_MAX` (`domain/menu-suggestion-limits.ts`), que levava o zod para `/me/meal-plan`. Medido no build: nenhum chunk client contém zod; `/[locale]/recipes/[id]` foi de 384,7 para 319,2 KB gzip de first-load JS.
- **Busca da home sem render no servidor a cada tecla.** `search-experience.tsx` refletia o termo na URL com `router.replace`, sem debounce; a home é dinâmica, então cada tecla pedia um RSC (metadata + feed + receita da semana + config) só para descartar. Agora usa `window.history.replaceState` (o Next sincroniza `usePathname`/`useSearchParams`). A URL resultante é a mesma. Duas diferenças aceitas, apontadas pelo painel: (a) o `router.replace` rolava a página para o topo quando o topo dos resultados estava fora da tela (ex.: marcar uma faceta depois de rolar); agora a página fica onde está; (b) o feed de repouso e a receita da semana que reaparecem ao limpar a busca são os da carga da página (antes vinham do último RSC, disparado pela última tecla).
- **Migração 0075 com 15 índices** (ver `src/db/schema.ts`, comentários junto a cada um):
  - better-auth: `account(user_id)`, `account(provider_id, account_id)`, `session(user_id)`, `verification(identifier, created_at)`, `verification(expires_at)`;
  - feed: `recipe(created_at, id)` parcial no gate do feed (EXPLAIN local, com seq scan desligado: `Index Scan Backward`). O filtro de visibilidade fica fora do índice; se as receitas mais novas forem quase todas privadas, a varredura anda mais antes de encher o LIMIT, e o planner escolhe pelo custo real;
  - Busca: `recipe_ingredient(ingredient_id)` parcial;
  - FKs de cascade/set null que eram seq scan: `notification(recipe_id)`, `notification(review_id)`, `creation_session(recipe_id)`, `recipe(parent_recipe_id)`, `shopping_list_item(source_recipe_id)`, `recipe(moderated_by)`, `recipe(reviewed_by)`, `report(reporter_id)`.
- **`app_config` lido uma vez por render.** `loadAppConfig` passa por `readAppConfigRow = cache(...)` (React). Antes: 2–4 leituras da mesma linha por página (layout + home + receita da semana + popularidade). Se a leitura compartilhada falha, cada chamada tenta de novo direto no banco (o `cache` memoiza a rejeição).
- **Waterfalls removidos (`Promise.all`):** detalhe da receita (slug map, cozinhas, avaliações, aviso de catálogo e semelhantes juntos, nos dois caminhos); `loadRecipeReviews` (agregado + lista); `/api/search` (embedding em paralelo com a sessão); popularidade + média global em `search.ts` e `recommended-cooks.ts`; notificações (página + contador); `/api/u/[handle]` (receitas + bloco social).
- **Payload RSC do detalhe:** `RecipeDetailView` passa ao escalador de porções e ao Modo cozinha só os recortes do catálogo que eles usam (`detalhe` + rótulos de unidade), não o `Messages` inteiro (~100 KB de JSON por página de receita).
- **`LocaleProvider`:** valor do contexto memoizado.
- **Pool:** os `Promise.all` sobem o pico de queries simultâneas por request (detalhe público ~5–6). O postgres.js com `max: 10` enfileira o excedente; acompanhar p95 se o tráfego crescer.

## 2. O que ler primeiro

1. `docs/perf/2026-10-13-auditoria.md` — o relatório da auditoria: reconhecimento, os 5 achados principais e a tabela de propostas.
2. `src/server/app-config.ts` — o comentário de `readAppConfigRow` (por que `cache` é seguro fora de render).
3. `src/components/recipe/search-experience.tsx` — o efeito de reflexo da URL (#236).
4. `drizzle/0075_perf_indexes.sql` e os blocos de índice em `src/db/schema.ts`.
5. `src/app/[locale]/recipes/[id]/page.tsx` — os dois `Promise.all`.

## 3. Princípios inegociáveis (não regredir)

- **Nenhum schema zod no topo de módulo que um client component importe.** O root layout monta providers client; um import de domínio com `z.object(...)` no topo leva o zod para todas as rotas. Validação com zod mora em módulo de servidor (`*-parse.ts`) ou é importada só por rotas.
- **A Busca reflete a URL sem navegação do router.** Voltar para `router.replace` traz de volta um RSC da home por tecla.
- **`cache()` só deduplica dentro de um render.** Em route handlers, crons e scripts ele chama direto; o read-after-write do `PUT /api/admin/config` continua lendo do banco. Não trocar por cache com TTL sem decidir a invalidação.
- **Índices do feed e de `verification` em ASC.** A varredura reversa dá `DESC NULLS FIRST`, que casa o `ORDER BY ... DESC` das queries; um índice declarado `DESC` (NULLS LAST) não casa.

## 4. Landmines

- **Testes de UI e a URL:** a Busca agora muda a `location` de verdade no jsdom. `test/ui/setup.ts` zera a URL em todo `beforeEach`; os testes que conferem o reflexo espionam `window.history.replaceState` (`discovery-home`, `restricoes-perfil`).
- **Migração 0075 e o preview da Vercel:** PR com migração flaka no preview (o build roda antes do branch do Neon existir). `CREATE INDEX` sem `CONCURRENTLY` (o migrator roda em transação): bloqueia escrita nas 9 tabelas até o commit; com o volume atual é instantâneo. A migração abre com `SET LOCAL lock_timeout = '5s'` (se um lock não vier em 5 s o build falha e é só refazer, em vez de enfileirar escritas; vale também para outra migração que suba no mesmo deploy, já que todas rodam numa transação só) e cria os índices de `recipe` primeiro, na mesma ordem em que um DELETE de Receita trava as tabelas das cascatas.
- **Ambiente local:** Postgres 17 + pgvector do PGDG na porta 5433; `TEST_DATABASE_URL` passado inline por comando, nunca exportado.

## 5. Propostas que ficaram fora (precisam de decisão)

1. **`get-session` sem rate limit em banco** (`'/get-session': false` em `customRules`, `src/lib/auth.ts`). Hoje cada navegação e cada volta à aba fazem 3 queries (uma escrita) em `rate_limit`, até de visitante. Tira o teto 100/60 s por IP dessa rota (leitura, sem senha). Regra de segurança (#449): decisão do Fernando.
2. **Dicionários de i18n:** os dois idiomas (61 KB gzip) vão em toda página. Testado neste PR: wrappers client por idioma NÃO separam os chunks (o Next carrega todos os client components do layout); passar o catálogo por prop troca JS cacheável por ~30 KB gzip no HTML de cada carga completa. Caminho melhor: tirar do catálogo client as seções que só páginas server usam (`admin`, `privacidade`, `seusDireitos`, `guia`: ~41 KB de JSON por idioma), virando server components onde dá.
3. **Páginas públicas cacheáveis:** nenhuma página é pré-renderizada porque o root layout lê `cookies()` (tema) e o banco. Exige aplicar o tema com script pré-pintura e cachear vocabulário/config com tag de revalidação.
4. **Semelhantes e busca semântica sem HNSW:** o `DISTINCT ON` faz distância contra todos os embeddings a cada visita a uma receita. Top-k pelo índice muda os resultados (aproximado).
5. **Full-text e trigram da Busca não usam os GIN** (`recipe_ts_config(rt.locale)` por linha; `similarity() >= 0.3` em OR); o ramo de ingrediente faz `to_tsvector` de toda linha a cada busca. Reescrita + coluna `tsvector` em `recipe_ingredient`.
6. **Perfil público e receita do dono fazem fetch HTTPS da própria API** (`getBaseUrl()`): duas invocações por visita. Extrair loaders compartilhados (refactor puro, bom próximo PR).
7. **Gaveta "Criar" com `next/dynamic`** (~340 KB de fonte no header de toda página); primeiro lazy chunk, revisar o `AppUpdateGuard`.
8. Menores: popularidade agregando `recipe_save`/`recipe_review` inteiras por request (cache ou view materializada); listas sem LIMIT trazendo `passos`; thumbs em PNG cheio; `takenSlugsForLocale` lendo todos os slugs do locale a cada escrita; pantry matches normalizando o corpus inteiro.

## 6. Critério de saída

PR mergeado com o painel de revisão limpo e o "checks" verde; migração 0075 aplicada no deploy de produção; memória do projeto atualizada.

---
