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
   O lock de linha do ON CONFLICT serializa as concorrentes; RETURNING vazio = bloqueado. O contador nunca passa do limite e o bloqueado não estende a janela. A janela é alinhada à época (`windowStartOf`) no relógio do app, então todas as instâncias caem na mesma linha. `consumeRateLimits` aplica as regras em ordem e para na primeira que bloqueia (a do IP ou da conta antes da global, para quem passou do próprio limite não gastar o teto de todos). As regras que já tinham passado são devolvidas (`releaseRateLimit`, `count - 1` na mesma janela, best-effort): quem o teto global barrou não perde a cota própria por um pedido que não saiu.
   Não reusa a `rate_limit` da Better Auth: a semântica é outra (sem janela na chave) e ela guarda o IP em claro.
2. **A chave nunca é o dado em claro.** `limiterKey(escopo, valor)` = HMAC-SHA256 sobre `rate-limit:<escopo>:<valor>`, 22 caracteres base64url, com uma subchave derivada do `BETTER_AUTH_SECRET` por HKDF-SHA256 (`derivedSubkey`, info `refogando/rate-limit`; o cache da busca usa `refogando/search-query`), e não com o segredo cru que assina as sessões. O IP entra reduzido por `ipRateKey` (IPv6 pela /64). Os tetos que somam todo mundo usam a chave `global`. Sem segredo fora de teste, lança (fail-closed: um hash sem chave de um IPv4 cabe num dicionário). **Limite honesto:** o segredo fica fora do banco (variável de ambiente da Vercel); sem ele, o código não volta ao IP nem à conta. Com ele, um IPv4 se recupera por força bruta (2³² tentativas), então o segredo nunca vai ao banco nem ao log.
3. **Tetos** (`RATE_LIMITS`, `src/domain/rate-limit-rules.ts`):

   | bucket | chave | limite |
   |---|---|---|
   | `search_embed_ip` | HMAC do IP (visitante) | 30 por 10 min |
   | `search_embed_user` | HMAC do id da conta (logado) | 120 por 10 min |
   | `search_embed_global_anon` | `global` | 60 por minuto (visitantes) |
   | `search_embed_global_user` | `global` | 60 por minuto (pessoas logadas) |
   | `takedown_ip` | HMAC do IP | 5 por 30 min |
   | `takedown_global` | `global` | 30 por hora |
   | `dpo_email_arrival` | `global` | 5 por hora (aviso de chegada) |
   | `dpo_email_sla` | `global` | 10 por hora (alerta de prazo por ticket) |
   | `dpo_email_day` | `global` | 20 por 24 h (meia-noite UTC), somando os dois; a chegada só usa 10 (`DPO_ARRIVAL_DAY_SHARE`) |
   | `client_error_global` | `global` | 300 por minuto |

   Toda janela com chave de pessoa dura no máximo 30 min, para caber nas "até 2 horas" da política com a limpeza de hora em hora.
4. **Busca: o limite é do vetor, não da busca.** `resolveSearchQueryVector` (`src/server/search/query-embedding.ts`), que nunca lança:
   - forma canônica: NFKC, minúsculas, espaços colapsados, pontas aparadas e corte em `MAX_QUERY_LEN` (`canonicalSearchQuery`). É também o texto mandado ao embedder, então chave e vetor são função um do outro (antes ia o `q` cru; a caixa muda pouco o vetor);
   - forma canônica com menos de 3 caracteres ou sem letra nem dígito (`embeddableSearchQuery`) ⇒ `null` antes de tudo: sem cache, sem limitador, sem embedder. Corta os prefixos de 1–2 letras que a digitação dispara (a busca roda a cada pausa de 300 ms) e as consultas só de pontuação, em que o loader ignoraria o vetor;
   - cache, em paralelo com a leitura da sessão. Acerto ⇒ vetor, sem limitador e sem embedder;
   - na falta: limitador (logado: conta e o global das pessoas logadas; visitante: IP, se houver, e o global dos visitantes). Os globais são separados para um laço anônimo não tirar a busca semântica de quem tem conta. Bloqueado, ou erro do banco no limitador ⇒ `null`;
   - embedder; saída malformada ⇒ `null`; grava no cache (best-effort), salvo se a tabela já tem `SEARCH_QUERY_EMBEDDING_MAX_ROWS` (5000) linhas, conferido por uma contagem que para no teto (`SELECT count(*) FROM (SELECT 1 … LIMIT 5000)`).
   
   `null` é a degradação que a rota já tinha quando o Gemini falha: busca só textual (FTS + trigram), 200, sem erro para a pessoa e sem texto novo de i18n.
