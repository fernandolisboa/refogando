# Handoff 97 — Limitador persistido: vetor da busca, formulário de retirada, e-mails ao canal de privacidade e relato de erro

**Data:** 2026-11-02.
**Commits:** "Limitador persistido: busca anônima e notificação de retirada (#643, #648)" e, em cima, "Limitador: achados
da revisão (#643, #648)" (painel de revisão: reserva no relato de erro, teto diário do Resend, balde próprio do alerta de
prazo, `halfvec` e teto do cache, texto honesto da política), no branch local `wip-643-648`.
**Base:** `e0cfb64` (`wip-642`: tradução single-flight, migração 0086, ADR-0056, handoff 96), que fica em cima do PR #651
(reserva de cota, migração 0085). **Este trabalho depende dos dois** só pela ordem das migrações (0085 → 0086 → 0087); o
código não toca `quota_hold` nem a tradução.
**Migração:** 0087 (`rate_limit_window` e `search_query_embedding`, tabelas novas e vazias; `takedown_ticket` ganha
`dpo_arrival_notified_at`, nullable, com os existentes carimbados com `received_at`).
**ADR:** ADR-0057 (novo); notas em ADR-0048 (dec. 4) e ADR-0050 (dec. 3).
**Política:** v3.7 (`DATA_POLITICA_V3_7 = '2026-11-02'`), itens 3.6 e 3.9. Termos sem mudança.

## 1. Escopo

- **#643 (M-4):** `GET /api/search` chamava o embedding pago do Gemini em toda busca, até anônima, sem limite nem cache.
  - `resolveSearchQueryVector` (`src/server/search/query-embedding.ts`): forma canônica (NFKC, minúsculas, espaços)
    → curta (< 3 caracteres) ou sem letra/dígito para aqui (só textual) → cache por HMAC (`search_query_embedding`,
    `halfvec`, 6 h da hora cheia, até 5000 linhas), em paralelo com a sessão → limitador (conta e global dos logados,
    ou IP e global dos visitantes; o global que barra devolve a unidade da conta/IP) → embedder → grava o cache.
  - Acima do limite, ou com qualquer falha, o vetor é `null` e a busca segue só textual (FTS + trigram), 200, como
    quando o Gemini falha.
- **#648 (M-9):** `POST /api/legal/takedown` público, com só 1/s por IP em memória, e um e-mail ao canal de
  privacidade por ticket, na cota do Resend dos e-mails de conta.
  - Limitador persistido por IP (5 por 30 min, IPv6 pela /64) e global (30 por hora), depois da validação e antes do
    INSERT. 429 `rate_limited` com `retryAfterMs` e `retry-after`, e o formulário mostra `seusDireitos.erroLimite`
    (manda escrever para o e-mail).
  - E-mails ao canal (Resend, 100/dia no plano grátis, a cota dos e-mails de conta): chegada `dpo_email_arrival` 5/h;
    alerta de prazo `dpo_email_sla` 10/h (balde próprio, mais antigos primeiro); teto diário `dpo_email_day` 20/24 h,
    do qual a chegada usa só 10 (`DPO_ARRIVAL_DAY_SHARE`). Acima deles, o ticket é gravado e o e-mail individual vira o
    **resumo diário** (`notifyDpoDigest`, cron `dsar-sla`), fora dos tetos: vermelhos primeiro e todos, depois as
    chegadas (até 20), sem repetir ticket.
  - `/api/client-errors`: teto global persistido de 300 linhas/min (chave `global`, sem IP), fail-open; a vaga da
    instância é reservada antes do `await`, o global tem 750 ms, e "cheio" fica em cache até a virada do minuto.
  - Freio de 1/s em memória: 429 `muito_rapido` → `seusDireitos.erroRapido`; teto total estourado → uma linha
    `[takedown] limite=atingido bucket=takedown_global` por janela e instância.
- **Um limitador só** (`src/server/rate-limit/window.ts`): janela fixa,
  `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < limite RETURNING count`. Chave = HMAC do IP ou da
  conta com uma subchave HKDF do segredo do auth (`limiterKey`, `derivedSubkey`), ou `global`.
- **Limpeza:** a de hora em hora (`/api/cron/rate-limit-cleanup`) apaga janelas encerradas e vetores com mais de 6 h; a
  retenção diária tem os passos `rateLimitWindows` e `searchQueryEmbeddings` como rede de segurança.
