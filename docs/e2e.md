# E2E de fumaça (Playwright)

Issue #589, decisão no [ADR-0047](adr/0047-e2e-fumaca-playwright-modo-fake.md). Um punhado de fluxos ponta a ponta, num navegador de verdade, contra um `next build` + `next start` de produção. Pega o que Vitest + jsdom não veem: hidratação quebrada, navegação entre seções, gaveta que não fecha, tema que pisca.

## O que roda

| Spec | Fluxo |
| --- | --- |
| `visitante` | home `/` → `/pt-BR`, Busca "cenoura", detalhe pelo slug, reload 200; tema escuro do cookie em receita, home e 404, troca para o claro e persiste; link "Termos de Uso" do rodapé → `/pt-BR/termos` e `/en-US/termos` 200 (ADR-0051) |
| `conta-e-navegacao` | cadastro pela UI → tour de boas-vindas → dispensa → sai → entra; logado, cada aba de cada seção marca `aria-current`, e "Planejar" lembra a última aba; "Sair" recarrega esta aba e outra aberta numa tela pessoal (ADR-0028, Adendo 2026-10-23) |
| `criar-receita` | gaveta Criar → Prompt aberto → Gerar → "Ver receita" → página da Receita, sem diálogo sobrando (#581) |
| `cardapio-lista` | Receita do seed → Adicionar ao cardápio → Cardápio da semana → lista de compras da semana inteira |
| `despensa` | ovo e cenoura persistem → "Falta pouco" com farinha e açúcar → "Pôr o que falta na lista" → planeja → "Cozinhei" esvazia a Despensa |
| `seus-dados` | /me/profile → Baixar meus dados (download JSON com o e-mail da conta e o login, sem a senha) → Excluir minha conta → confirma → home com "Sua conta foi excluída.", deslogado |

Tudo roda em dois perfis do Chromium: `desktop` e `celular` (Pixel 7, com o menu hambúrguer). `retries: 0`: teste instável é bug, não se mascara com retry.

Em todo teste, duas guardas automáticas (`e2e/fixtures/test.ts`): erro de página ou de hidratação do React reprova, e requisição do navegador para fora de `localhost` também.

## Como rodar

```bash
npm run e2e:install    # uma vez: baixa o Chromium do Playwright
npm run e2e            # build + testes (a 1ª execução leva alguns minutos)
npm run e2e:ui         # modo interativo
npx playwright show-report   # relatório da última execução (traces dos testes que falharam)
```

Em Linux, se o Chromium não abrir por falta de biblioteca do sistema, instale as libs do SO junto: `npx playwright install --with-deps chromium` (pede sudo).

O `webServer` do Playwright é o harness `e2e/harness/server.ts`. Ele faz, em ordem: banco descartável → migrações (`runMigrations`, nunca `drizzle-kit`) → seed (`e2e/harness/seed.ts`) → `next build` → `next start` em `http://localhost:3100`. No fim, derruba o Next e apaga o banco.

### Banco

O banco descartável vem de `test/helpers/throwaway-db.ts`, o mesmo helper do `test/global-setup.ts` (#593); o E2E o usa no modo estrito.

- **Padrão:** Testcontainers sobe `pgvector/pgvector:pg17` (precisa de Docker). O host exposto precisa ser loopback; com `DOCKER_HOST` remoto o harness recusa.
- **Sem Docker:** aponte para um Postgres 17 + pgvector local, com a variável **inline** (nunca `export`, ver `CLAUDE.md`):

  ```bash
  E2E_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run e2e
  ```

  O harness cria `refogando_e2e_<epoch>_<aleatório>` ali e apaga no fim. Na subida, varre órfãos de execuções que morreram, mas só os com mais de 2h pelo instante no nome: outra execução local em paralelo não perde o banco no meio do build. Nome fora desse padrão (inclusive o formato antigo, sem o instante) nunca é tocado; apague à mão se sobrar. Só aceita host loopback.

`DATABASE_URL` e `TEST_DATABASE_URL` do shell são ignoradas.

### Atalhos locais

- `E2E_SKIP_BUILD=1 npm run e2e` reaproveita o build anterior **do harness** (marcador `.next/e2e-build.json`; um `npm run build` normal o apaga). O banco é sempre novo.
- `npm run e2e -- e2e/specs/despensa.spec.ts --project desktop` roda uma spec num perfil.
- `npm run e2e -- --repeat-each=5` é a prova de estabilidade antes de mexer nas specs.
- `E2E_CHROMIUM_EXECUTABLE=/caminho/do/chromium` usa um Chromium já instalado, para máquinas sem acesso ao download do Playwright. A revisão precisa ser próxima da que o `@playwright/test` pede.

## Modo fake (o que muda no servidor)

`REFOGANDO_E2E_FAKES=1` faz os getters de `src/server/deps.ts` devolverem os dublês de `src/server/e2e/fakes.ts`: "Claude" determinístico (Receita canário com o nonce do pedido no título), embedder de 1536 dimensões, tradutor identidade, imagem PNG 1×1, store em memória, busca na web e importador enlatados, mailer sem e-mail de conta (o cadastro entra direto, como produção sem Resend).

A flag é segura por construção (`src/server/e2e/mode.ts`). Ela **lança** se aparecer com um marcador da Vercel não vazio, com `DATABASE_URL` fora de loopback, ou com `BETTER_AUTH_URL`/`APP_URL` que não sejam `http://` em loopback. A checagem roda em três lugares: no `next.config.ts` (derruba `next build` e `next start`), no `src/instrumentation.ts` (na subida do servidor) e em cada getter. Com a flag ligada, o instrumentation também embrulha o `fetch` global e recusa hosts fora de loopback. O fetch endurecido do importador (`src/server/import/web-fetch.ts`) usa esse `fetch` global, com um `dispatcher` do undici, então passa pelo guarda; o `robotsAllows` de lá engole a rejeição (fail-open de propósito), e aí o único sinal é a linha `[e2e] fetch RECUSADO` no log. A única exceção conhecida é o SDK do `@vercel/blob`, que usa o `undici` direto e escapa do guarda, mas esse seam já está trocado por dublê. `test/unit/e2e-mode.test.ts` trava a matriz da guarda e garante que todo `new Real*(` de `deps.ts` passa pelo ramo do modo fake.

**Fora do E2E, `REFOGANDO_E2E_FAKES` fica AUSENTE.** Não a ponha em `.env*`, no shell nem na Vercel: qualquer valor diferente de `'1'` lança, `'1'` lança em qualquer ambiente que não prove ser o harness (marcador da Vercel, banco ou URLs fora de loopback), e na Vercel isso derruba o build pelo `next.config.ts`. Quem liga a flag é só o harness, no env do processo filho.

O `.env.local` deste repo aponta para produção. O harness passa `''` para toda chave dos arquivos `.env*` e das chaves de provedor conhecidas, e também passa `__NEXT_PROCESSED_ENV=true`, então o Next nem abre os arquivos.

## CI

O job `e2e` de `.github/workflows/ci.yml` roda em paralelo ao `checks`. Ele instala só o headless shell do Chromium (`npx playwright install --with-deps --only-shell chromium`, com cache por versão) e roda `npm run e2e` sem nenhum secret. Quando falha, `playwright-report/` e `test-results/` (traces e screenshots) sobem como artefato.

## Escrevendo uma spec nova

- Use `test`/`expect` de `e2e/fixtures/test.ts`. A fixture `account` dá uma conta nova e logada, com o tour já dispensado.
- Para o slug de uma Receita, use `recipePath(titulo)` (deriva como o write-path); para planejar pelo popover do cardápio, `planFromPopover(page, refeicao)`.
- Pegue os rótulos de `t` (o catálogo `pt-BR`) e prefira `getByRole`. Escopo o seletor ao diálogo ou região aberta, porque vários rótulos se repetem ("Adicionar", "Adicionar ao cardápio").
- Não use `waitForTimeout` nem `networkidle`. Espere pelo estado visível (`expect(...).toBeVisible()`), e use `waitForHydration(page)` antes de interagir com uma página recém-carregada.
- Os workers rodam em paralelo no mesmo banco: nada de dado compartilhado mutável. Use a Receita do seed só para leitura, e dê a todo título ou nome criado um sufixo único.