5. **Cache em tabela, não em memória.** `search_query_embedding`: `query_key` (PK, HMAC-SHA256 de `search-query:<EMBEDDING_VERSION>:<dimensão>:RETRIEVAL_QUERY[:e2e-fake]:<consulta canônica>`, base64url inteiro; o marcador só no modo fake do E2E, para um vetor do `FakeEmbedder` nunca dividir chave com um real), `embedding halfvec(1536)`, `model`, `created_at` (a hora cheia da gravação). Vale 6 h (`SEARCH_QUERY_EMBEDDING_TTL_MS`), contadas da hora cheia (na prática 5–6 h), conferido na leitura. Linha vencida com a mesma chave é renovada no lugar.
   - **Armazenamento:** com `vector(1536)` (~6 KB por linha), um laço de 60 falhas por minuto durante 12–13 h passaria de 290 MB, perto do 0,5 GB do plano grátis do Neon. Por isso: `halfvec` (meia precisão, ~3 KB; pede pgvector ≥ 0.7, e a migração 0087 atualiza a extensão se a instalada for mais antiga; a imagem dos testes traz 0.8.7), teto de 5000 linhas (~15–20 MB) e validade de 6 h. A meia precisão muda o cosseno na 3ª–4ª casa, abaixo do ruído do ranking. O loader lê o `halfvec` como `number[]` e o manda com `::vector`, como o vetor que acabou de sair do Gemini.
   - **Por que tabela:** o critério de aceite é "busca repetida não chama o embedder de novo". Um LRU em memória vale só na instância e zera no cold start, e o laço espalhado cai sempre em instância fria. O custo da tabela é uma leitura por PK (poucos ms, mesma região do banco desde o ADR-0053) contra 100–300 ms e dinheiro da chamada ao Gemini, e roda em paralelo com a sessão.
   - **Privacidade:** a consulta pode ter qualquer coisa, então o vetor é tratado como dado pessoal. O texto não é guardado, nem conta, nem IP: a chave é a mesma para todos que buscam o mesmo termo. O que a proteção NÃO garante, e a política não promete:
     - **dicionário pelo vetor:** o modelo é público; quem lê o banco pode embedar um termo candidato e comparar com os vetores guardados. O HMAC só impede conferir a lista contra as CHAVES. Por isso a vida é curta (6 h) e a tabela tem teto;
     - **horário:** um `created_at` em milissegundos casaria com o de outro registro (a janela do limitador de quem está logado, um log). Fica arredondado para a hora cheia;
     - **segredo:** quem tem o `BETTER_AUTH_SECRET` refaz os HMAC (dec. 2).
     Trocar modelo, dimensão ou tarefa troca a chave.