- **Privacidade:**
  - política v3.7 nos dois idiomas, rodapé de Seus direitos igual;
  - ROPA operações 2, 8 e 12 (a 12 na LIA A);
  - `docs/legal/takedown-e-remocao-titular.md`;
  - comentários do export e da eliminação (as tabelas novas não têm FK nem caminho de volta ao titular);
  - `docs/observabilidade.md` (tag `[takedown]`).
- **Fora:** captcha (Turnstile etc.), que traria um operador novo de dado pessoal e é decisão do Fernando; regra no
  Vercel Firewall; chave do Gemini separada para os embeddings.

## 2. O que ler primeiro

1. `docs/adr/0057-limitador-persistido-busca-e-formulario-de-retirada.md`.
2. `src/domain/rate-limit-rules.ts`: os tetos (`RATE_LIMITS`) e `windowStartOf`.
3. `src/server/rate-limit/window.ts`: `consumeRateLimit`, `consumeRateLimits`, `limiterKey`,
   `deleteExpiredRateLimitWindows`.
4. `src/server/search/query-embedding.ts` e `src/domain/search-query-key.ts`; o encaixe em
   `src/app/api/search/route.ts` (procure `resolveSearchQueryVector`).
5. `src/app/api/legal/takedown/route.ts`, `src/server/legal/takedown-intake.ts` (`notifyArrival`),
   `src/server/legal/dpo-alert.ts` (`notifyDpoRedTickets` com teto e `notifyDpoDigest`),
   `src/app/api/cron/dsar-sla/route.ts`.
6. `src/server/http/client-error-intake.ts` (`globalCap`) e `src/app/api/client-errors/route.ts`.
7. Testes: `test/integration/rate-limit-window.test.ts` (atomicidade com `Promise.all`, virada da janela, ordem das
   regras, HMAC, limpeza, retenção, cron), `test/integration/search-query-embedding.test.ts` (cache, laço anônimo com
   FTS, /64, teto global, logado pela conta, TTL), `test/integration/takedown-flood.test.ts` (IP /64, IPs variados, teto
   de e-mail, resumo, alerta vermelho com teto, cron), `test/integration/client-errors-global-cap.test.ts`,
   `test/domain/search-query-key.test.ts`, os casos novos em `test/ui/client-errors-route.test.ts` e
   `test/ui/privacy-policy.test.tsx`.

## 3. Ordem e dependências

