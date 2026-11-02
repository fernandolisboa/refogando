# ADR-0055 — Reserva de cota antes da chamada paga (geração de receita e de imagem)

Status: aceito (2026-11-02)

Issues #640 e #641. Migração 0085 (`quota_hold`). Relaciona: #446 (gate atômico no persist), ADR-0017 (teto de imagem), ADR-0036 (cota da Sugestão de cardápio, reservada antes da chamada), ADR-0006/0009 (inválido não vira `generation`), ADR-0050 (retenção).

## Contexto

- O #446 fechou a corrida TOCTOU do **teto**: o persist toma `pg_advisory_xact_lock(classe, hashtext(user_id))`, reconta e só então insere a `generation`/`image_generation`. Mas na geração de receita (`POST /api/generations`, single e "gerar 2"; `POST /api/recipes/[id]/regenerate`; a conversa) e na de imagem (`applyRecipeImageGeneration` → Gemini) o gate rodava **depois** do provedor. Antes dele só havia um pré-check de leitura: M pedidos paralelos com a cota em N-1 passavam todos e **todos pagavam o provedor**; o persist barrava M-1, com o custo já gasto (#641).
- Na conversa, o turno só contava quando a destilação persistia: o cliente que abortava depois dos tokens, ou cuja destilação dava `invalid`, nunca era cobrado, e podia repetir isso sem teto (#640).
- A Extração (#447) e a Sugestão de cardápio (ADR-0036) já reservam antes da chamada, com um ledger imutável (uma linha por tentativa, nunca devolvida). Receita e imagem não podem usar o mesmo desenho: o ledger delas são as próprias linhas de `generation`/`image_generation`, gravadas só no persist e com conteúdo (ADR-0006 proíbe a `generation` do `invalid`).

## Decisão

1. **Tabela `quota_hold`** (migração 0085): `id`, `user_id` (FK `users` cascade), `kind` (`recipe_gen` | `image_gen`, CHECK), `slots` (1–2, CHECK; 2 no "gerar 2"), `created_at`, `expires_at`; índice `(user_id, kind, expires_at)`. Sem conteúdo. A linha **conta** na cota do `kind`, com peso `slots`, enquanto `expires_at > agora`.

   > **Nota (ADR-0056, 2026-11-02):** o CHECK ganhou o tipo `translation` (migração 0086): a tradução sob demanda disparada por um usuário. Ela não tem evento próprio, então a reserva é o registro: nunca é consumida nem devolvida e conta até vencer. `reserveQuotaHoldInTx` expõe o corpo de `reserveQuotaHold` para rodar dentro da tx do lease da tradução.
2. **A reserva nasce cobrada.** `reserveQuotaHold` (`src/server/quota/atomic.ts`) insere com `expires_at = now() + janela (24 h)`: o instante em que um evento gravado agora sairia da janela. Na decisão pura, cada reserva ativa entra como `slots` cópias do seu `created_at` — `decideRecipeGenQuota`/`decideImageQuota` e o `retryAfterMs` não mudam. Não há estado "pendente" nem cobrança num `finally`: função morta pelo timeout da Vercel, crash ou abort deixam o slot gasto (erra a favor do custo; o pior caso é o usuário perder um slot num crash entre a reserva e a chamada).
3. **Só duas saídas:**
   - **consumir** — o gate do persist (`assertRecipeGenSlotInTx`/`assertImageGenSlotInTx` com `consumeHoldId`) apaga a reserva **na mesma tx** em que grava a `generation`/`image_generation`, que passa a contar no lugar dela. Se a tx reverter (o teto baixou no meio, 23505, erro), a reserva volta a existir: cobrada, porque a chamada foi paga;
   - **devolver** — `releaseQuotaHold` (DELETE, idempotente, best-effort) quando a falha do provedor provadamente **não foi cobrada** (regra 5).
4. **Ordem e locks.** `reserveQuotaHold` copia o idioma de `assertDeriveSlotInTx`: `set_config('lock_timeout', '5000ms', true)` → lock da **mesma classe** do gate do persist (`recipeGen` 4671 / `imageGen` 4672, para serializar com ele) → 55P03 vira `QuotaExceededError(DERIVE_LOCK_BUSY_RETRY_MS)` (429, nunca 500) → `set local lock_timeout to default` → reconta eventos + reservas ativas → decide com `cap - (slots - 1)` → estourou ⇒ `QuotaExceededError` → INSERT. Os gates do persist passam a contar as reservas ativas dos **outros** pedidos (senão deixariam passar além do teto) na ordem lock → DELETE da própria reserva → recontagem. Cap ∞ (admin) ⇒ sem lock, sem linha. O "gerar 2" consome a reserva uma vez, no gate da tx externa; `persistGeneration` com `tx` fornecida e `quota` junto é erro de chamador. Os quatro pontos de chamada usam `tryReserveQuotaHold`, que devolve `{allowed: true, holdId}` ou `{allowed: false, retryAfterMs}` (a forma dos `peek*`), e o "não cobrado" da saída do Claude é `isUnpaidOutput(out)` (`src/domain/generation.ts`).
5. **Regra estrita do "não cobrado".**
   - **Fase de conexão** (`isConnectPhaseFailure`, `src/server/http/connect-phase.ts`, fonte única para Claude e Gemini): uma falha do `fetch` só prova "não cobrado" quando a cadeia de `cause` traz um código da fase de conexão: `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`, `UND_ERR_CONNECT_TIMEOUT` ou a recusa do certificado no handshake TLS. `ECONNRESET`, `UND_ERR_SOCKET` ("other side closed"), "terminated", `EPIPE`, `ETIMEDOUT`, abort e timeout podem acontecer com o corpo já enviado e ficam cobrados. Decide o primeiro nó da cadeia com `code`; um `AggregateError` só conta se todas as tentativas dentro dele forem da fase de conexão.
   - **Claude** (`RealClaudeClient`): o SDK tenta de novo sozinho (`maxRetries` 2) e embrulha **qualquer** falha do `fetch` em `APIConnectionError`. Por isso cada chamada paga constrói o cliente com um `fetch` instrumentado (`new Anthropic({ fetch })`, `anthropicForPaidCall`) que liga `maybeBilled` quando alguma tentativa rejeita fora da fase de conexão (inclusive o timeout e o abort do SDK) ou recebe 2xx, e guarda a última rejeição. O `parse_failed` ganha `cause: 'provider'` só quando **nenhuma** tentativa pode ter chegado ao modelo (`!maybeBilled`), nenhuma chamada `messages.parse` anterior do mesmo método voltou (o reparo pressupõe uma 1ª chamada paga) **e** o erro final é: `APIError` com `status` numérico (o provedor respondeu um erro HTTP), `APIConnectionError` (inclusive o de timeout, que o SDK monta sem `cause`: vale a última rejeição do `fetch`) da fase de conexão, ou `AnthropicKeyMissingError` (sem `ANTHROPIC_API_KEY` no ambiente, lançado dentro do `try` antes de construir o SDK: nada saiu). Assim a 1ª tentativa resetada no meio (talvez cobrada) seguida de um 529 na 3ª fica cobrada. Sem `cause`: abort do cliente e o prazo de 50 s (`APIUserAbortError`), erro de parse/zod dentro do `messages.parse`, saída truncada, saída nula após o reparo, `refusal`, `max_tokens`. Mesma regra no lote do "gerar 2".
   - **Stream da conversa**: `streamConversation` lança `ClaudeProviderUnavailableError` (o erro original em `cause`) só quando o erro acima acontece **antes do 1º evento** do SDK, ou quando falta a chave. Depois do 1º evento (o thinking é pago antes de qualquer texto) o erro sobe como veio; o erro SSE no meio do stream tem `status` undefined e também fica cobrado. A linha `[conversations/stream] falha no stream:` loga a classe do erro embrulhado (`constructor.name`, porque os erros do SDK não definem `name`) e o `status` HTTP, com `provedor=indisponivel`. O cliente que já abortou antes da reserva não reserva: a rota devolve o mesmo NDJSON vazio de um abort.
   - **Gemini** (`RealGeminiImageGenerator`): `ImageProviderUnavailableError` só para `!res.ok`, falha do `fetch` na fase de conexão e chave ausente (`requireKey`). As outras falhas do `fetch` viram um `Error` comum (cobrado). Resposta 200 sem bytes (bloqueio de segurança), corpo ilegível, falha do Blob e a imagem-base sumida (23503) vêm depois do Gemini pago e ficam cobradas.
6. **Quem cobra, quem devolve, por caminho.**

   | Caminho | Reserva (antes de quê) | Devolve | Fica cobrada |
   |---|---|---|---|
   | `POST /api/generations` single | depois do pré-check e de todo 4xx, antes do Claude | `parse_failed` com `cause:'provider'` | `invalid` de qualquer outra causa (502), 429 do gate, erro inesperado |
   | "gerar 2" (#423) | idem, `slots: 2` | lote `[{parse_failed, cause:'provider'}]` | lote inválido (502), uma variação inválida |
   | `POST /api/recipes/[id]/regenerate` | depois de dono/fonte/pré-check, antes do Claude | `parse_failed` com `cause:'provider'` | `invalid` (502) |
   | Conversa (`/api/conversations/stream`) | logo antes de `new ReadableStream` (o 429 segue JSON); cliente já abortado não reserva | `ClaudeProviderUnavailableError` antes de qualquer token | abort depois da reserva, destilação inválida (inclusive com `cause:'provider'`: o stream já foi pago), 23505, `controller.error`, cota no gate |
   | Imagem do dono | depois de dono, bloqueio, config, pré-check e bytes da imagem-base, antes do núcleo (diretor de arte + Gemini) | `ImageProviderUnavailableError`, se o diretor de arte não rodou | sem bytes, Blob, 23503, cota no gate; Gemini indisponível depois de uma chamada do diretor |
   | Imagem do catálogo / curador | — (sem teto, sem reserva; inalterado) | — | — |

   O diretor de arte (ADR-0044) continua fora da cota, mas a chamada dele é paga: `resolveImageScene` devolve `directorCalled`, e com ela a reserva **não** volta mesmo quando o Gemini falha sem cobrar (senão o diretor rodaria de graça e o pedido repetido viraria um laço de chamadas pagas ao Claude). Um turno de conversa = um slot (no caminho feliz já era assim: cada POST persiste uma `generation`).
7. **Contratos intactos.** Os mesmos 429 (`limite_geracao`, `limite_geracao_variacao`, com `retryAfterMs`), 502 `geracao_invalida`, frames NDJSON e `{kind:'quota'}` da imagem. O pré-check de leitura continua como early-reject barato (não conta reservas). Quem barra antes da chamada é a reserva; o gate do persist é a confirmação, que a consome.
8. **ADR-0006 intacto, cota consumida.** `invalid` **agora consome cota** (a reserva fica cobrada por 24 h), mas **nunca cria `generation`**: nenhum episódio de criação nasce de erro de sistema.
9. **Registros.** A reserva vence em 24 h e é apagada na passada diária seguinte do cron de retenção, então uma linha vive uns 48 h (mais, se a passada atrasar ou adiar o passo).
   - `ERASURE_POLICY`: `quota_hold.user_id` = `keep_ledger` (como `extraction_event`; fica até a retenção apagar).
   - `CONTENT_GUARDS` do expurgo de cadastro: incluída (FK cascade).
   - Retenção: passo `quotaHolds` em `RETENTION_STEPS` apaga `expires_at <= agora` (vencida não conta; é higiene). Nota no ADR-0050, dec. 3.
   - Export LGPD: seção `quotaHolds` (`kind`, `slots`, `createdAt`, `expiresAt`), ao lado de `extractionEvents`; a versão do formato segue `v1` (só acrescenta). A reserva consumida é apagada e vira a geração do export; as que sobram estão em voo ou ficaram cobradas sem linha de `generation`/`image_generation` (saída inválida, turno abortado, crash), então não aparecem em nenhum outro lugar, e a política promete os "registros de uso" no export.
   - ROPA, operação 5: "reserva de cota: vence em 24 h; apagada na passada diária seguinte do cron de retenção".
   - A Política de Privacidade não muda: "registros de uso" com a finalidade "controlar limites de uso e custo" já estão declarados, e a retenção declarada (24 meses) é maior.

## Alternativas rejeitadas

- **Hold pendente com TTL curto e cobrança num `finally`** (o 1º desenho do plano): rejeitado na revisão. Um `finally` não roda quando a Vercel mata a função; o pedido abortado no meio da chamada some sem cobrar, e a conta de "pendente vs. cobrada" duplica estados para nada.
- **Devolver em qualquer `parse_failed` vindo de exceção**: rejeitado. O prazo de 50 s, a saída truncada e o erro de parse acontecem depois de o provedor gerar (e cobrar) a resposta; devolver abriria um laço de chamadas pagas sem teto.
- **Ledger imutável como Extração/Sugestão** (uma linha por tentativa, nunca devolvida): rejeitado para receita e imagem. Duplicaria o evento no caminho feliz (a `generation` já é o evento) e cobraria a indisponibilidade do provedor, que não custou nada.
- **Lock de sessão segurando a chamada inteira**: rejeitado. Seguraria uma conexão do pool por 10–50 s por pedido; a reserva segura a lock por uma transação curta.

## Consequências

- Pedidos paralelos acima do teto param na reserva, antes do provedor (testes de concorrência com contador de chamadas em `test/integration/quota-hold.test.ts`).
- Saída inválida e abort da conversa passam a gastar o slot. O usuário que bate em `geracao_invalida` repetidas vezes chega ao teto (antes, não).
- Uma linha a mais por geração em voo, até o consumo; a inválida ou abortada fica até a passada de retenção depois de vencer, então a tabela guarda um ou dois dias.
- Extração e Sugestão de cardápio seguem como estão (ledger que nunca devolve); a regra de devolver na indisponibilidade provada vale só para receita e imagem.

## Riscos residuais (não eliminados)

- **HTTP de erro conta como "não cobrado".** A regra confia que a Anthropic e o Gemini não cobram uma resposta 4xx/5xx/529. Um 5xx de um proxy no caminho depois de o modelo ter rodado (502/504 do gateway) também devolveria o slot. O SDK da Anthropic repete os 5xx sozinho (até 3 tentativas): se todas voltam 5xx e nenhuma rejeitou fora da fase de conexão, a reserva volta, mesmo que algum desses 5xx tenha vindo depois de o pedido chegar ao modelo. Não há como distinguir isso do lado do cliente.
- **Erra a favor do custo em vários pontos**, e o usuário perde o slot sem ter sido cobrado: ECONNRESET num socket keep-alive velho antes de escrever o pedido; crash ou timeout da Vercel entre a reserva e a chamada; o diretor de arte que falhou sem cobrar seguido do Gemini fora do ar; `releaseQuotaHold` que falha no banco (best-effort).
- **A allowlist depende dos códigos do undici/Node.** Uma versão do Node que troque o código (ou um `fetch` sem `cause`) faz a falha cair em "cobrada", nunca em "devolvida".
- **O 2xx sempre liga `maybeBilled`.** No stream, um 200 seguido de erro antes do 1º evento fica cobrado, mesmo que a Anthropic não tenha cobrado.
- **Extração e Sugestão de cardápio nunca devolvem o slot**, nem quando o provedor está fora do ar (ledger de outro desenho, ADR-0036/#447).
- **O countdown do 429 pode dizer ~24 h** quando o slot está ocupado por uma reserva em voo de outro pedido: a decisão pura trata a reserva como um evento criado agora, e o pedido em voo vai consumi-la (ou devolvê-la) em segundos.
