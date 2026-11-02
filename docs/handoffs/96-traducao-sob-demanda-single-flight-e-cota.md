# Handoff 96 — Tradução sob demanda: single-flight, cache de falha, cota por usuário e teto da entrada

**Data:** 2026-11-02.
**Branch:** `claude/project-thread-4fcghp`. Dois commits: "Tradução: single-flight, cache de falha e cota por
usuário (#642)" (`e0cfb64`) e "Tradução: achados da revisão (#642)", logo depois.
**Base:** `origin/main` com o #651 (reserva de cota, migração 0085, ADR-0055), que entrou como `8a7c762`. Este
trabalho usa `quota_hold` e refatora `reserveQuotaHold`.
**Migração:** 0086 (`recipe_translation_attempt`, tabela nova e vazia; CHECK de `quota_hold.kind` com `translation`).
**ADR:** ADR-0056 (novo); notas em ADR-0055 (dec. 1) e ADR-0050 (dec. 3).

## 1. Escopo

- **#642 (M-3 da auditoria):** `POST /api/recipes/[id]/translations/[locale]` traduzia pelo Claude sem teto.
  - A falha não grava nada (AC4 do #23), então cada POST chamava o modelo de novo.
  - POSTs simultâneos na 1ª tradução chamavam uma vez cada.
  - A entrada não tinha tamanho máximo (L-7).
- **Correção** (detalhes no ADR-0056):
  - **single-flight por (receita, locale)**: `claimTranslationFlight` toma `pg_advisory_xact_lock(4678, hashtext(recipe:locale))` numa
    tx curta (espera máxima de 2 s, `TRANSLATION_PAIR_LOCK_TIMEOUT_MS`) e grava um **lease** de 90 s em
    `recipe_translation_attempt`. A chamada ao modelo roda depois do commit, sem lock nem tx abertos. A espera pelo
    par estourada ⇒ `in_progress` (200 no original), nunca 429;
  - **cache negativo**: a falha grava `retry_at` (24 h para `UnusableTranslationError`, 10 min para infraestrutura) e
    `fail_key` = `translationFlightFailKey`: a chave do circuit-breaker do #520 (fonte + versão do prompt, sem
    mudança) mais a cozinha e o modelo/thinking/esforço do admin (`Translator.modelConfigKey`, ADR-0034). Até
    `retry_at`, e com a mesma chave, nenhum POST chama o modelo;
  - **cota por usuário**: `quota_hold` kind `translation`, reservada na mesma tx do lease (`reserveQuotaHoldInTx`, lock
    4677, espera máxima de 2 s, `TRANSLATION_USER_LOCK_TIMEOUT_MS`), teto por papel em código
    (`TRANSLATION_CAP_BY_ROLE`: usuario 30, curador 60, admin ∞). A reserva nunca é consumida nem devolvida (é o
    registro). Estourou, ou a fila da lock do usuário encheu ⇒ 429 `limite_traducao` com `retryAfterMs`;
  - **teto da entrada, no que vai ao modelo**: mais de 50 passos, mais de 60 ingredientes ou mais de
    `TRANSLATION_MAX_PAYLOAD_BYTES` (8.192 bytes UTF-8 do `userPrompt` serializado + a cozinha) ⇒ `too_large`, sem
    chamada. O raciocínio do tamanho está no ADR-0056 dec. 6;
  - em voo, em cooldown ou grande demais ⇒ 200 com a view no original (como o `degraded` de sempre).
- **Achados da revisão** (2º commit):
  - o teto media o texto cru e era contornável (passos vazios, ingredientes de 1 letra, caracteres de controle) e não
    deixava folga para o JSON: agora mede os bytes do JSON enviado e limita as contagens;
  - a lock do par ocupada respondia 429 a terceiros: agora `in_progress`; a espera pela lock do usuário caiu para 2 s;
  - as duas esperas (antes até 10 s) corriam antes do prazo de 50 s do tradutor e podiam estourar o `maxDuration`
    depois da chamada paga: agora somam ≤ 4 s;
  - a chave do cache negativo ganhou a cozinha e o modelo do admin;
  - privacidade: "sem a receita" virou "sem o id da receita", dizendo que as datas podem ser correlacionadas durante
    a tentativa (ROPA op. 5, ADR-0050, ADR-0056 dec. 8, comentário do export);
  - riscos residuais novos no ADR-0056; testes de fechamento de voo substituído, abandono, 429 da lock do usuário e
    dos desvios do teto.
- **Privacidade:**
  - `quota_hold` ganhou um tipo, sem coluna nova (eliminação, retenção e export já cobrem);
  - ROPA operação 5, comentários do export, da retenção e da eliminação, e `docs/legal/takedown-e-remocao-titular.md`
    atualizados. A reserva não guarda o id da receita, mas nasce com o mesmo `now()` do lease: durante a tentativa
    (≤ 90 s, ou até a próxima escrita no par após uma queda) as datas podem ser cruzadas (ADR-0056 dec. 8);
  - política sem mudança (ADR-0056 dec. 8);
  - a tabela nova não tem usuário nem conteúdo;
  - nenhuma linha de log nova.

## 2. O que ler primeiro

1. `docs/adr/0056-traducao-sob-demanda-single-flight-cache-de-falha-e-cota.md`.
2. `src/domain/translation-flight.ts`: constantes (lease, cooldowns, esperas de lock, tetos), `decideTranslationFlight`,
   `translationPayloadBytes`/`isTranslationInputTooLarge`, `translationFlightFailKey`, `capForTranslation`. O
   `userPrompt` medido vem de `buildTranslationUserPrompt` (`src/domain/translation-prompt.ts`), a mesma função que
   monta a mensagem enviada.
3. `src/server/translation/flight.ts`: `claimTranslationFlight` (lock do par estourada ⇒ `in_progress` por um sinal
   interno lançado de dentro da tx) e os três fechamentos (`complete`/`fail`/`abandon`, todos condicionados ao
   `lease_id`). `src/server/translation/translator.ts`: `modelConfigKey` no seam (opcional; os dublês não têm).
4. `src/server/recipe/translation.ts`: onde as guardas entram em `ensureTranslation` (o write-path foi para
   `persistTranslation`, sem mudança de comportamento).
5. `src/server/quota/atomic.ts`: `reserveQuotaHoldInTx` (com `lockTimeoutMs` opcional; default 5 s), `recentEventTimes`,
   kind `translation`, classes 4677/4678.
6. `src/app/api/recipes/[id]/translations/[locale]/route.ts`: a cota e o 429.
7. Testes: `test/integration/translation-flight.test.ts` (concorrência com tradutor travado, laço de falha, cooldown
   vencido, fonte, cozinha e modelo trocados, lease, lock do par cheia ⇒ 200, lock do usuário cheia ⇒ 429 com
   `retryAfterMs`, fechamentos de um voo substituído, abandono, cota, admin, os quatro desvios do teto) e
   `test/domain/translation-flight.test.ts`.

## 3. Ordem e dependências

1. O #651 (migração 0085, `quota_hold`, ADR-0055) já está em `main` (`8a7c762`). `reserveQuotaHold` virou um
   invólucro de `reserveQuotaHoldInTx`; quem mexer nela mexe nas duas.
2. A migração 0086 precisa existir antes do código (o build da Vercel roda `npm run db:migrate` antes do `next build`).
3. `src/domain/translation-flight.ts` → `src/server/translation/flight.ts` → `ensureTranslation` → rota.
4. Nenhuma tela chama o POST hoje. Uma UI futura deve tratar o 429 `limite_traducao` com `traducao.limite`
   (`{tempo}` de `formatCountdown`, como `readDeriveLimit`).

## 4. Princípios inegociáveis

- **Nada de lock ou tx atravessando a chamada ao modelo.** O single-flight é o lease; a lock só protege a leitura do
  estado e a gravação do lease.
- **Ordem das locks fixa: par (4678) → usuário (4677).** Inverter num caminho novo abre deadlock.
- **Só o pedido que vai chamar o modelo reserva cota.** Tradução existente, em voo, em cooldown ou grande demais não
  gasta slot.
- **Os fechamentos só agem com o próprio `lease_id`.** Um voo substituído (lease vencido) não apaga nem sobrescreve o
  estado do voo seguinte.
- **AC4 do #23 intacto:** falha, em voo e cooldown degradam para o original com 200; o único status novo é o 429 da
  cota.
- **O cache negativo começa pela chave do #520** (`retranslateFailKey`) e acrescenta o que mais muda a saída (cozinha,
  modelo/ajuste do admin) em `translationFlightFailKey`. Não mudar `retranslateFailKey`: o breaker do worker usa ela.
