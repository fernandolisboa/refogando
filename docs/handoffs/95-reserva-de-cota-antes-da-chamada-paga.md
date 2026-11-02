# Handoff 95 — Reserva de cota antes da chamada paga

**Data:** 2026-11-02.
**PR:** "Cota reservada antes da chamada paga: receita, imagem e conversa (#640, #641)".
**Base:** `main` depois do #639.
**Migração:** 0085 (`quota_hold`, tabela nova e vazia). **ADR:** ADR-0055 (novo); notas em ADR-0009, ADR-0017 e ADR-0036.

## 1. Escopo

- **#641:** geração de receita (`POST /api/generations` single e "gerar 2", `POST /api/recipes/[id]/regenerate`) e de
  imagem (`applyRecipeImageGeneration`) só tinham um pré-check de leitura antes do provedor; o gate atômico do #446
  rodava no persist. M pedidos paralelos com a cota em N-1 pagavam todos o provedor.
- **#640:** na conversa, o turno só contava quando a destilação persistia; abort depois dos tokens e destilação
  `invalid` saíam de graça.
- **Correção:** `reserveQuotaHold` grava uma linha em `quota_hold` sob a advisory lock do gate, antes da chamada paga.
  A linha nasce cobrada (`expires_at = created_at + 24 h`) e conta na cota com peso `slots` (2 no "gerar 2"). Duas
  saídas: o persist a **consome** na mesma tx da `generation`/`image_generation` (gate com `consumeHoldId`), e a falha
  provadamente não paga do provedor a **devolve** (`releaseQuotaHold`). A tabela de quem cobra e quem devolve, por
  caminho, está no ADR-0055 (dec. 6).
- **"Não pago" é estrito:** `parse_failed` com `cause: 'provider'` (Claude: `APIError` com `status` numérico ou
  `APIConnectionError` que não é timeout, sem chamada anterior que voltou); `ClaudeProviderUnavailableError` no stream
  (o mesmo teste, antes do 1º evento do SDK); `ImageProviderUnavailableError` (Gemini `!res.ok` ou falha de rede).
- **Registros:** `ERASURE_POLICY` (`keep_ledger`), `CONTENT_GUARDS`, passo de retenção `quotaHolds`, comentário do
  export, ROPA (operação 5). Política de Privacidade sem mudança (ADR-0055, dec. 9).

## 2. O que ler primeiro

1. `docs/adr/0055-reserva-de-cota-antes-da-chamada-paga.md` (a tabela da dec. 6 é o mapa).
2. `src/server/quota/atomic.ts`: `reserveQuotaHold`, `releaseQuotaHold`, `activeHoldTimes` e os dois gates com
   `consumeHoldId`.
3. `src/server/claude/client.ts`: `isUnpaidProviderError`, `ClaudeProviderUnavailableError`, o contador `returned`
   de `generateRecipe`/`generateRecipeVariants` e o `try` do `streamConversation`; os contadores e o `streamError` do
   `FakeClaudeClient`.
4. `src/server/images/image-generator.ts`: `ImageProviderUnavailableError`; `ThrowingImageGenerator('unavailable' |
   'paid')`.
5. Os pontos de chamada: `src/app/api/generations/route.ts`, `src/server/recipe/regenerate.ts`,
   `src/server/recipe/image.ts` (só o caminho do dono), `src/app/api/conversations/stream/route.ts`
   (`streamPending`).
6. `test/integration/quota-hold.test.ts` e `test/unit/claude-client-provider-cause.test.ts`.

## 3. Princípios inegociáveis

- **Toda chamada paga nova de receita/imagem reserva antes.** Reservar depois de tudo que devolve 4xx sem custo e
  imediatamente antes do provedor; passar `consumeHoldId` ao gate do persist; devolver só no erro provadamente não
  pago. Na dúvida, fica cobrada.
- **A reserva nunca vira estado "pendente".** Nada de `finally` que cobra: a Vercel mata a função sem rodar `finally`.
  Ela nasce cobrada e só sai consumida ou devolvida.
- **Lock primeiro, DELETE depois.** Nos gates, a própria reserva é apagada já sob a lock, antes da recontagem; senão
  outra requisição leria a contagem sem ela e passaria além do teto.
- **`invalid` consome cota, mas nunca cria `generation`** (ADR-0006 intacto).
- **Contratos da UI intactos:** 429 `limite_geracao`/`limite_geracao_variacao` com `retryAfterMs`, 502
  `geracao_invalida`, frames NDJSON, `{kind:'quota'}` da imagem.

## 4. Landmines

- `Anthropic.APIError.generate(undefined, …)` devolve um `APIConnectionError` (sem status ou sem headers). O erro SSE
  real é montado com `new APIError(undefined, …)` em `core/streaming.js`; o teste unitário usa o construtor por isso.
  Ao subir a versão do SDK, confira que o erro SSE segue `APIError` com `status` undefined e não vira
  `APIConnectionError` (senão `isUnpaidProviderError` devolveria o slot de um stream já pago).
- O `new Anthropic()` fica fora do `try` em `generateRecipe`: sem `ANTHROPIC_API_KEY`, a rota dá 500 e a reserva fica
  cobrada (não foi pago, mas é erro de deploy, não do provedor). Se isso incomodar, mova para dentro do `try` com um
  erro tipado.
- O pré-check de leitura não conta reservas. Ele é só early-reject; quem barra é a reserva. Não o "conserte" para
  contar reservas sem a lock (vira outra corrida).
- `persistGeneration` com `tx` fornecida e `quota` junto lança (o "gerar 2" consome a reserva uma vez, na tx externa).
- O passo de retenção `quotaHolds` mudou a linha `[retencao]` (o teste de `data-retention` tem a linha exata).
- Migração: só via `npm run db:migrate` (build da Vercel) ou `drizzle-kit migrate`. Nunca contra produção à mão.

## 5. Critério de saída

- `checks` verde no PR (typecheck, lint, suíte de integração com Postgres real).
- Migração 0085 aplicada no build da Vercel; `quota_hold` vazia fora de gerações em voo e das inválidas/abortadas das
  últimas 24 h.
- Em produção: com a cota no último slot, dois cliques simultâneos em "Gerar" dão uma receita e um aviso de limite, e
  só uma chamada aparece no painel de custo.
