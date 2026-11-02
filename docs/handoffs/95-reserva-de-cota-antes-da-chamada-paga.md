# Handoff 95 — Reserva de cota antes da chamada paga

**Data:** 2026-11-02.
**PR:** "Cota reservada antes da chamada paga: receita, imagem e conversa (#640, #641)", em dois commits: a mudança e
"Reserva de cota: achados da revisão (#640, #641)".
**Base:** `main` em `33a0aeb` (#650).
**Migração:** 0085 (`quota_hold`, tabela nova e vazia). **ADR:** ADR-0055 (novo); notas em ADR-0009, ADR-0017,
ADR-0036 e ADR-0050 (dec. 3).

## 1. Escopo

- **#641:** geração de receita (`POST /api/generations` single e "gerar 2", `POST /api/recipes/[id]/regenerate`) e de
  imagem (`applyRecipeImageGeneration`) só tinham um pré-check de leitura antes do provedor; o gate atômico do #446
  rodava no persist. M pedidos paralelos com a cota em N-1 pagavam todos o provedor.
- **#640:** na conversa, o turno só contava quando a destilação persistia; abort depois dos tokens e destilação
  `invalid` saíam de graça.
- **Correção:** `reserveQuotaHold` grava uma linha em `quota_hold` sob a advisory lock do gate, antes da chamada paga
  (os pontos de chamada usam `tryReserveQuotaHold`, que devolve `{allowed, holdId}` ou `{allowed: false,
  retryAfterMs}`). A linha nasce cobrada (`expires_at = created_at + 24 h`) e conta na cota com peso `slots` (2 no
  "gerar 2"). Duas saídas: o persist a **consome** na mesma tx da `generation`/`image_generation` (gate com
  `consumeHoldId`), e a falha provadamente não paga do provedor a **devolve** (`releaseQuotaHold`). A tabela de quem
  cobra e quem devolve, por caminho, está no ADR-0055 (dec. 6).
- **"Não pago" é estrito** (ADR-0055, dec. 5):
  - fase de conexão: `isConnectPhaseFailure` (`src/server/http/connect-phase.ts`, fonte única para Claude e Gemini),
    por allowlist de códigos (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`,
    `UND_ERR_CONNECT_TIMEOUT`, certificado TLS). `ECONNRESET`, "other side closed", "terminated", timeout e abort
    ficam cobrados;
  - Claude: `parse_failed` com `cause: 'provider'` (`isUnpaidOutput(out)` na borda) só sem nenhuma tentativa do SDK
    que possa ter chegado ao modelo (o `fetch` instrumentado de `anthropicForPaidCall` liga `maybeBilled`), sem
    chamada anterior que voltou, e com erro final HTTP, `APIConnectionError` da fase de conexão ou
    `AnthropicKeyMissingError`;
  - stream: `ClaudeProviderUnavailableError` (a mesma regra, antes do 1º evento do SDK, ou sem chave);
  - Gemini: `ImageProviderUnavailableError` (`!res.ok`, falha de conexão, sem chave);
  - imagem do dono: a reserva só volta se o diretor de arte **não** rodou (`resolveImageScene` devolve
    `directorCalled`).
- **Conversa:** o cliente que já abortou antes da reserva não reserva (a rota devolve o NDJSON vazio de um abort). A
  linha `[conversations/stream] falha no stream:` loga a classe e o `status` do erro da Anthropic embrulhado (`providerErrorLogFields`), com `provedor=indisponivel`.
- **Registros:** `ERASURE_POLICY` (`keep_ledger`), `CONTENT_GUARDS`, passo de retenção `quotaHolds`, export LGPD
  (seção `quotaHolds`: `kind`, `slots`, `createdAt`, `expiresAt`; formato segue `v1`), ROPA (operação 5),
  `docs/legal/takedown-e-remocao-titular.md` (o que o export leva), `docs/observabilidade.md` (a linha da conversa).
  A reserva vence em 24 h e é apagada na passada diária seguinte do cron de retenção (uns 48 h no total). Política
  de Privacidade sem mudança (ADR-0055, dec. 9).

## 2. O que ler primeiro

1. `docs/adr/0055-reserva-de-cota-antes-da-chamada-paga.md` (a tabela da dec. 6 é o mapa; os riscos residuais estão
   no fim).
2. `src/server/quota/atomic.ts`: `reserveQuotaHold`, `tryReserveQuotaHold`, `releaseQuotaHold`, `activeHoldTimes` e
   os dois gates com `consumeHoldId`.
3. `src/server/http/connect-phase.ts` e `src/server/claude/client.ts`: `anthropicForPaidCall` (o `fetch`
   instrumentado), `ProviderAttempts`, `isUnpaidProviderError`, `AnthropicKeyMissingError`,
   `ClaudeProviderUnavailableError`, o contador `returned` de `generateRecipe`/`generateRecipeVariants` e o `try` do
   `streamConversation`; os contadores e o `streamError` do `FakeClaudeClient`.
4. `src/server/images/image-generator.ts`: `ImageProviderUnavailableError`; `ThrowingImageGenerator('unavailable' |
   'paid')`. `src/server/images/image-scene.ts`: `directorCalled`.
5. Os pontos de chamada: `src/app/api/generations/route.ts`, `src/server/recipe/regenerate.ts`,
   `src/server/recipe/image.ts` (só o caminho do dono), `src/app/api/conversations/stream/route.ts`
   (`streamPending`, o abort antes da reserva).
6. Os testes: `test/integration/quota-hold.test.ts` (concorrência, devolução, diretor, abort antes da reserva, gates
   contando reservas alheias, rollback, `tx`+`quota`, 55P03), `test/unit/claude-client-provider-cause.test.ts` (com o
   SDK real e o `fetch` dublado para as novas tentativas), `test/unit/image-generator-provider-cause.test.ts`,
   `test/integration/me-export.test.ts` (`quotaHolds`).

## 3. Ordem e dependências

1. A migração 0085 precisa existir antes de qualquer código que lê ou grava `quota_hold` (o build da Vercel roda
   `npm run db:migrate` antes do `next build`).
2. `reserveQuotaHold` e os gates com `consumeHoldId` (`atomic.ts`) vêm antes dos pontos de chamada.
3. A classificação do provedor (`connect-phase.ts` → `client.ts`/`image-generator.ts`) é independente da reserva;
   sem ela, a reserva continua correta, só cobra mais (nada volta).
4. O export, a retenção e a política de eliminação dependem só da tabela.
5. Fora do escopo: Extração e Sugestão de cardápio (ledger próprio, ADR-0036/#447).

## 4. Princípios inegociáveis

- **Toda chamada paga nova de receita/imagem reserva antes.** Reservar depois de tudo que devolve 4xx sem custo e
  imediatamente antes do provedor; passar `consumeHoldId` ao gate do persist; devolver só no erro provadamente não
  pago. Na dúvida, fica cobrada.
- **A reserva nunca vira estado "pendente".** Nada de `finally` que cobra: a Vercel mata a função sem rodar `finally`.
  Ela nasce cobrada e só sai consumida ou devolvida.
- **Lock primeiro, DELETE depois.** Nos gates, a própria reserva é apagada já sob a lock, antes da recontagem; senão
  outra requisição leria a contagem sem ela e passaria além do teto.
- **"Não pago" é prova, não palpite.** Só a allowlist da fase de conexão, a resposta HTTP de erro e a chave ausente
  provam. Uma chamada paga anterior no mesmo pedido (reparo, tentativa do SDK que pode ter chegado ao modelo, diretor
  de arte) derruba a prova.
- **`invalid` consome cota, mas nunca cria `generation`** (ADR-0006 intacto).
- **Contratos da UI intactos:** 429 `limite_geracao`/`limite_geracao_variacao` com `retryAfterMs`, 502
  `geracao_invalida`, frames NDJSON, `{kind:'quota'}` da imagem.

## 5. Landmines

- O SDK da Anthropic embrulha **qualquer** falha do `fetch` em `APIConnectionError` e tenta de novo sozinho
  (`maxRetries` 2). Por isso `isUnpaidProviderError` olha a `cause` e o `fetch` instrumentado olha cada tentativa.
  Ao subir a versão do SDK, confira que `new APIConnectionError({ cause })` ainda leva a rejeição do `fetch`, que a
  opção `fetch` do construtor ainda é a usada por tentativa, e que o erro SSE segue `APIError` com `status`
  undefined (senão `isUnpaidProviderError` devolveria o slot de um stream já pago).
- `Anthropic.APIError.generate(undefined, …)` devolve um `APIConnectionError` (sem status ou sem headers). O erro SSE
  real é montado com `new APIError(undefined, …)` em `core/streaming.js`; o teste unitário usa o construtor por isso.
- O `APIConnectionTimeoutError` nasce sem `cause`; vale a última rejeição do `fetch` (`ProviderAttempts.lastRejection`).
  Um timeout do próprio SDK (abort) é rejeição fora da fase de conexão e liga `maybeBilled`.
- Sem `ANTHROPIC_API_KEY` (ou `ANTHROPIC_AUTH_TOKEN`), `anthropicForPaidCall` lança `AnthropicKeyMissingError`
  **dentro** do `try`: o slot volta e o log `[claude/<método>] falha na chamada` traz o nome. Testes unitários que
  usam o `RealClaudeClient` com o SDK dublado precisam de `vi.stubEnv('ANTHROPIC_API_KEY', …)`.
- O diretor de arte (ADR-0044) vem ligado por padrão (`image_scene_director_enabled` default true). Num teste de
  imagem que espera a devolução do slot, desligue o diretor (o `setImageGenCap` de `quota-hold.test.ts` faz isso).
- O pré-check de leitura não conta reservas. Ele é só early-reject; quem barra é a reserva, e o gate do persist é a
  confirmação. Não o "conserte" para contar reservas sem a lock (vira outra corrida).
- `persistGeneration` com `tx` fornecida e `quota` junto lança (o "gerar 2" consome a reserva uma vez, na tx externa).
- `reserveQuotaHold` espera a lock com `lock_timeout` de 5 s; o 55P03 vira `QuotaExceededError` com
  `DERIVE_LOCK_BUSY_RETRY_MS` (429, nunca 500). O teste segura a lock numa 2ª conexão e leva uns 5 s.
- O passo de retenção `quotaHolds` mudou a linha `[retencao]` (o teste de `data-retention` tem a linha exata).
- Migração: só via `npm run db:migrate` (build da Vercel) ou `drizzle-kit migrate`. Nunca contra produção à mão.

## 6. Gotchas de ambiente

- Os testes de integração sobem um Postgres por Testcontainers: o Docker precisa estar rodando. **Nunca** exporte
  `DATABASE_URL`/`TEST_DATABASE_URL` no shell (o incidente de 2026-09-09, `docs/incidents/`).
- Em sessões com vários agentes, rode typecheck, lint e todo vitest sob `flock /var/tmp/vitest.lock`.
- `test/unit/claude-client-provider-cause.test.ts` precisa do `vi.resetModules()` antes do `import` do client: o
  `test/setup.ts` já carregou o client com o SDK real via `deps.ts`, e sem o reset o `vi.mock` não pega. O modo
  `sdk.real` desse teste devolve o SDK de verdade e dubla o `fetch` global (as novas tentativas esperam ~0,5 s).
- O preview da Vercel pode falhar de forma intermitente em PR com migração; rode de novo antes de investigar.

## 7. Follow-ups (sem issue ainda)

- **Extração e Sugestão de cardápio nunca devolvem o slot**, nem com o provedor fora do ar. Se isso incomodar,
  aplicar a mesma regra (reserva devolvida com a prova de "não pago") exige mudar o ledger delas.
- **O `retryAfterMs` do 429 causado por uma reserva em voo de outro pedido pode dizer ~24 h** (a decisão pura trata
  a reserva como um evento criado agora). Um countdown curto para esse caso pede distinguir "reserva em voo" de
  "reserva cobrada" na decisão.
- Os riscos residuais da ADR-0055 (HTTP de erro de um proxy depois de o modelo rodar; slot perdido em crash ou no
  ECONNRESET de socket velho) ficam como estão.

## 8. Critério de saída

- `checks` verde no PR (typecheck, lint, suíte de integração com Postgres real).
- Migração 0085 aplicada no build da Vercel; `quota_hold` vazia fora de gerações em voo e das inválidas/abortadas dos
  últimos um ou dois dias.
- Em produção: com a cota no último slot, dois cliques simultâneos em "Gerar" dão uma receita e um aviso de limite, e
  só uma chamada aparece no painel de custo.
- O export de uma conta com geração inválida recente traz a reserva em `quotaHolds`.
