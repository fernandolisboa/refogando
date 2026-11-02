# ADR-0057 — Limitador persistido: vetor da busca, formulário de retirada, e-mails ao canal de privacidade e relato de erro

Status: aceito (2026-11-02)

Issues #643 e #648 (achados M-4 e M-9 da auditoria SAST, `.security-audit/REPORT.md`). Migração 0087 (`rate_limit_window`, `search_query_embedding`, `takedown_ticket.dpo_arrival_notified_at`). Política de Privacidade v3.7. Relaciona: #14 (camada semântica da busca), #119 (embedder real do Gemini), #399/#400/#413 (formulário de Seus direitos, SLA e alerta ao canal de privacidade), #449 (`rate_limit` persistido da Better Auth), #464 (reserva atômica do teto da Brave), ADR-0048 (relato de erro do navegador), ADR-0050 (retenção), ADR-0055/0056 (cotas antes da chamada paga).

## Contexto

- **Busca (M-4).** `GET /api/search` é aberto a visitante, e cada consulta nova chamava `getEmbedder().embed()`, o embedding pago do Gemini. Não havia limitador nem cache. A `GEMINI_API_KEY` é a mesma da geração de imagens e do vetor das receitas, então um laço de consultas aleatórias esgota a cota da chave para todo mundo.
- **Formulário de Seus direitos (M-9).** `POST /api/legal/takedown` é público, sem login nem captcha. O único limite era 1 envio/s por IP em memória (por instância; um IP novo, ou outra instância, passava). Cada envio grava um ticket e uma linha de auditoria e manda um e-mail ao canal de privacidade (`DSAR_DPO_EMAIL`) pelo Resend, a mesma cota dos e-mails de cadastro e de senha. Uma enxurrada inunda a caixa, gasta a cota dos e-mails de conta e enterra pedidos reais, com risco de perder o prazo legal de 15 dias.
- O alerta de SLA por ticket (dia 13, `notifyDpoRedTickets`) é a mesma enxurrada com atraso: 700 tickets falsos chegam ao vermelho no mesmo dia e saem 700 e-mails de uma vez.
- `/api/client-errors` (ADR-0048) tem limites só em memória; num laço espalhado por instâncias, o teto de 60 linhas/min vale por instância.
- O repositório já tinha o padrão do upsert atômico com teto (`reserveWebSearchQueries`, #464) e a tabela `rate_limit` da Better Auth (#449). Essa tabela tem chave única sem janela, guarda o IP em claro e segue a semântica da lib.

## Decisão

1. **Um limitador persistido só, de janela fixa** (`src/server/rate-limit/window.ts`, tabela nova `rate_limit_window`, PK `(bucket, key, window_start)`, `expires_at`, `count`). Um statement por regra, sem advisory lock:
   `INSERT … ON CONFLICT (bucket, key, window_start) DO UPDATE SET count = count + 1 WHERE count < :limite RETURNING count`.
   O lock de linha do ON CONFLICT serializa as concorrentes; RETURNING vazio = bloqueado. O contador nunca passa do limite e o bloqueado não estende a janela. A janela é alinhada à época (`windowStartOf`) no relógio do app, então todas as instâncias caem na mesma linha. `consumeRateLimits` aplica as regras em ordem e para na primeira que bloqueia (a do IP ou da conta antes da global, para quem passou do próprio limite não gastar o teto de todos).
   Não reusa a `rate_limit` da Better Auth: a semântica é outra (sem janela na chave) e ela guarda o IP em claro.
2. **A chave nunca é o dado em claro.** `limiterKey(escopo, valor)` = HMAC-SHA256 com o `BETTER_AUTH_SECRET` sobre `rate-limit:<escopo>:<valor>`, 22 caracteres base64url, como a chave do avatar (`avatar-blob.ts`) e a lápide do cadastro expurgado. O IP entra reduzido por `ipRateKey` (IPv6 pela /64). Os tetos que somam todo mundo usam a chave `global`. Sem segredo fora de teste, lança (fail-closed: um hash sem chave de um IPv4 cabe num dicionário).
3. **Tetos** (`RATE_LIMITS`, `src/domain/rate-limit-rules.ts`):

   | bucket | chave | limite |
   |---|---|---|
   | `search_embed_ip` | HMAC do IP (visitante) | 30 por 10 min |
   | `search_embed_user` | HMAC do id da conta (logado) | 120 por 10 min |
   | `search_embed_global` | `global` | 60 por minuto |
   | `takedown_ip` | HMAC do IP | 5 por 30 min |
   | `takedown_global` | `global` | 30 por hora |
   | `dpo_email` | `global` | 10 por hora |
   | `client_error_global` | `global` | 300 por minuto |

   Toda janela com chave de pessoa dura no máximo 30 min, para caber nas "até 2 horas" da política com a limpeza de hora em hora.
4. **Busca: o limite é do vetor, não da busca.** `resolveSearchQueryVector` (`src/server/search/query-embedding.ts`), que nunca lança:
   - forma canônica: NFKC, minúsculas, espaços colapsados, pontas aparadas e corte em `MAX_QUERY_LEN` (`canonicalSearchQuery`). É também o texto mandado ao embedder, então chave e vetor são função um do outro (antes ia o `q` cru; a caixa muda pouco o vetor);
   - cache, em paralelo com a leitura da sessão. Acerto ⇒ vetor, sem limitador e sem embedder;
   - na falta: limitador (conta se logado; senão IP, se houver; depois o global). Bloqueado, ou erro do banco no limitador ⇒ `null`;
   - embedder; saída malformada ⇒ `null`; grava no cache (best-effort).
   
   `null` é a degradação que a rota já tinha quando o Gemini falha: busca só textual (FTS + trigram), 200, sem erro para a pessoa e sem texto novo de i18n.
5. **Cache em tabela, não em memória.** `search_query_embedding`: `query_key` (PK, HMAC-SHA256 de `search-query:<EMBEDDING_VERSION>:<dimensão>:RETRIEVAL_QUERY:<consulta canônica>`, base64url inteiro), `embedding vector(1536)`, `model`, `created_at`. Vale 12 h (`SEARCH_QUERY_EMBEDDING_TTL_MS`), conferido na leitura. Linha vencida com a mesma chave é renovada no lugar.
   - **Por que tabela:** o critério de aceite é "busca repetida não chama o embedder de novo". Um LRU em memória vale só na instância e zera no cold start, e o laço espalhado cai sempre em instância fria. O custo da tabela é uma leitura por PK (poucos ms, mesma região do banco desde o ADR-0053) contra 100–300 ms e dinheiro da chamada ao Gemini, e roda em paralelo com a sessão. O tipo `vector(1536)` é o mesmo de `recipe_embedding` (6 KB por linha), e o vetor volta pronto para o `::vector` do loader.
   - **Privacidade:** a consulta pode ter qualquer coisa, então é tratada como dado pessoal. O texto não é guardado; a chave é HMAC (quem lê o banco não confere um dicionário de termos sem o segredo); a chave é a mesma para todos que buscam o mesmo termo, sem ligação com quem buscou; vida curta. Trocar modelo, dimensão ou tarefa troca a chave.
6. **Formulário de Seus direitos.** Duas camadas: o throttle em memória de 1/s por IP fica, antes do parse (barato); depois da validação (lixo não grava nada, então não gasta o teto) e antes do INSERT, o limitador persistido por IP e global. Bloqueado ⇒ 429 `rate_limited` com `retryAfterMs` e `retry-after`. O formulário mostra `seusDireitos.erroLimite` (pt-BR e en-US), que manda escrever para `privacidade@refogando.com`: o pedido nunca fica sem via, e o prazo corre do mesmo jeito. Erro do banco no limitador ⇒ 500 genérico, como o INSERT.
7. **Teto de e-mails ao canal de privacidade, sem perder aviso.**
   - O e-mail de chegada (`createTakedownTicket`) e o alerta de SLA por ticket (`notifyDpoRedTickets`) gastam o mesmo `dpo_email` (10 por hora). Acima do teto, o ticket é gravado normalmente; só o e-mail individual é poupado.
   - Coluna nova `takedown_ticket.dpo_arrival_notified_at`: carimbada quando o provedor aceita o e-mail de chegada. Nula = sem aviso (teto ou envio recusado). Os tickets de antes da migração nascem carimbados com `received_at`.
   - **Resumo diário** (`notifyDpoDigest`, no cron `dsar-sla` às 09:00 UTC, depois dos alertas): um e-mail, fora do teto, só quando há pendência. Traz os totais e até 20 protocolos de cada lista, os mais antigos primeiro: tickets abertos sem aviso de chegada e vermelhos/vencidos sem alerta individual. Mesma minimização do alerta (protocolo, tipo, datas, nível). Aceito ⇒ carimba os de chegada; os vermelhos não, porque o alerta individual é o deles e eles voltam amanhã.
   - Todo ticket aberto aparece na hora no painel de SLA do `/admin`, com ou sem e-mail.
   - Resultado: no máximo 10 e-mails por hora pelo teto, mais 1 resumo por dia.
   - Foi escolhido por ser o menor código novo: reusa o cron, o mailer, o padrão de carimbo do `dpo_notified_at` e o painel existente. O resumo também cobre o e-mail de chegada que falha, que antes se perdia em silêncio.
8. **Relato de erro do navegador:** teto global persistido de 300 linhas/min (`globalCap` em `createClientErrorIntake`; o route passa o do banco), consultado só depois do parse, antes de escrever. A chave é só `global`, então o IP continua só em memória (política 3.7 sem mudança). Banco fora ⇒ fail-open: os tetos em memória seguem, e o relato de erro não pode depender do banco.
9. **Limpeza e retenção.** A limpeza de hora em hora (`/api/cron/rate-limit-cleanup`, a mesma do `rate_limit`) apaga as janelas encerradas (`expires_at <= agora`) e os vetores com mais de 12 h, em lotes. A retenção diária ganha os passos `rateLimitWindows` e `searchQueryEmbeddings` (mesmas funções) como rede de segurança. O corpo do cron leva só contagens.
10. **Registros (privacidade).**
    - **Política v3.7** (`DATA_POLITICA_V3_7 = '2026-11-02'`, nos dois idiomas, rodapé de Seus direitos igual):
      - item 3.6: o código HMAC do IP ou da conta nos limites do formulário e do vetor da busca, até 2 h;
      - item 3.9: o vetor guardado até 24 h sem o termo, e os limites com a busca seguindo só pelo texto; base: legítimo interesse (prevenção de abuso e custo).
      Não mexe em consentimento, então não troca `AVISO_LEGAL_VERSAO` (critério da v3.4). Os Termos não mudam: não descrevem limites nem a busca.
    - ROPA, operações 2, 8 e 12.
    - `docs/legal/takedown-e-remocao-titular.md`.
    - Comentários do export e da eliminação: as duas tabelas não têm FK nem caminho de volta ao titular, então ficam fora do export e da eliminação.
    - `docs/observabilidade.md`: tag `[takedown]`, só com motivo ou nome do erro. Os 429 não logam.
    - Notas no ADR-0048 e no ADR-0050.

## Alternativas rejeitadas

- **Captcha (Turnstile) ou proof-of-work no formulário:** o fornecedor do captcha recebe o IP (operador novo de dado pessoal, transferência internacional, política e ROPA), e isso é decisão do controlador. Fica como follow-up. O limitador e o teto de e-mail fecham o critério de aceite sem ele.
- **Regra no Vercel Firewall:** fora do repositório, sem teste e sem revisão no PR; pode somar depois.
- **Embedding só para quem está logado:** tiraria a busca semântica do visitante (o pool da comunidade é o que ele vê) sem necessidade, porque o limite com degradação já protege a chave.
- **LRU em memória para o cache:** não cumpre o aceite entre instâncias (dec. 5).
- **Guardar o termo em claro no cache, ou um hash simples:** o texto é dado pessoal em potencial; um hash sem chave de termos curtos se inverte por dicionário.
- **Reusar a tabela `rate_limit` da Better Auth:** chave única sem janela, IP em claro, semântica da lib (a 1.6.17+ muda o comportamento concorrente, L-1 da auditoria).
- **Advisory lock + contagem:** o upsert com `WHERE count < limite` já é atômico (precedente #464), com um round trip só.
- **Somar todas as regras num statement (CTE):** contaria o global mesmo para quem já passou do limite por IP, e um IP sozinho poderia gastar o teto de todos.
- **Trocar o e-mail por ticket só pelo resumo diário:** atrasaria em até 24 h o aviso do pedido legítimo, que é o caso normal. O teto só morde na enxurrada.
- **429 na busca acima do limite:** quebraria o contrato do #14 (a busca degrada, nunca erro técnico) e puniria quem divide IP (CGNAT, escritório) por uma parte opcional do resultado.

## Consequências

- Um laço anônimo de consultas distintas chega a no máximo 30 chamadas ao Gemini por IP (/64 no IPv6) a cada 10 min, e o total de chamadas de busca a 60 por minuto, seja qual for o número de IPs. Acima disso, a busca segue só pelo texto.
- A mesma consulta (mesma forma canônica) chama o Gemini no máximo uma vez a cada 12 h, para todo mundo.
- Cada busca nova (falta no cache) custa até 4 statements a mais no banco (leitura do cache, 1–2 upserts do limitador, gravação do cache); o acerto custa 1 e economiza a chamada ao Gemini.
- O formulário aceita no máximo 30 pedidos por hora no total. Numa enxurrada, um pedido real pode receber o 429 e é mandado ao e-mail.
- O canal de privacidade recebe no máximo 10 e-mails por hora mais 1 resumo por dia.
- Duas tabelas novas pequenas (janelas de minutos; vetores de 12 h), limpas de hora em hora.

## Riscos residuais

- **Janela fixa:** em volta da virada passam até 2 × o limite. Aceito: os tetos são anti-abuso.
- **Negação do formulário:** quem inunda com muitos IPs fecha o formulário por até 1 h para todos. O e-mail continua (e o 429 diz isso); um captcha reduziria o risco (follow-up).
- **Negação da parte semântica da busca:** um laço de muitos IPs gasta o teto global de 60/min e a busca de todos fica só textual até a virada do minuto. Aceito: a degradação é graciosa, e a chave do Gemini (imagens, vetor das receitas) fica protegida, que era o ponto.
- **Canal lateral do cache:** pelo tempo de resposta dá para inferir se alguém buscou um termo nas últimas 12 h, sem saber quem. Baixo impacto.
- **CGNAT:** muitas pessoas atrás de um IPv4 dividem os 30 vetores por 10 min. Logado conta pela conta.
- **Relógio do app:** a janela usa o relógio da instância (NTP); um desvio de milissegundos só importa na virada.
- **O resumo diário carimba os de chegada pelo total, mas lista só 20.** O resto está no painel; o e-mail diz quantos são.