6. **Formulário de Seus direitos.** Duas camadas: o throttle em memória de 1/s por IP fica, antes do parse (barato); depois da validação (lixo não grava nada, então não gasta o teto) e antes do INSERT, o limitador persistido por IP e global. Bloqueado ⇒ 429 `rate_limited` com `retryAfterMs` e `retry-after`. O formulário mostra `seusDireitos.erroLimite` (pt-BR e en-US), que manda escrever para `privacidade@refogando.com`: o pedido nunca fica sem via, e o prazo corre do mesmo jeito. Erro do banco no limitador ⇒ 500 genérico, como o INSERT.
7. **Teto de e-mails ao canal de privacidade, sem perder aviso.**
   - Os e-mails ao canal saem pelo Resend, na mesma cota dos e-mails de cadastro e de senha: 100 por dia no plano grátis (ADR-0014). Um teto só por hora ainda deixaria 240 por dia, então há também um teto diário.
   - O e-mail de chegada (`createTakedownTicket`) gasta `dpo_email_arrival` (5 por hora) e uma unidade de `dpo_email_day` com limite 10 (`DPO_ARRIVAL_DAY_SHARE`).
   - O alerta de SLA por ticket (`notifyDpoRedTickets`, prazo legal) tem balde próprio, `dpo_email_sla` (10 por hora), que a chegada não gasta, e usa `dpo_email_day` com o limite cheio (20). Como a chegada consome a mesma linha diária com limite menor (o upsert só soma enquanto `count < limite` de quem chama), sobram sempre 10 por dia para os alertas de prazo, mesmo numa enxurrada de chegadas. Os candidatos vão pelo `received_at` mais antigo primeiro (prazo mais perto).
   - Acima do teto, o ticket é gravado normalmente; só o e-mail individual é poupado. No pior caso, 20 e-mails por dia ao canal mais o resumo, e sobram 79 da cota do Resend para os e-mails de conta.
   - Coluna nova `takedown_ticket.dpo_arrival_notified_at`: carimbada quando o provedor aceita o e-mail de chegada. Nula = sem aviso (teto ou envio recusado). Os tickets de antes da migração nascem carimbados com `received_at`.
   - **Resumo diário** (`notifyDpoDigest`, no cron `dsar-sla` às 09:00 UTC, depois dos alertas): um e-mail, fora dos tetos, só quando há pendência. Primeiro TODOS os vermelhos/vencidos sem alerta individual (nunca ficam escondidos atrás de um corte), depois os tickets abertos sem aviso de chegada que não estão em vermelho, até 20, os mais antigos primeiro. Um ticket nas duas listas aparece uma vez, como vermelho, e o assunto conta tickets distintos. Mesma minimização do alerta (protocolo, tipo, datas, nível). Aceito ⇒ carimba todos os de chegada; os vermelhos não, porque o alerta individual é o deles e eles voltam amanhã.
   - Todo ticket aberto aparece na hora no painel de SLA do `/admin`, com ou sem e-mail.
   - Resultado: no máximo 20 e-mails por dia pelos tetos (até 10 de chegada), mais 1 resumo por dia.
   - Foi escolhido por ser o menor código novo: reusa o cron, o mailer, o padrão de carimbo do `dpo_notified_at` e o painel existente. O resumo também cobre o e-mail de chegada que falha, que antes se perdia em silêncio.
8. **Relato de erro do navegador:** teto global persistido de 300 linhas/min (`globalCap` em `createClientErrorIntake`; o route passa o do banco), consultado só depois do parse, antes de escrever. A chave é só `global`, então o IP continua só em memória (política 3.7 sem mudança). Banco fora ⇒ fail-open: os tetos em memória seguem, e o relato de erro não pode depender do banco.
   - A vaga do teto da instância (60/min) é reservada ANTES do `await` do global e devolvida se o global barrar; sem isso, os pedidos concorrentes passariam todos pelo check enquanto esperam o banco.
   - O global tem 750 ms para responder (`globalCapTimeoutMs`); passou ⇒ fail-open. O `connect_timeout` do banco é 30 s, e o relato não pode segurar a função esse tempo.
   - Global cheio fica guardado na instância até a virada da janela global: o resto do minuto responde 429 sem ir ao banco.
9. **Limpeza e retenção.** A limpeza de hora em hora (`/api/cron/rate-limit-cleanup`, a mesma do `rate_limit`) apaga as janelas encerradas (`expires_at <= agora`) e os vetores com mais de 6 h (da hora cheia), em lotes. A retenção diária ganha os passos `rateLimitWindows` e `searchQueryEmbeddings` (mesmas funções) como rede de segurança. O corpo do cron leva só contagens.
10. **Registros (privacidade).**
    - **Política v3.7** (`DATA_POLITICA_V3_7 = '2026-11-02'`, nos dois idiomas, rodapé de Seus direitos igual):
      - item 3.6: o código HMAC do IP ou da conta nos limites do formulário e do vetor da busca, até 2 h, calculado com uma chave secreta guardada fora do banco (sem ela, não dá para recuperar o IP ou a conta). A política não diz que o código é irreversível em absoluto (dec. 2);
      - item 3.9: o vetor guardado até 24 h (o código vence em 6 h; a política ficou com a margem) sem guardar o termo nem quem buscou, com a hora arredondada, e tratado como dado pessoal por derivar do termo; os limites com a busca seguindo só pelo texto; base: legítimo interesse (prevenção de abuso e custo). A política não promete "sem ligação" (dec. 5).
      Não mexe em consentimento, então não troca `AVISO_LEGAL_VERSAO` (critério da v3.4). Os Termos não mudam: não descrevem limites nem a busca.
    - ROPA, operações 2, 8 e 12; a 12 entrou na LIA A (necessidade do cache e do limite).
    - `docs/legal/takedown-e-remocao-titular.md`.
    - Comentários do export e da eliminação: as duas tabelas não têm FK nem caminho de volta ao titular, então ficam fora do export e da eliminação.
    - `docs/observabilidade.md`: tag `[takedown]`, só com motivo, nome do erro ou o bucket. Os 429 não logam, salvo uma linha `[takedown] limite=atingido bucket=takedown_global` por janela e instância quando o teto TOTAL do formulário barra (sinal de enxurrada, sem IP nem conteúdo; cabe no item 3.7).
    - O 429 do freio em memória de 1 envio/s (clique duplo) responde `muito_rapido`, e o formulário mostra `seusDireitos.erroRapido` ("espere um instante"), não o `erroLimite` do formulário pausado.
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

