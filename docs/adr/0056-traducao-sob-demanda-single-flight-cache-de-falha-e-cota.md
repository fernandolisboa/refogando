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

1. **Tabela `recipe_translation_attempt`** (migração 0086): PK `(recipe_id, locale)`, FK `recipe` cascade, `lease_id`, `lease_until`, `failed_at`, `retry_at`, `fail_key`, `updated_at`. No máximo uma linha por par que ainda não tem tradução. Sem usuário e sem conteúdo (a chave é um hash da fonte). O sucesso apaga a linha.
2. **Single-flight com lease, não com lock segurado.** `claimTranslationFlight` (`src/server/translation/flight.ts`) roda numa tx curta:
   - `set_config('lock_timeout', '5000ms', true)` → `pg_advisory_xact_lock(4678, hashtext(recipe_id || ':' || locale))` (classe nova `QUOTA_LOCK_CLASS.translationFlight`) → 55P03 vira `QuotaExceededError(DERIVE_LOCK_BUSY_RETRY_MS)` → `lock_timeout` de volta ao default;
   - sob a lock, lê se a tradução já existe e o estado do par, e decide pela função pura `decideTranslationFlight` (`src/domain/translation-flight.ts`): `exists` → `in_progress` (lease valendo) → `cooling_down` (cooldown valendo **com a mesma chave**) → `go`;
   - no `go`, reserva a cota do usuário (dec. 4) e grava o lease (`lease_until = now() + 90 s`, `lease_id` novo).
   
   A chamada ao modelo roda **depois do commit**, sem lock nem tx abertos. É o mesmo motivo do ADR-0055: uma lock segurada pelos 10–50 s da chamada prenderia uma conexão do pool por pedido. Não há precedente no repositório de lock atravessando chamada de rede. O lease vence sozinho se a Vercel matar a função (90 s > `maxDuration = 60`). Os fechamentos só agem se o `lease_id` ainda é o do pedido, então um voo substituído não apaga o estado do seguinte:
   - `completeTranslationFlight`: o sucesso apaga a linha;
   - `failTranslationFlight`: a falha grava o cache negativo e solta o lease;
   - `abandonTranslationFlight`: um erro inesperado no slug ou no INSERT solta o lease sem cache, e o erro sobe como antes.
3. **Cache negativo com a chave do #520.** A falha grava `failed_at`, `retry_at` e `fail_key = retranslateFailKey(sourceFingerprintOf(fonte), TRANSLATION_PROMPT_VERSION)`, a mesma chave do circuit-breaker da re-tradução. O cooldown depende do tipo de falha:
   - **24 h** para a falha da linha (`isRowSpecificTranslationFailure`: `UnusableTranslationError`), que tende a se repetir com a mesma fonte;
   - **10 min** para infraestrutura (429/5xx/529, conexão, prazo, chave ausente), para uma queda do provedor não deixar a receita um dia sem tradução.
   
   A fonte editada ou o prompt novo mudam a chave e liberam a tentativa na hora.
4. **Cota por usuário com `quota_hold` kind `translation`, nunca devolvida.** Teto por papel em código, `TRANSLATION_CAP_BY_ROLE` = `usuario` 30, `curador` 60, `admin` ∞ (`capForTranslation`, mesma forma do #588), em janela deslizante de 24 h (`decideRecipeGenQuota`). A reserva usa `reserveQuotaHoldInTx`: o corpo de `reserveQuotaHold`, agora exportado para rodar dentro da tx do claim, com a lock por usuário `QUOTA_LOCK_CLASS.translation` (4677) e a mesma espera com teto. Ordem das locks fixa (par → usuário) em todo pedido, então não há deadlock. Como a tradução não tem evento próprio, **a reserva é o registro**: só as reservas ativas contam, e ela nasce cobrada e não é consumida nem devolvida (como o ledger da Extração). Só o pedido que vai chamar o modelo reserva: tradução já gravada, em voo, em cooldown ou grande demais não gasta slot. Estourou ⇒ a tx reverte (nem lease, nem reserva) e a rota responde **429 `limite_traducao`** com `retryAfterMs` (i18n `traducao.limite` nos dois locales). A espera estourada por qualquer uma das locks também vira 429.
5. **Só a rota passa a cota.** `ensureTranslation(db, recipeId, locale, quota?)`: sem `quota` (chamada interna) não há reserva, mas o single-flight e o cache negativo valem igual. Hoje não existe chamada interna. O worker do admin (#499) não passa por `ensureTranslation` e mantém o breaker dele: os dois caminhos não se sobrepõem (um só cria linha que falta, o outro só atualiza linha existente).
6. **Teto da entrada.** `TRANSLATION_MAX_INPUT_CHARS = TRANSLATION_MAX_TOKENS × 3` (12.288 caracteres: título + descrição + passos + notas + nomes de ingrediente + cozinha). A saída tem o tamanho da entrada mais o JSON, e a 3–4 caracteres por token uma entrada maior estoura o `max_tokens`. Acima do teto, `too_large`, sem chamada, sem lease e sem cota.
7. **Contrato da rota.** `in_progress`, `cooling_down` e `too_large` devolvem 200 com a view no original, como o `degraded` de sempre (AC4). O único status novo é o 429.
8. **Registros (privacidade).**
   - `quota_hold` ganha um tipo, sem coluna nova: `ERASURE_POLICY` (`keep_ledger`), `CONTENT_GUARDS`, o passo de retenção `quotaHolds` e o export (`quotaHolds` leva todas as reservas) já cobrem a linha. Comentários do export, da retenção e da eliminação atualizados.
   - ROPA, operação 5: "reserva de cota … de cada tradução sob demanda que a pessoa dispara (tipo e datas, sem a receita)". `docs/legal/takedown-e-remocao-titular.md` (o que o export leva) atualizado.
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
- Uma receita acima de ~12 mil caracteres nunca é traduzida sob demanda (já estouraria o `max_tokens`).
- Uma linha por par que falhou fica na tabela até a receita sumir ou a tradução dar certo (no máximo receitas × locales; sem passo de retenção, porque não é dado pessoal).

## Riscos residuais

- **Edição em laço da própria receita**: cada edição muda a chave e libera uma chamada. A cota do dono (30/24 h) limita.
- **Crash entre o lease e a chamada**: o par fica 90 s "em voo" sem ninguém traduzindo, e o slot fica cobrado.
- **O countdown do 429** pode dizer ~24 h, pelo mesmo motivo do ADR-0055 (a reserva conta como um evento criado agora).
- **O teto da entrada é em caracteres, não em tokens.** Texto com muitos tokens por caractere ainda pode estourar o `max_tokens` abaixo do teto; o cache negativo de 24 h segura o laço.