- **O teto mede o que vai ao modelo** (bytes do `userPrompt` de `buildTranslationUserPrompt`), não o texto cru. Um
  campo novo no payload entra sozinho na medida; um campo novo no system prompt que varie por receita precisa entrar
  em `translationPayloadBytes`.
- **Lock do par estourada é `in_progress`, nunca 429.** O 429 é só da cota do usuário e da fila da lock dele.

## 5. Landmines

- `now()` dentro do claim é o início da tx; lease e `retry_at` são calculados e comparados no relógio do banco, nunca
  no do app (instâncias diferentes).
- O 55P03 aborta a tx no Postgres: o claim **lança** de dentro dela (nunca devolve um valor e segue na tx). Na lock
  do usuário é `QuotaExceededError` e a rota responde 429; na lock do par é um sinal interno (`PairLockBusy`) que
  `claimTranslationFlight` converte em `in_progress` fora da tx.
- `failTranslationFlight`, `completeTranslationFlight` e `abandonTranslationFlight` são best-effort: um erro do banco
  ali não derruba a resposta, e o lease vence sozinho em 90 s.
- A reserva de tradução **não** é devolvida em nenhum caso (o `RealTranslator` não tem o `fetch` instrumentado do
  ADR-0055). Se alguém levar a prova de "não pago" para o tradutor, chamar `releaseQuotaHold` só com essa prova, e
  o claim precisaria devolver o `holdId`.