- Um laço anônimo de consultas distintas chega a no máximo 30 chamadas ao Gemini por IP (/64 no IPv6) a cada 10 min, e o total de chamadas de busca de visitantes a 60 por minuto, seja qual for o número de IPs; as pessoas logadas têm outros 60 por minuto. Acima disso, a busca segue só pelo texto.
- A mesma consulta (mesma forma canônica) chama o Gemini no máximo uma vez a cada 5–6 h, para todo mundo, enquanto o cache tiver menos de 5000 linhas.
- Cada busca nova (falta no cache) custa até 4 statements a mais no banco (leitura do cache, 1–2 upserts do limitador, gravação do cache); o acerto custa 1 e economiza a chamada ao Gemini.
- O formulário aceita no máximo 30 pedidos por hora no total. Numa enxurrada, um pedido real pode receber o 429 e é mandado ao e-mail.
- O canal de privacidade recebe no máximo 20 e-mails por dia (5 de chegada por hora, até 10 por dia; 10 alertas de prazo por hora) mais 1 resumo por dia.
- Duas tabelas novas pequenas (janelas de minutos a 1 dia; até 5000 vetores de 6 h, ~15–20 MB), limpas de hora em hora.

## Riscos residuais

- **Janela fixa:** em volta da virada passam até 2 × o limite. Aceito: os tetos são anti-abuso.
- **Negação do formulário:** quem inunda com muitos IPs fecha o formulário por até 1 h para todos. O e-mail continua (e o 429 diz isso); um captcha reduziria o risco (follow-up).
- **Negação da parte semântica da busca:** um laço de muitos IPs gasta o teto global dos visitantes (60/min) e a busca dos visitantes fica só textual até a virada do minuto; quem está logado tem o próprio teto global (um laço de muitas contas faria o mesmo com ele). Aceito: a degradação é graciosa, e a chave do Gemini (imagens, vetor das receitas) fica protegida, que era o ponto.
- **Canal lateral do cache:** pelo tempo de resposta dá para inferir se alguém buscou um termo nas últimas 6 h, sem saber quem. Baixo impacto.
- **Dicionário pelo vetor:** quem lê o banco pode conferir se um termo candidato foi buscado nas últimas 6 h, embedando o termo e comparando (dec. 5). Sem quem buscou, e com a hora arredondada. Aceito, com vida curta e teto.
- **Cache cheio:** um laço de 5000 consultas distintas em 6 h enche o cache; até as linhas vencerem, consultas novas pagam o Gemini (dentro dos limites) sem ficar guardadas. Aceito: o teto é de armazenamento, os limites seguram o custo.
- **Consultas curtas:** 1–2 caracteres nunca têm a parte semântica (num idioma com palavras de 2 caracteres, como o japonês, isso pesaria; o app é pt-BR e en-US).
- **Relato de erro com banco lento:** passado o timeout de 750 ms, o relato passa sem o teto global (fail-open), e a consulta ao banco segue e ainda conta a unidade.
- **CGNAT:** muitas pessoas atrás de um IPv4 dividem os 30 vetores por 10 min. Logado conta pela conta.
- **Relógio do app:** a janela usa o relógio da instância (NTP); um desvio de milissegundos só importa na virada.
- **O resumo diário carimba os de chegada pelo total, mas lista só 20 deles** (os vermelhos, todos). O resto está no painel; o e-mail diz quantos são.
- **Corpo do resumo numa enxurrada:** todos os vermelhos listados podem dar centenas de linhas num dia ruim. Aceito: é um e-mail por dia, e esconder um vermelho seria pior.