1. Migrações 0085 (#651) e 0086 (#642) entram antes; a 0087 é a próxima do journal.
2. A migração 0087 precisa existir antes do código (o build da Vercel roda `npm run db:migrate` antes do `next build`).
   O `UPDATE` de backfill de `dpo_arrival_notified_at` roda na mesma migração; a tabela de tickets é pequena.
3. `src/domain/rate-limit-rules.ts` → `src/server/rate-limit/window.ts` → consumidores (busca, formulário, e-mails,
   relato de erro) → limpeza (cron e retenção).
4. Política v3.7: se o merge escorregar de dia, trocar `DATA_POLITICA_V3_7` e a data em prosa do ADR-0057, do ROPA
   (cabeçalho) e deste handoff, só neste PR.

## 4. Princípios inegociáveis

- **A chave do limitador e do cache nunca é o dado em claro.** IP e conta entram por `limiterKey` (HMAC com o segredo
  do auth); a consulta, por `searchQueryCacheKey`. O texto buscado nunca é gravado.
- **A busca nunca dá erro por causa do limite.** Bloqueado, cache fora, limitador fora ou embedder fora ⇒ vetor `null`
  ⇒ só textual, 200 (contrato do #14). `resolveSearchQueryVector` não lança.
- **Limitador fora na busca é fail-closed** (sem limitador a chamada paga não sai); **no relato de erro é fail-open** (os
  tetos em memória seguem); **no formulário é 500**, como o INSERT.
- **Ordem das regras: a específica (IP/conta) antes da global.** Quem passou do próprio limite não pode gastar o teto
  de todos.
- **Nenhum pedido do titular fica sem aviso:** acima do teto de e-mail o ticket é gravado, aparece no painel de SLA e
  entra no resumo diário. O 429 do formulário aponta o e-mail do canal.
- **Toda janela com chave de pessoa dura no máximo 30 min** (política: "até 2 horas" com a limpeza de hora em hora).
- **Política e código andam juntos:** mudou um teto que afete o que a política diz (janela, prazo do cache), muda o
  texto no mesmo PR.

## 5. Landmines

- O relógio da janela é o do app (`now` injetável). Os testes congelam o `Date` com `vi.useFakeTimers({ toFake:
  ['Date'] })` para os laços não cruzarem a virada; não congele os timers de verdade (o postgres-js usa `setTimeout`).
- O `setWhere` do upsert só guarda o UPDATE: o INSERT da 1ª linha da janela entra com 1, então limite 0 é tratado antes
  do banco (`consumeRateLimit` devolve bloqueado sem tocar nada).
- O throttle em memória do formulário (1/s por IP CRU) fica no módulo entre testes do mesmo arquivo: use IPs próprios
  por teste. Para provar o limite persistido por IP sem bater no de memória, gire endereços IPv6 da mesma /64.
- `limiterKey`/`searchQueryCacheKey` lançam sem `BETTER_AUTH_SECRET` fora de teste. Trocar o segredo zera o cache e
  os contadores (aceito).
- O cache é lido com `model = EMBEDDING_VERSION` e o corte de 6 h sobre `created_at`, que é a HORA CHEIA da gravação
  (`cacheCreatedAt`): um teste de TTL conta da hora cheia, não do instante; trocar a geometria do embedding troca a chave e o
  `model`, e as linhas antigas só saem pela limpeza.
- A forma canônica é o texto mandado ao embedder (minúsculas). Um teste que dependa da caixa do texto da CONSULTA no
  `FakeEmbedder` vai ver minúsculas.
- `notifyDpoRedTickets` agora para no teto (`break`) e devolve só os enviados; os que sobram voltam no resumo e amanhã.
- O resumo diário carimba **todos** os de chegada pendentes (lista só 20 que não estejam em vermelho); os vermelhos são
  todos listados e nunca carimbados por ele.
- `dpo_email_day` é UMA linha por dia com dois limites: a chegada consome com `limit: DPO_ARRIVAL_DAY_SHARE`, o alerta de
  prazo com o limite cheio. Trocar um sem o outro desfaz a reserva do alerta.
- `halfvec` pede pgvector ≥ 0.7. A 0087 roda `ALTER EXTENSION vector UPDATE` só se a instalada for mais antiga; a
  versão do Neon de produção não foi conferida (a imagem dos testes tem 0.8.7).
- `consumeRateLimits` devolve (`releaseRateLimit`) as regras que passaram quando uma seguinte bloqueia. Uma linha pode
  ficar com `count = 0`; a limpeza a leva junto quando a janela encerra.
- Migração: só via `npm run db:migrate` (build da Vercel) ou `drizzle-kit migrate`. Nunca contra produção à mão.

## 6. Gotchas de ambiente

- Testes de integração sobem um Postgres por Testcontainers: o Docker precisa estar rodando. **Nunca** exporte
  `DATABASE_URL`/`TEST_DATABASE_URL` no shell (o incidente de 2026-09-09, `docs/incidents/`).
- Em sessões com vários agentes, rode typecheck, lint e todo vitest sob `flock /var/tmp/vitest.lock`.
- O worktree novo não tem `node_modules`: `npm ci` antes.
- `drizzle-kit generate` lê `.env.local` mas não conecta no banco; gere a migração sem exportar URL nenhuma. O cabeçalho
  de comentário e o `UPDATE` de backfill da 0087 foram acrescentados à mão depois do generate.

## 7. Follow-ups (sem issue ainda)

- **Captcha no formulário de Seus direitos** (Turnstile ou proof-of-work): precisa de decisão do Fernando (operador novo,
  política, ROPA). Reduz o risco residual de uma enxurrada fechar o formulário por 1 h.
- **Chave do Gemini separada para embeddings** (sugestão do #643): isola a cota das imagens.
- **L-9** (Descoberta na web com limite por instância) e **L-12** (limites em memória) podem migrar para
  `consumeRateLimit` com um bucket novo.
- Calibrar os tetos com o uso real (logs de 429 não existem de propósito; olhar `rate_limit_window` em produção pelo
  console do Neon, só leitura).
- `.security-audit/REPORT.md` ainda marca M-4 e M-9 como "ABERTO"; atualizar quando o PR entrar.

## 8. Critério de saída

- `checks` verde no PR (typecheck, lint, suíte de integração com Postgres real).
- Migração 0087 aplicada no build da Vercel; `rate_limit_window` e `search_query_embedding` crescendo e sendo limpas de
  hora em hora (o corpo do cron `rate-limit-cleanup` traz `windows` e `searchVectors`).
- Em produção: buscas repetidas não aparecem de novo no uso do Gemini; um laço de buscas de um IP passa a responder
  só textual depois de 30 vetores; o canal de privacidade recebe no máximo 20 e-mails por dia mais o resumo diário.
- Política v3.7 publicada em `/privacidade` e o rodapé de `/seus-direitos` igual.
