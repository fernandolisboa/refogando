# ADR-0056 — Tradução sob demanda: single-flight, cache de falha, cota por usuário e teto da entrada

Status: aceito (2026-11-02)

Issue #642 (achado M-3 da auditoria SAST, `.security-audit/REPORT.md`). Migração 0086 (`recipe_translation_attempt`; `quota_hold` ganha o tipo `translation`). Relaciona: #23 (tradução sob demanda, AC4: falha degrada para o original), ADR-0030/0031 (tradutor real e re-tradução), #520 (circuit-breaker da re-tradução), ADR-0055 (reserva de cota antes da chamada paga), #588 (teto por papel em código), L-7 (campos sem tamanho máximo).

## Contexto

- `POST /api/recipes/[id]/translations/[locale]` chama `ensureTranslation`, que traduz pelo Claude (`RealTranslator`) qualquer receita pública para qualquer usuário logado, e a privada para o dono. Não havia teto.
- A falha (estouro de `max_tokens`, recusa, saída inválida, reprovação na fidelidade) **não grava nada**, por desenho (AC4 do #23). O efeito colateral: cada POST seguinte chama o modelo de novo, e um laço de POSTs numa receita que sempre falha vira um laço de chamadas pagas.
- POSTs simultâneos na 1ª tradução chamavam o modelo uma vez cada; o `onConflictDoNothing` só evitava a linha duplicada, depois de todos pagarem.
- A entrada não tinha tamanho máximo (L-7): uma receita enorme paga a chamada e ainda estoura o `max_tokens`.
- O único chamador de `ensureTranslation` é esse POST. Nenhuma tela o chama hoje, e publicar ou editar não traduz. O worker do admin (`retranslateOutdated`, #499) só **atualiza** linhas que já existem e já tem circuit-breaker (#520, `retranslate_fail_count/key` na própria linha). Esse breaker não serve aqui: quando a tradução sob demanda falha, não existe linha onde gravar o estado.
- O `RealTranslator` usa `new Anthropic()` direto, sem o `fetch` instrumentado do ADR-0055 (`anthropicForPaidCall`). Não há como provar que uma falha não foi cobrada.

## Decisão

1. **Tabela `recipe_translation_attempt`** (migração 0086): PK `(recipe_id, locale)`, FK `recipe` cascade, `lease_id`, `lease_until`, `failed_at`, `retry_at`, `fail_key`, `updated_at`. No máximo uma linha por par que ainda não tem tradução. Sem usuário e sem conteúdo (a chave é um hash da fonte, mais o slug da cozinha, que é um termo do vocabulário, e o id do modelo). O sucesso apaga a linha.
2. **Single-flight com lease, não com lock segurado.** `claimTranslationFlight` (`src/server/translation/flight.ts`) roda numa tx curta:
   - `set_config('lock_timeout', '2000ms', true)` (`TRANSLATION_PAIR_LOCK_TIMEOUT_MS`) → `pg_advisory_xact_lock(4678, hashtext(recipe_id || ':' || locale))` (classe nova `QUOTA_LOCK_CLASS.translationFlight`) → `lock_timeout` de volta ao default. A espera estourada (55P03) quer dizer que outro pedido está decidindo esse par agora: o claim devolve **`in_progress`** (200 no original), nunca 429. Quem espera pelo par é um terceiro, sem culpa da fila. O 55P03 aborta a tx, então o claim lança um sinal interno de dentro dela e o converte fora;
   - sob a lock, lê se a tradução já existe e o estado do par, e decide pela função pura `decideTranslationFlight` (`src/domain/translation-flight.ts`): `exists` → `in_progress` (lease valendo) → `cooling_down` (cooldown valendo **com a mesma chave**) → `go`;
   - no `go`, reserva a cota do usuário (dec. 4) e grava o lease (`lease_until = now() + 90 s`, `lease_id` novo).
   
   **Orçamento de tempo.** As duas esperas de lock do claim (par e usuário, dec. 4) têm teto de 2 s cada e correm **antes** do prazo de 50 s do tradutor (`TRANSLATION_DEADLINE_MS`, que começa na chamada). Somadas, ficam em ≤ 4 s, e o pior caso (≈ 54 s mais as leituras curtas do banco) cabe no `maxDuration = 60` da rota com folga para gravar a tradução depois da chamada paga. Com as esperas antigas de 5 s cada, a função podia passar dos 60 s depois de pagar e perder o resultado. Passar um prazo ao tradutor (`min(50 s, o que resta)`) foi descartado por ora: mais encanamento pelo seam, e com as esperas curtas não é preciso.

   A chamada ao modelo roda **depois do commit**, sem lock nem tx abertos. É o mesmo motivo do ADR-0055: uma lock segurada pelos 10–50 s da chamada prenderia uma conexão do pool por pedido. Não há precedente no repositório de lock atravessando chamada de rede. O lease vence sozinho se a Vercel matar a função (90 s > `maxDuration = 60`). Os fechamentos só agem se o `lease_id` ainda é o do pedido, então um voo substituído não apaga o estado do seguinte:
   - `completeTranslationFlight`: o sucesso apaga a linha;
   - `failTranslationFlight`: a falha grava o cache negativo e solta o lease;
   - `abandonTranslationFlight`: um erro inesperado no slug ou no INSERT solta o lease sem cache, e o erro sobe como antes.
3. **Cache negativo com a chave do #520 estendida.** A falha grava `failed_at`, `retry_at` e `fail_key = translationFlightFailKey(…)` (`src/domain/translation-flight.ts`): a chave do circuit-breaker da re-tradução, `retranslateFailKey(sourceFingerprintOf(fonte), TRANSLATION_PROMPT_VERSION)`, sem mudança, seguida de `:c=<cozinha>:m=<modelo/thinking/esforço>`. Os dois acréscimos também mudam a saída do modelo: a cozinha vai no system prompt, e o modelo e o ajuste da tarefa `translation` vêm do admin (ADR-0034, `Translator.modelConfigKey`, lido do mesmo `loadAiTask` da chamada). Sem o modelo na chave, subir o modelo para corrigir um truncamento não liberava as receitas em cooldown. O breaker do #520 continua com a chave antiga (o worker só atualiza linhas existentes e não lê esta tabela). O cooldown depende do tipo de falha:
   - **24 h** para a falha da linha (`isRowSpecificTranslationFailure`: `UnusableTranslationError`), que tende a se repetir com a mesma fonte;
   - **10 min** para infraestrutura (429/5xx/529, conexão, prazo, chave ausente), para uma queda do provedor não deixar a receita um dia sem tradução.
   
   A fonte editada, o prompt novo, a cozinha trocada ou o modelo/ajuste trocado no admin mudam a chave e liberam a tentativa na hora. Se a config do admin não puder ser lida, a chave sai com `m=-` (a chamada provavelmente falha igual, como infraestrutura).
4. **Cota por usuário com `quota_hold` kind `translation`, nunca devolvida.** Teto por papel em código, `TRANSLATION_CAP_BY_ROLE` = `usuario` 30, `curador` 60, `admin` ∞ (`capForTranslation`, mesma forma do #588), em janela deslizante de 24 h (`decideRecipeGenQuota`). A reserva usa `reserveQuotaHoldInTx`: o corpo de `reserveQuotaHold`, agora exportado para rodar dentro da tx do claim, com a lock por usuário `QUOTA_LOCK_CLASS.translation` (4677). A espera por ela tem teto de 2 s (`TRANSLATION_USER_LOCK_TIMEOUT_MS`, parâmetro `lockTimeoutMs`; os outros chamadores seguem com os 5 s de `DERIVE_LOCK_TIMEOUT_MS`), porque acontece com a lock do par já tomada: uma espera longa aqui seguraria o par, e quem espera por ele, atrás da fila de um usuário só. Ordem das locks fixa (par → usuário) em todo pedido, então não há deadlock. Como a tradução não tem evento próprio, **a reserva é o registro**: só as reservas ativas contam, e ela nasce cobrada e não é consumida nem devolvida (como o ledger da Extração). Só o pedido que vai chamar o modelo reserva: tradução já gravada, em voo, em cooldown ou grande demais não gasta slot. Estourou ⇒ a tx reverte (nem lease, nem reserva) e a rota responde **429 `limite_traducao`** com `retryAfterMs` (i18n `traducao.limite` nos dois locales). A espera estourada pela lock **do usuário** também vira 429, com `retryAfterMs = DERIVE_LOCK_BUSY_RETRY_MS` (5 s); a do par vira `in_progress` (dec. 2).
5. **Só a rota passa a cota.** `ensureTranslation(db, recipeId, locale, quota?)`: sem `quota` (chamada interna) não há reserva, mas o single-flight e o cache negativo valem igual. Hoje não existe chamada interna. O worker do admin (#499) não passa por `ensureTranslation` e mantém o breaker dele: os dois caminhos não se sobrepõem (um só cria linha que falta, o outro só atualiza linha existente).
6. **Teto da entrada, medido no que vai ao modelo.** `isTranslationInputTooLarge` recusa (`too_large`, sem chamada, sem lease e sem cota):
   - mais de `TRANSLATION_MAX_STEPS` (50) passos ou mais de `TRANSLATION_MAX_INGREDIENTS` (60) ingredientes. Checado antes de serializar. O catálogo semeado tem no máximo 8 passos e 14 ingredientes;
   - mais de `TRANSLATION_MAX_PAYLOAD_BYTES = TRANSLATION_MAX_TOKENS × 2` (8.192) bytes UTF-8 em `translationPayloadBytes`: o `userPrompt` serializado (`buildTranslationUserPrompt`, a mesma função que monta a mensagem enviada) mais a cozinha, a única parte do system prompt que varia por receita (o resto do system prompt é fixo).

   A 1ª versão somava o comprimento do texto cru, e o dono de uma receita privada desviava dela: um PATCH com ~1 milhão de passos `""` contava 0 caracteres e mandava ~3 MB; milhares de ingredientes de 1 letra custam ~25 bytes de JSON cada; um caractere de controle vira `\u0001` (6 bytes). O teto também não deixava folga para o JSON: uma receita perto dele truncava no `max_tokens` e queimava o slot.

   **Por que 8 KiB.** A saída é a mesma estrutura, traduzida. A tradução pt-BR ↔ en-US muda o tamanho em até ~25%, e texto de receita em JSON fica em ~3 a 4 bytes por token. A 3 bytes/token, 8 KiB × 1,25 ≈ 3,4 mil tokens de saída, abaixo dos 4096 do `max_tokens` com ~17% de folga. A maior receita do catálogo semeado tem ~1,6 KiB de payload, 5× abaixo do teto. Bytes e não caracteres porque o tokenizador trabalha em bytes: texto fora do alfabeto latino (2 a 4 bytes por caractere) pesa mais, como pesa em tokens. Os tetos de contagem cortam o caso de itens curtos, que custam mais tokens por byte.
7. **Contrato da rota.** `in_progress` (inclusive a lock do par ocupada além de 2 s), `cooling_down` e `too_large` devolvem 200 com a view no original, como o `degraded` de sempre (AC4). O único status novo é o 429 (cota estourada ou fila da lock do usuário cheia).
8. **Registros (privacidade).**
   - `quota_hold` ganha um tipo, sem coluna nova: `ERASURE_POLICY` (`keep_ledger`), `CONTENT_GUARDS`, o passo de retenção `quotaHolds` e o export (`quotaHolds` leva todas as reservas) já cobrem a linha. Comentários do export, da retenção e da eliminação atualizados.
   - ROPA, operação 5: "reserva de cota … de cada tradução sob demanda que a pessoa dispara (tipo e datas, sem o id da receita)". `docs/legal/takedown-e-remocao-titular.md` (o que o export leva) atualizado.
   - **A reserva não aponta para a receita, mas as datas podem.** A reserva e o lease nascem na mesma tx, com o mesmo `now()`: `quota_hold.created_at` é igual a `recipe_translation_attempt.updated_at` enquanto a linha do par não é reescrita. Durante a tentativa (≤ 90 s), ou até a próxima escrita no par depois de uma queda (lease vencido sem fechamento), quem lê o banco pode cruzar as duas datas e ligar o usuário à receita. Depois do fechamento, a linha do par some (sucesso) ou fica com datas da falha, segundos depois da reserva, que não casam exatamente mas ainda permitem uma aproximação por janela de tempo. Gravar o lease com `clock_timestamp()` deixaria as datas diferentes por microssegundos, sem desligar nada de verdade; preferimos dizer o que acontece. Só quem tem acesso ao banco faz esse cruzamento, e o export e a eliminação já tratam a reserva como dado da pessoa.
   - A Política de Privacidade não muda, pelo mesmo motivo do ADR-0055 (dec. 9): os "registros de uso" com a finalidade "controlar limites de uso e custo" já estão declarados para a tradução (3.3), e a retenção declarada (24 meses) é maior.
   - `recipe_translation_attempt` não tem FK para `users` e não guarda conteúdo. Sai junto com a receita (cascade, inclusive no apagamento das privadas na eliminação) e não entra no export.
   - Nenhuma linha de log nova.

## Alternativas rejeitadas

- **Advisory lock de sessão (ou tx aberta) durante a chamada ao modelo**: rejeitado, sem precedente. Prende uma conexão do pool (máx. 10 por instância) por 10–50 s por pedido; numa rajada, esgota o pool de todo mundo.
- **Gravar a falha na própria `recipe_translation`** (como o #520): não existe linha quando a tradução sob demanda falha, e uma linha "vazia" quebraria a leitura localizada e os slugs.
- **Devolver a reserva na falha provadamente não paga** (regra do ADR-0055): exigiria levar o `fetch` instrumentado para o `RealTranslator`. O teto da tradução é anti-abuso e folgado; o cache negativo já impede o laço numa receita. Errar a favor do custo aqui custa no máximo um slot de 30 por falha de infraestrutura.
- **Ledger novo `translation_event` com `user_id`**: duplicaria o que `quota_hold` já faz, com todo o registro de privacidade de uma tabela nova (eliminação, retenção, export, ROPA).
- **Só cota por usuário, sem cache negativo**: o usuário com cota gastaria 30 chamadas numa receita que sempre falha, e cada usuário novo outras 30.
- **429 também para `in_progress`/`cooling_down`**: mudaria o contrato do AC4 (falha degrada, nunca erro técnico) sem ganho; o pedido não custa nada nesses casos.
- **Cooldown único**: 24 h deixaria uma queda de minutos do provedor bloquear a receita por um dia; 10 min deixaria uma falha da linha repetir 144 vezes por dia.

## Consequências

- No máximo uma chamada por (receita, locale) por janela de cooldown, e uma por voo concorrente (testes com contador de chamadas em `test/integration/translation-flight.test.ts`).
- Uma falha da linha deixa a receita no original por 24 h, a menos que a fonte mude ou o prompt suba de versão.
- O usuário comum dispara no máximo 30 traduções pagas por 24 h; quem já está no teto recebe 429 mesmo para uma receita que nunca foi traduzida.
- Uma receita com mais de ~8 KiB de JSON, mais de 50 passos ou mais de 60 ingredientes nunca é traduzida sob demanda (estouraria o `max_tokens`, ou chegaria perto demais).
- Um pedido que espera mais de 2 s pela lock do par responde no original, como "em voo". Se o dono da lock depois reverter (cota estourada ou fila do usuário cheia), ninguém traduziu naquela hora; o próximo POST tenta.
- Uma linha por par que falhou fica na tabela até a receita sumir ou a tradução dar certo (no máximo receitas × locales; sem passo de retenção, porque não é dado pessoal).

## Riscos residuais

- **Edição em laço da própria receita**: cada edição muda a chave e libera uma chamada. A cota do dono (30/24 h) limita.
- **Crash entre o lease e a chamada**: o par fica 90 s "em voo" sem ninguém traduzindo, e o slot fica cobrado.
- **O countdown do 429** pode dizer ~24 h, pelo mesmo motivo do ADR-0055 (a reserva conta como um evento criado agora).
- **O teto da entrada é em bytes, não em tokens.** Texto que tokeniza pior que ~2,5 bytes por token (sequências sem sentido, escapes, alguns alfabetos) ainda pode estourar o `max_tokens` abaixo do teto. Custa uma chamada e um slot; o cache negativo de 24 h segura o laço.
- **Sem teto global diário.** A cota é por conta: N contas gratuitas disparam até N × 30 traduções por dia. O cadastro exige e-mail verificado, o que encarece criar contas em massa, mas não há teto agregado de custo da tarefa.
- **O abandono não grava cooldown.** `abandonTranslationFlight` só solta o lease. Hoje a única causa de abandono é uma corrida transitória no slug ou no INSERT, que não se repete; se aparecer uma causa persistente, o par chamaria o modelo a cada POST (limitado pela cota de cada usuário).
- **O upsert do `go` mantém o `retry_at` e o `fail_key` antigos.** Ao tomar o lease sobre uma linha que já falhou com outra chave, o claim só troca `lease_id`, `lease_until` e `updated_at`. É inofensivo: o cooldown antigo não casa com a chave nova, e o próximo fechamento (falha) sobrescreve os dois ou (sucesso) apaga a linha.
