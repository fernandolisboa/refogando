# Handoff 80 — E2E de fumaça com Playwright e modo fake (#589)

**Sessão:** 2026-10-22. **Branch:** `claude/project-thread-6gx2v8` (sobre a main em `3ebbe77`). **Migração:** nenhuma. PR #592. Decisão no ADR-0047, que realiza o deferimento do Playwright do ADR-0015 (adendo lá). Uso no dia a dia: `docs/e2e.md`.

## 1. O que mudou

- **Playwright no repo** (`playwright.config.ts`, `@playwright/test` 1.64.1): só Chromium, perfis `desktop` e `celular` (Pixel 7), `retries: 0`. Scripts `npm run e2e`, `e2e:ui`, `e2e:install`.
- **Harness** `e2e/harness/server.ts` como `webServer`: banco descartável (Testcontainers ou `E2E_DATABASE_URL` em loopback) → `runMigrations` → seed (`e2e/harness/seed.ts`, dados em `e2e/fixtures/seed-data.ts`) → `next build` → `next start` em `localhost:3100`. Zera as chaves dos `.env*` e de provedor no env do filho e passa `__NEXT_PROCESSED_ENV=true`. No fim derruba o Next e apaga o banco.
  - Nome do banco `refogando_e2e_<epoch>_<aleatório>` (`E2E_DB_NAME_RE` em `e2e/harness/constants.ts`, a mesma regex no seed). A varredura de órfãos só apaga os com mais de 2h, para não derrubar o banco de outra execução local no meio do build.
  - `waitExit` resolve também quando o filho já morreu por sinal (`signalCode`), senão a limpeza travava.
- **Specs** (`e2e/specs/`): visitante (Busca, detalhe pelo slug, tema do cookie), conta e navegação (cadastro pela UI, tour, sair/entrar, todas as abas), criar pela gaveta (#581), cardápio ⇒ lista (com a quantidade planejada), Despensa ⇒ "Falta pouco" ⇒ lista ⇒ "Cozinhei".
  - Fixtures em `e2e/fixtures/test.ts`: guardas automáticas de erro de página/hidratação e de requisição do navegador fora de `localhost`; `account` (conta nova e logada, tour dispensado via `tourStorageKey`); helpers `recipePath(titulo)` (slug derivado como o write-path) e `planFromPopover(page, refeicao)`.
  - O "tour não volta no login" agora espera a checagem automática da home ler o storage (instrumenta `Storage.prototype.getItem` para a chave do tour) e confere que ela leu `'dismissed'`. Provado: com o `setItem` do tour anulado, o teste falha; a asserção antiga (`toHaveCount(0)` logo após o login) passava.
- **Modo fake** (`src/server/e2e/`): `mode.ts` (`e2eFakesActive`, a guarda), `fakes.ts` (dublês), `fetch-guard.ts` (embrulha o `fetch` global, só loopback), `canary.ts` (título da Receita canário). Checado no `next.config.ts`, no `src/instrumentation.ts` e em cada getter de `src/server/deps.ts`. `test/unit/e2e-mode.test.ts` trava a matriz e as invariantes estruturais.
- **CI:** job `e2e` em paralelo ao `checks`, sem secret, com cache do headless shell por versão do Playwright; artefato do relatório em falha. O workflow ganhou `permissions: { contents: read }`.
- Docs: `docs/e2e.md`, ADR-0047, adendo no ADR-0015, linha `npm run e2e` no README.

## 2. Landmines e gotchas de ambiente

- **`REFOGANDO_E2E_FAKES` só no harness.** Fora dele, fica AUSENTE (nem `.env*`, nem shell, nem Vercel): qualquer valor diferente de `'1'` lança, e `'1'` sem o ambiente do harness também. Na Vercel isso derruba o build pelo `next.config.ts`.
- **Docker para o Testcontainers.** Sem Docker, use `E2E_DATABASE_URL`, e só **inline** e em loopback (`E2E_DATABASE_URL=postgres://postgres@localhost:5433/postgres npm run e2e`). Nunca `export` (ver `CLAUDE.md`); host fora de loopback é recusado.
- **`E2E_SKIP_BUILD=1`** só reaproveita um build feito pelo harness (marcador `.next/e2e-build.json`). Um `npm run build` normal apaga o marcador e o atalho recusa; rode uma vez sem a variável. O banco é sempre novo.
- **`E2E_CHROMIUM_EXECUTABLE`** quando o browser do Playwright não baixa ou a revisão local não bate com a que o `@playwright/test` pede (aqui: `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`). Em Linux com libs faltando: `npx playwright install --with-deps chromium`.
- Bancos `refogando_e2e_<aleatório>` do formato antigo (sem o instante) nunca são varridos; apague à mão se sobrarem num Postgres local.
- O guarda de `fetch` não cobre o SDK do `@vercel/blob` (undici direto); o seam já é dublê. No importador, `robotsAllows` engole a rejeição do guarda (fail-open), então o sinal é só o log `[e2e] fetch RECUSADO`.
- O harness do banco duplica o do Vitest (`test/global-setup.ts`). Unificar é o #593.

## 3. Critério de saída

"checks" e "e2e" verdes no PR e painel de revisão limpo. Local: `npm run typecheck`, `npm run lint` e `E2E_DATABASE_URL=… E2E_CHROMIUM_EXECUTABLE=… npm run e2e -- --repeat-each=3` com 0 falhas. Em produção nada muda (a flag não existe lá); o build da Vercel segue verde.
