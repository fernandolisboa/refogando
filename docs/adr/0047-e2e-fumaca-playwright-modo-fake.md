# ADR-0047 — E2E de fumaça com Playwright, contra um build local no modo fake

Status: aceito

Realiza o deferimento do ADR-0015 ("Playwright fica deferido […] quando o CI ganhar um job que faz `next build` + `next start`"). Issue #589.

## Contexto

O seam de UI do ADR-0015 (Vitest + jsdom) prova componente, não app. Três bugs recentes passaram por ele e só apareceram no navegador, contra o build de produção:

- **#578**: erro de hidratação #418 intermitente na página da Receita e o tema escuro perdido no 404/500 montados no cliente;
- **#581**: a gaveta "Criar" continuava aberta por cima da Receita depois de navegar;
- **#585**: `/cooks` logado sumia com os cozinheiros já seguidos ("Ainda não há cozinheiros para mostrar").

A condição que o ADR-0015 pôs para o Playwright está cumprida: o CI já roda `next build` (job `checks`), e um job a mais pode subir o `next start`.

## Decisão

1. **Playwright, só Chromium**, em dois perfis: `desktop` (Desktop Chrome) e `celular` (Pixel 7, com o menu hambúrguer). Um punhado de fluxos de fumaça (`e2e/specs/`), não cobertura.
2. **Sempre contra `next build` + `next start` locais, em `localhost:3100`. Nunca contra produção nem preview.**
3. **O harness é o `webServer` do Playwright** (`e2e/harness/server.ts`): banco descartável → migrações (`runMigrations`) → seed → `next build` → `next start`; no fim derruba o Next e apaga o banco. O banco vem do Testcontainers (`pgvector/pgvector:pg17`, precisa de Docker) ou, sem Docker, de `E2E_DATABASE_URL` em loopback (cria e apaga `refogando_e2e_<epoch>_<aleatório>`). `DATABASE_URL`/`TEST_DATABASE_URL` do shell são ignoradas, e as chaves dos `.env*` vão zeradas para o filho (o `.env.local` aponta para produção).
4. **`retries: 0`.** Fumaça instável é bug a corrigir, não a mascarar.
5. **Job `e2e` no `ci.yml`, em paralelo ao `checks`, sem nenhum secret.** O harness gera os próprios (segredo de auth descartável) e zera as chaves de provedor. Em falha, sobem `playwright-report/` e `test-results/` como artefato.

## Modo fake

`REFOGANDO_E2E_FAKES=1` troca os provedores externos (Claude, Gemini, Resend, Blob, busca na web, importador) pelos dublês de `src/server/e2e/fakes.ts`, dentro de um `next start` de verdade. A flag é segura por construção (`src/server/e2e/mode.ts`, `e2eFakesActive`):

- ausente ou `''` ⇒ `false` antes de ler qualquer outra variável (o caminho de produção é só isso);
- qualquer outro valor que não `'1'` ⇒ lança;
- `'1'` com marcador da Vercel não vazio, `DATABASE_URL` fora de loopback, ou `BETTER_AUTH_URL`/`APP_URL` que não sejam `http://` em loopback ⇒ lança.

A checagem roda em três lugares: no `next.config.ts` (derruba `next build` e `next start`, inclusive o build da Vercel), no `src/instrumentation.ts` (na subida do servidor) e em cada getter de `src/server/deps.ts`. Com a flag ligada, o instrumentation embrulha o `fetch` global (`src/server/e2e/fetch-guard.ts`) e recusa hosts fora de loopback. O fetch endurecido do importador passa por esse guarda (usa o `fetch` global com `dispatcher` do undici); a única exceção conhecida é o SDK do `@vercel/blob`, que usa o undici direto e já está trocado por dublê. No navegador, a fixture das specs reprova qualquer requisição para fora de `localhost`.

**Invariantes travadas por `test/unit/e2e-mode.test.ts`:** a matriz da guarda acima; os getters de `deps.ts` devolvendo real sem a flag, dublê com a flag no ambiente do harness e lançando com `VERCEL=1`; o override `setX()` com precedência sobre o modo fake; todo `new Real*(` de `deps.ts` num ramo `e2eFakesActive() ? e2eFakes.x() :`, e nenhum fora de `deps.ts`; `new Anthropic(` só nas classes Real e `@vercel/blob` só no image-store; `fakes.ts` sem import de `test/`; e o guarda de `fetch` recusando fora de loopback.

## Alternativas rejeitadas

- **MSW ou interceptação de rede no navegador (`page.route`).** Só vê o que o navegador pede. Geração, tradução, e-mail e Blob são chamados pelo servidor (route handlers e server actions), fora do alcance do browser.
- **Rodar contra o preview da Vercel.** Usaria IA paga e dado real (o preview fala com um branch do Neon e com as chaves de verdade), e o resultado dependeria de deploy, rede e cota.
- **Build separado com alias de módulo** (trocar os provedores no bundler, só para o E2E). Seria um segundo build de produção, diferente do que vai para a Vercel; o modo fake por flag testa o mesmo código que é publicado, com a troca na raiz de composição.

## Consequências

- Os dublês vão no bundle de produção, inertes: sem a flag, nenhum getter os alcança, e com a flag fora do harness o processo nem sobe.
- O CI faz dois `next build` por PR (o smoke-check do `checks` e o do `e2e`, que builda com o banco, como a Vercel). Os jobs rodam em paralelo; o custo é tempo de runner, não de relógio.
- O harness de banco do E2E duplica o do Vitest (`test/global-setup.ts`) de propósito, para não acoplar os dois agora. Unificar é o follow-up #593.
  *Atualização (2026-10-23, #593): unificado. Os dois harnesses usam `test/helpers/throwaway-db.ts` (`createThrowawayDb`). O E2E liga `requireLoopback` e só varre órfãos com mais de 2h pelo instante no nome; o Vitest segue sem trava de loopback e varre todo órfão `refogando_test_*` sem sessão. Nos dois, a varredura só considera nomes que casam com a forma segura (`safeName`).*
- Spec nova segue `docs/e2e.md`: rótulos do catálogo `pt-BR`, `getByRole`, nada de `waitForTimeout`/`networkidle`, nenhum dado compartilhado mutável entre workers.
