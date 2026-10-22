# ADR-0049 — Retenção e eliminação de dados pessoais

Status: aceito (2026-10-22)

Issues #473 (retenção e eliminação) e #596 (EXIF/GPS no servidor). Base: o sign-off interno `docs/legal/parecer-interno-2026-10-22.md` §5 (e os achados 2, 3, 13, 14 e 15 do §4) e o registro `docs/legal/registro-de-operacoes.md` (operações 2 a 5, 8, 9 e 13). Sem migração: tudo usa colunas que já existem.

## Contexto

- A eliminação self-service (#401, PR #410) anonimizava a linha `users`, apagava sessões, credenciais, Cardápio e Despensa e mantinha o resto ligado à conta anonimizada: Receitas privadas, conversas e pedidos à IA, salvos, coleções, Listas de compras, follows e notificações. O parecer (achado 2) classificou isso como obrigatório: o conteúdo privado não serve a mais ninguém, e a política não dizia que ficava.
- Nada tinha prazo. Sessões vencidas (com IP e navegador) nunca saíam, os ledgers de uso de IA cresciam sem fim, e tickets de takedown e auditoria DSAR não tinham expurgo (achados 3 e 13).
- Avatar e Imagem da receita iam ao Blob público com o EXIF/GPS do celular sempre que o cliente mandava os bytes crus; só a foto de avaliação era limpa no servidor (achado 14).
- Duas linhas de log passavam o objeto do erro inteiro e uma a mensagem crua (achado 15); um erro do Drizzle leva os parâmetros da query.

## Decisão

1. **A eliminação apaga o privado na hora**, na mesma transação da anonimização (`purgePrivateContentInTx`, `src/server/legal/private-content.ts`, chamado por `eraseOwnAccount`):

   | Destino | O quê |
   |---|---|
   | Apaga | Receitas privadas (em cascata: traduções, ingredientes, tags, embedding e, se a Receita já foi pública, saves, avaliações e denúncias de terceiros; as fotos dessas avaliações saem junto); a face delas pelo ref-count de sempre (`reapOrphanImage`), menos a face de linhagem com Receita de catálogo ou de outro dono; as imagens de galeria da pessoa que nenhuma Receita usa, com a mesma ressalva de linhagem; coleções, salvos, Listas de compras, follows nos dois sentidos, notificações recebidas, Cardápio, Despensa, sessões, credenciais (`account`) e `verification` com `value` = id da conta. |
   | Limpa (a linha fica) | Todas as sessões de criação: a Transcrição sai, `creation_session.free_text`, `generation.advisory_comment` e `generation.prompt_stamp` viram NULL, o Briefing perde os itens e os campos (`observacoes`, `cozinha`, `porcoes`, `dificuldade` NULL; `restricoes` vazio). O `prompt_stamp` não tem leitor no código e carrega eixos do Perfil (nível, voz), então vira NULL inteiro. |
   | Fica | Receitas públicas e avaliações, com o autor anonimizado (a foto da avaliação sai 180 dias depois, pelo `account-purge`); denúncias feitas pela pessoa e os papéis de moderação (`moderated_by`, `reviewed_by`, `resolved_by`); notificações em que ela é a autora do evento; os ledgers de uso, até o prazo da decisão 3; a auditoria DSAR. |

   - `ERASURE_POLICY` dá um destino a cada FK para `users.id`. Um teste lê as FKs do schema e reprova FK nova sem destino.
   - Os blobs (original e derivados) saem depois do commit, best-effort e com no máximo 8 deleções ao mesmo tempo (`deleteOrphanBlobsConcurrently`).
   - O `DSAR_RECEIVED` do pedido (`account_erasure`) passa a levar as contagens no `details` (só números).
   - `emitNotification` não notifica destinatário anonimizado.

2. **Varredura diária das contas já eliminadas** (cron `account-purge`, `purgeAnonymizedPrivateContent` em `src/server/legal/account-purge-scan.ts`).
   - Candidata: conta com `anonymized_at` e alguma sobra (`privateLeftovers`), na ordem de `anonymized_at`. Lote de 25 contas e orçamento de 40 s (reserva de 15 s): sem tempo, não começa conta nova.
   - Cada conta roda na sua transação, re-checa a anonimização sob lock e usa a mesma função da decisão 1.
   - Não há prazo de espera. É a regra da decisão 1 aplicada a quem eliminou antes dela, e é também a rede das corridas: uma geração em voo que grava Receita depois do commit da eliminação.
   - Quando algo muda, grava `DSAR_FULFILLED` (`account_private_purge`, com hash, `actor_id` NULL).
   - A falha numa conta não para as outras. Sai a linha `[account-purge] conteúdo privado de uma conta anonimizada falhou: erro=…`, e a passada responde 500.

3. **Prazos** (cron `/api/cron/retention`, diário às 11:30 UTC, `src/server/legal/data-retention.ts`). O prazo legal é de calendário. Em `src/domain/data-retention.ts` ele vira dias arredondados para cima, para nada sair antes do prazo em nenhuma data de partida; o preço é guardar até 2 dias a mais.

   | Dado | Prazo | Como |
   |---|---|---|
   | `image_generation`, `meal_plan_suggestion_event` | 24 meses (731 dias) | DELETE por `created_at`. |
   | `generation` de conta viva | 24 meses | A linha fica, porque é o histórico de criação (operação 4). Tokens e custo viram NULL, porque são o registro de uso (operação 5). |
   | `generation`, `creation_session` e `briefing` de conta eliminada | 24 meses | Primeiro a geração, por linha (a regeneração reusa a sessão). Depois a sessão sem geração (a Transcrição cai em cascata). Por fim o Briefing sem sessão. Nessa ordem o CHECK do modo estruturado nunca dispara. |
   | `extraction_event` | 30 dias | DELETE por `created_at` (só alimenta a cota de 24 h). |
   | `session` | quando vence | `expires_at` no passado; o IP e o navegador vão junto. |
   | `verification` | quando vence | Idem; a lápide do cadastro expurgado vale os 90 dias dela. |
   | Ticket de takedown encerrado | 12 meses após o encerramento (último registro de atendimento ou recusa; sem ele, o recebimento) | Sai o ticket com status resolvido, recebido antes do corte e sem `DSAR_FULFILLED`/`DSAR_REJECTED` do caso depois do corte. Não há coluna de encerramento, e o último registro da auditoria dá a data sem migração. Ticket aberto nunca sai. |
   | Auditoria DSAR | 5 anos (1827 dias) | `purgeDsarEventsBefore`, o único DELETE da trilha. |
   | `rate_limit` (chave = IP) | até 2 horas | A limpeza (`/api/cron/rate-limit-cleanup`) passa a rodar de hora em hora: contador de 1 h mais até 1 h até a passada seguinte. |

   - Cada passo apaga em lotes de 5000, até 10 por passada, cada lote no seu autocommit. Os passos são idempotentes, então não há transação em volta.
   - A passada tem orçamento de 40 s com reserva de 15 s. Esgotado, não começa lote nem passo novo: o passo que não começou fica para o dia seguinte, e a linha diz `deferredSteps=N`.
   - Falha de um passo não impede os outros e faz a passada responder 500.
   - Cada passada escreve uma linha `[retencao]`, só com contagens.

4. **O que fica, e por quê.**
   - As Receitas públicas e as avaliações ficam anonimizadas (art. 12), porque terceiros salvaram, avaliaram ou planejaram com elas. É risco aceito no parecer §11; quem quer que uma suma a apaga antes de eliminar a conta.
   - Os ledgers não têm conteúdo e servem a custo e abuso (legítimo interesse, art. 7º, IX, LIA A do registro); ficam 24 meses.
   - A auditoria DSAR é a prova do atendimento e fica 5 anos (prazo da ação punitiva da administração, Lei 9.873/1999, art. 1º).

5. **#596: a foto enviada é re-encodada no servidor.** Avatar e Imagem da receita (do dono e do Curador) passam pelo pipeline da foto da avaliação (`reencodeUserPhoto`, `src/server/images/user-photo.ts`).
   - O formato é decidido pelos bytes, e a orientação EXIF é aplicada nos pixels.
   - O maior lado fica em 2048 px na receita (qualidade 90, porque a edição do Gemini lê o original) e em 1024 px no avatar.
   - A saída é sempre WebP sem EXIF, ICC nem XMP. Entrada inválida ⇒ 400 `tipo_invalido`.
   - Na receita, o re-encode roda depois do gate de dono/Curador; no avatar, antes de qualquer acesso ao banco ou ao Blob.

6. **Logs só com nome e código.** `errorLogFields(err)` (`erro=<nome> [codigo=…]`, ADR-0048) é usado:
   - nas linhas que já existiam de `[conversations/stream]`, `[image-scene]`, `[notification]`, `[cache-tags]` e `[home]`;
   - nas linhas novas de `[account-purge]` e `[retencao]`.

   O catálogo fica em `docs/observabilidade.md`.

Fundamento: arts. 15 e 16 da LGPD (o fim do tratamento leva à eliminação; o que fica cabe nas exceções do art. 16 ou está anonimizado, art. 12), art. 18, VI, e art. 6º, III (necessidade). A leitura jurídica está no parecer §5; finalidade, base e prazo de cada operação estão no registro.

## Alternativas rejeitadas

- **Hard-delete da linha `users`.** `recipe.owner_id` é RESTRICT, e as Receitas públicas servem a terceiros.
- **Apagar `generation` e `briefing` na eliminação.**
  - `generation` é o ledger de custo do texto (#463, painel do /admin), e `generation.creation_session_id` é CASCADE: apagar a sessão apagaria o custo calado.
  - O CHECK `creation_session_structured_briefing_chk` reprova apagar o Briefing de sessão estruturada (o SET NULL viola o CHECK, 23514).
  - Os cascos saem pela retenção de 24 meses, na ordem certa.
- **Coluna `resolved_at` no ticket.** Exige migração. O último evento de encerramento na auditoria dá a mesma data, nunca antes.
- **Pôr a retenção dentro do `rate-limit-cleanup`.** Misturaria uma limpeza de hora em hora com passos diários e outro orçamento de tempo.
- **Manter o formato original da foto.** Exigiria um encoder e um descarte de metadado por formato. O WebP já é aceito pelos derivados e pela edição do Gemini.
- **Prazo de espera antes de apagar o privado.** O privado não serve a ninguém, e a política diz "na hora".

## Consequências e riscos

- **Exceção à imutabilidade do Briefing** ("o que foi pedido", ADR-0006 e ADR-0025): só para conta eliminada. Para conta viva, nada muda.
- **Terceiros perdem dados nas Receitas privadas que já foram públicas:** saves, avaliações, denúncias e entradas de Cardápio caem em cascata. Derivadas ficam com `parent_recipe_id` NULL, e itens de lista ficam sem receita de origem. É o mesmo efeito de `deleteOwnRecipe`. Follow-up: o `deleteOwnRecipe` não apaga os blobs das fotos dessas avaliações (aqui elas saem).
- **Expurgo de cadastro pendente:** as `CONTENT_GUARDS` de `session`, `extraction_event` e `image_generation` passam a significar "tem sessão viva" e "uso dentro do prazo". O risco é baixo: o expurgo só olha conta não confirmada e não desativada.
- **Sem índice de apoio (seq scan).** Faltam índice em:
  - `recipe_image.created_by` e `recipe.lineage_id`, usados no predicado da galeria;
  - `session.expires_at`;
  - `created_at` de `extraction_event`, `image_generation` e `meal_plan_suggestion_event` (os compostos começam por `user_id`).

  `recipe_review.recipe_id` só tem índice parcial. Isso é aceitável no volume de hoje; os índices ficam para uma migração futura. `verification.expires_at` já tem índice.
- **Blob depois do commit é best-effort.** Um timeout ou o Blob fora do ar deixa blob sem referência. O banco já está limpo, sem ponteiro de PII. Follow-up: varredura de órfãos pelo `list()` do `@vercel/blob`.
- **#596 não limpa o passado.** Avatar e foto de receita enviados antes podem ter EXIF, se o cliente mandou os bytes crus. Follow-up: auditoria só de leitura (`metadata().exif`) nos blobs próprios e re-encode no lugar.
- **Conta que falha todo dia fica no primeiro lote** (a ordem é por `anonymized_at`) e ocupa uma das 25 vagas até alguém corrigir. A linha de falha no log é o sinal.
- **Adiamento:** um passo com mais de 50 mil linhas vencidas leva vários dias, e o orçamento esgotado empurra passos para o dia seguinte (`deferredSteps=N`). O acúmulo inicial (sessões vencidas desde o começo) é o caso esperado.
- **A primeira varredura é irreversível.** Ela apaga o conteúdo privado das contas eliminadas antes desta regra. Há backup do Neon antes do merge (handoff 82).
- **Painel de custo:** as gerações das Receitas privadas apagadas perdem `recipe_id` (SET NULL), então o bloco de desfecho muda. O gasto por dia e o total não mudam.
- **`[claude/*]` segue com um resíduo.** Loga a `message` do provedor (aspas trocadas por `"…"`, teto de 300) e o `valor` curto de um descarte de vocabulário. Está catalogado em `docs/observabilidade.md` e não muda aqui.
