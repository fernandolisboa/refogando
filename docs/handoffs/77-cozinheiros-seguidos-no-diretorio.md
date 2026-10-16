# Handoff 77 — Cozinheiros não somem mais da `/cooks`

**Sessão:** 2026-10-16. **Branch:** `claude/fix-cozinheiros-somem-3br4dj` (sobre a main em `a5e3b07`, depois do #584). **Migração:** nenhuma. Origem: relato do dono: para um usuário, Explorar → Cozinheiros mostrava os cartões com "Carregando…" embaixo e depois trocava tudo por "Ainda não há cozinheiros para mostrar".

## 1. Causa

Não é erro de rede nem de banco. A página `/cooks` semeia no SSR a lista **global** (viewer-independente) e, logado, o `CooksDiscovery` re-busca a 1ª página **personalizada** em `/api/cooks`, que excluía você e quem você já segue (ADR-0024, emenda de 2026-06-29). Em produção há 3 Cozinheiros elegíveis (@fernando, @giulliane-cerqueira, @fernandolisboa) e o @fernando segue os outros dois (conferido em `/api/u/fernando/following`), então a resposta personalizada vinha vazia e substituía o seed. Os cartões do seed ainda mostravam "Seguir" para quem ele já segue.

## 2. O que mudou

- `loadRecommendedCooks` (`src/server/user/recommended-cooks.ts`) ganhou `includeFollowed`: com viewer, exclui só o próprio e projeta `following` (EXISTS em `user_follow`, correlato no `u.id` do GROUP BY). Sem a flag, o comportamento é o de antes (o trilho `/api/discovery/cooks` não passa a flag). Ordem e keyset não mudam.
- `/api/cooks` passa `includeFollowed: true`. O DTO `RecommendedCook` tem `following?: boolean`, só nessa resposta per-viewer (`no-store`).
- `CookCard` semeia o `CookFollowButton` com `cook.following` e usa `key` pelo estado inicial: o seed e a página personalizada têm os mesmos handles, e sem remontar o `useState` do `useFollowToggle` ficaria preso no "Seguir" do seed.
- ADR-0024 ganhou a emenda de 2026-10-16. Comentários de `cooks-discovery`, `cook-follow-button`, `use-follow-toggle` e da rota atualizados.
- Testes: `test/integration/recommended-cooks.test.ts` (seguido fica marcado, self sai; quem segue todo mundo ainda vê a lista enquanto o trilho segue vazio; anônimo não ganha a chave), `test/integration/cooks-directory.test.ts` (rota logada) e `test/ui/cooks-discovery.test.tsx` (página personalizada troca o seed e o seguido nasce "Seguindo"; falha sem a `key`).

## 3. Landmines

- O teste de allowlist de `cooks-directory.test.ts` roda anônimo, então segue esperando só `handle/image/name/recipeCount/recipes`. Logado, a chave `following` aparece de propósito.
- Busca (`/api/search/cooks`) é cookie-free: mostra "Seguir" para quem você já segue. Mudar isso exige ler a sessão na busca (perde o cache por URL) ou um GET de estado por lote.
- Rodar a integração localmente sem Docker: o Postgres 16 do container recusa a migração 0054 (valor de enum novo usado na mesma transação do migrator). Contorno usado aqui: aplicar `drizzle/*.sql` arquivo a arquivo no `template1` com `psql` e inserir uma linha em `drizzle.__drizzle_migrations` com o maior `when` do journal; os bancos `refogando_test_*` nascem migrados. `TEST_DATABASE_URL` só inline no comando, apontando para localhost.

## 4. Critério de saída

"checks" verde, painel de revisão limpo; em produção, logado como @fernando, a `/cooks` mantém os dois cartões com "Seguindo".