- O worker do admin (`retranslateOutdated`) não passa pelo claim e não deve passar: ele só atualiza linhas existentes
  e tem o breaker próprio (#520).
- Os testes de lock cheia (par e usuário) seguram a lock numa 2ª conexão e levam uns 2 s cada (o `lock_timeout`).
- As esperas de lock do claim (2 s + 2 s) correm antes do prazo de 50 s do tradutor; o total precisa caber no
  `maxDuration = 60` da rota. Aumentar uma espera ou o prazo exige refazer essa conta (ADR-0056 dec. 2).
- A reserva e o lease nascem com o mesmo `now()`: é isso que a ROPA (op. 5) declara como correlacionável. Mudar a
  forma de gravar as datas muda o texto da ROPA.
- Migração: só via `npm run db:migrate` (build da Vercel) ou `drizzle-kit migrate`. Nunca contra produção à mão.

## 6. Gotchas de ambiente

- Testes de integração sobem um Postgres por Testcontainers: o Docker precisa estar rodando. **Nunca** exporte
  `DATABASE_URL`/`TEST_DATABASE_URL` no shell (o incidente de 2026-09-09, `docs/incidents/`).
- Em sessões com vários agentes, rode typecheck, lint e todo vitest sob `flock /var/tmp/vitest.lock`.
- O worktree novo não tem `node_modules`: `npm ci` antes.
- `drizzle-kit generate` lê `.env.local` mas não conecta no banco; gere a migração sem exportar URL nenhuma.

## 7. Follow-ups (sem issue ainda)

- **L-7** continua aberto: os campos de texto da receita seguem sem tamanho máximo na escrita. O teto da entrada aqui
  só protege a tradução.
- `.security-audit/REPORT.md` ainda marca M-3 como "ABERTO (#642)" (o #651 também não atualizou M-1/M-2); atualizar
  quando o PR entrar.
- Se uma tela passar a chamar o POST, mostrar `traducao.limite` no 429 e talvez um aviso "tradução indisponível no
  momento" no cooldown (hoje o 200 no original não diz por quê).
- Cooldown exponencial (contar falhas consecutivas do par) se a falha da linha voltar todo dia na mesma receita.
- Teto global diário de custo da tradução (hoje só por conta; ADR-0056, riscos residuais).
- Se o tempo apertar de novo, passar um prazo ao tradutor (`min(50 s, o que resta do maxDuration)`) em vez de
  encurtar mais as esperas.
- Juntar os dois SELECTs do claim (tradução existente e estado do par) numa consulta só: não foi feito na revisão
  porque não era trivial com o Drizzle sem SQL cru.

## 8. Critério de saída

- `checks` verde no PR (typecheck, lint, suíte de integração com Postgres real).
- Migração 0086 aplicada no build da Vercel; `recipe_translation_attempt` só com pares que falharam.
- Em produção: um laço de POSTs numa receita cuja tradução falha mostra uma chamada só no painel de custo por janela
  de cooldown; dois POSTs simultâneos numa receita sem tradução mostram uma chamada.
