# Handoff 83 — Retenção e eliminação de dados pessoais (#473) e foto sem EXIF/GPS no servidor (#596)

**Sessão:** 2026-10-22. **Branch:** `claude/project-thread-yl7417` (sobre a main em `0064c91`). **Migração:** nenhuma (só comentários no `src/db/schema.ts`; `drizzle/` intocado). Decisão no ADR-0050; base jurídica em `docs/legal/parecer-interno-2026-10-22.md` §5 e `docs/legal/registro-de-operacoes.md` (os dois entram neste PR). O PR fecha #473 e #596.

## 1. O que mudou

- **Eliminação apaga o privado na hora.**
  - O núcleo compartilhado é `src/server/legal/private-content.ts`: `purgePrivateContentInTx`, `privateLeftovers`, `orphanGalleryImage` e `ERASURE_POLICY` (destino de cada FK para `users.id`).
  - `eraseOwnAccount` (`src/server/legal/account-erasure.ts`) o chama na transação da anonimização e também apaga `verification` com `value` = id da conta.
  - As faces das Receitas privadas saem num DELETE só, qualquer que seja o número delas (com as mesmas guardas: a face compartilhada e a de linhagem alheia ficam). Um laço por face custava dois comandos por face (~120 ms cada, iad1 → sa-east-1) e passava dos 60 s com umas 230 Receitas privadas com face, e a eliminação nunca terminava.
  - Depois do commit, apaga os blobs com `deleteOrphanBlobsConcurrently` (`src/server/images/image-blobs.ts`, 8 por vez, nunca lança).
  - `emitNotification` não notifica conta anonimizada: a checagem vai no próprio `INSERT … SELECT … FROM users WHERE anonymized_at IS NULL`, sem ida extra ao banco.
  - O docstring da rota `POST /api/me/erasure` agora diz a verdade: a 2ª chamada recebe 401 `nao_autenticado`, porque todas as sessões saíram.
  - O que sai, o que é limpo e o que fica está na tabela da decisão 1 do ADR-0050.
- **Varredura diária das contas já eliminadas.**
  - `purgeAnonymizedPrivateContent` (`src/server/legal/account-purge-scan.ts`) entra no cron `account-purge`. A ordem das etapas passa a ser: cadastros pendentes (`purgeStalePendingSignups`, barata, carrega a promessa das 48 h da operação 13), fotos de avaliação com 180 dias (`purgeAnonymizedAccounts`) e, por último, o conteúdo privado.
  - Um orçamento só para a passada inteira (40 s, reserva de 15 s), contado do começo da rota: `timeBudget` (`src/server/time-budget.ts`, `remainingMs()`/`canStartMore()`), o mesmo helper do cron de retenção. Antes de cada conta, inclusive a primeira, a varredura confere `canStartMore()`; as candidatas do lote que ficaram saem como `privateAccountsDeferred=N` (só as do lote de 25, não o total de contas com sobra), então um corte nunca aparece como zeros calados.
  - Lote de 25, numa ordem que muda todo dia (`md5(id || current_date)`): uma conta que falha sempre não segura as outras. Uma transação por conta, falha isolada por conta, e `DSAR_FULFILLED` `account_private_purge` quando algo muda.
  - A seleção das candidatas calcula a sobra de galeria uma vez para todas as contas (`users.id IN (SELECT created_by …)`, com a guarda de linhagem contra o `created_by` da própria imagem). Correlacionada com `users.id`, ela varria `recipe_image` por conta: 50 s com 2 mil contas anonimizadas e 100 mil imagens (sintético), contra 0,27 s agora.
  - A linha `[account-purge]` separa `privateRowsDeleted` (só DELETE) de `privateRowsScrubbed` (UPDATE: a linha fica sem o texto); as fotos de avaliação são blobs e entram só em `privateBlobsReaped`.
  - `purgeAnonymizedAccounts` só seleciona as contas passadas dos 180 dias que ainda têm foto de avaliação (`EXISTS` em `recipe_review` com `photo_url IS NOT NULL`, pelo índice `recipe_review_user_recipe_uq`, que começa por `user_id`). Antes, toda conta com 180 dias voltava todo dia, mesmo já limpa; agora `scanned` conta só as que têm o que expurgar. O loop de blobs dela NÃO mudou (o teste de falha depende do `owns` lançar fora do try), e ela não usa o orçamento: a conta limpa sai das candidatas, então o volume diário é o das contas que acabaram de passar do prazo, não o acúmulo.
- **Cron de retenção** `/api/cron/retention` (`vercel.json`, 11:30 UTC).
  - Os prazos ficam em `src/domain/data-retention.ts`, em dias arredondados para cima.
  - Os passos ficam em `src/server/legal/data-retention.ts` (`RETENTION_STEPS`, nessa ordem): uso de IA 24 meses, extração 30 dias, sessões e verificações vencidas, takedown encerrado há 12 meses, auditoria DSAR 5 anos (`purgeDsarEventsBefore` em `dsar-audit.ts`), cascos das contas eliminadas e tokens/custo das gerações antigas de contas vivas.
  - Lotes de 5000, até 10 por passo. O orçamento é da passada (o mesmo `timeBudget`), e o passo que não começou sai como `deferredSteps=N`.
  - A linha de falha diz o passo em frase: `[retencao] expurgo dos registros de geração de imagem falhou: erro=Error`.
- **Rate limit de hora em hora:** `/api/cron/rate-limit-cleanup` passa de `0 10 * * *` para `15 * * * *`, e a idade máxima do registro (`RATE_LIMIT_MAX_AGE_MS`) cai de 1 h para 50 min (a maior janela é de 60 s). O IP sai em até 2 horas, mesmo com a passada atrasada alguns minutos.
- **#596.**
  - `reencodeUserPhoto` (`src/server/images/user-photo.ts`, saído do route de avaliações sem mudar um byte) agora roda também no avatar (`/api/me/avatar`, 1024 px) e na Imagem da receita do dono e do Curador (`src/server/recipe/image.ts`, `src/server/curate/catalog-image.ts`, 2048 px, qualidade 90).
  - A saída é sempre WebP sem EXIF/ICC/XMP; entrada inválida dá 400 `tipo_invalido`.
  - `maxDuration = 60` nas três rotas de upload.
- **Logs só com nome e código** (`errorLogFields` em `src/domain/error-report.ts`): `[conversations/stream]`, `[image-scene]`, `[notification]`, `[cache-tags]`, `[home]`, mais as linhas novas de `[account-purge]` e `[retencao]`. O catálogo está em `docs/observabilidade.md`.
- **Política de privacidade:** só `s31Valores[3]`, `s32Valores[3]`, `s33Valores[3]` e a data do rodapé (`rodapeData`, `2026-10-23`, o dia da publicação). Em pt-BR, o texto da spec v3, palavra por palavra; em en-US, a tradução. O resto da política fica para o PR da v3 (#276, handoff 84).
- **Docs.**
  - ADR-0050.
  - Notas datadas no ADR-0006 (retenção e a exceção do Briefing), no ADR-0016 (re-encode), no ADR-0025 (a exceção do Briefing na conta eliminada) e no ADR-0036 dec.7 (prazo do ledger; a metade da exportação é do #595).
  - `docs/legal/takedown-e-remocao-titular.md` §5 (b), §6 (bullet Eliminação) e §8 (GAP-6 e Retenção).
  - `docs/legal/lia-descoberta-web.md` §4: a limitação de retenção dos tickets de takedown passa a fechada.
  - `CONTEXT.md`: entrada **Eliminação da conta**.
  - Comentários de retenção no schema.
  - Docstrings de `src/domain/account-purge.ts` e `account-erasure.ts`.
- **Testes novos:**
  - `test/integration/account-erasure-private-content.test.ts`: IDOR, Receita ex-pública com terceiros, imagens compartilhadas e de catálogo, faces num comando só (1 face e 25 faces dão o mesmo número de comandos), face legada de linhagem fora das apagadas (sai com os 3 blobs sem Receita alheia na linhagem; fica com Receita de catálogo), limpeza da sessão com o painel de custo intacto, atomicidade por trigger, falhas do Blob, e o teste de FKs da `ERASURE_POLICY`.
  - `test/integration/data-retention.test.ts`: bordas de cada prazo, takedown, lápide, cascos, `liveGenerationCosts` sozinho (a geração velha da conta eliminada fica para o passo dela), lotes, orçamento, idempotência e a rota.
  - `test/helpers/failing-trigger.ts`: `withFailingTrigger`, o trigger de falha que `account-purge` e `account-erasure-private-content` usam.
  - `test/domain/data-retention.test.ts`: todo dia de 2024 a 2032 contra o prazo de calendário.
  - `test/unit/user-photo-reencode.test.ts`.
- **Testes alterados:** `account-purge` (candidatas das fotos: conta passada do prazo sem foto não entra em `scanned`, e a 2ª passada dá `scanned: 0`; varredura, candidatas da varredura = `privateLeftovers` conta a conta numa fixture mista, orçamento da rota gasto antes do privado com `privateAccountsDeferred` e o cadastro pendente saindo, falha isolada, rota 500), `me-erasure`, `notifications`, `me-avatar`, `recipe-image`, `catalog-image`, `image-derivatives`, `conversation-stream`, `recipe-image-generate`, `layout-data`, `home-feed` e `test/ui/error-report.test.ts`.

## 2. Ações do dono

1. **Backup antes do merge — feito.** Em `2026-10-23` (00:26 UTC), o `.github/workflows/db-backup.yml` foi disparado por `workflow_dispatch` e criou o branch `backup/2026-10-23T0026Z` do Neon. É por ele que se volta atrás: a primeira varredura apaga, sem volta, o conteúdo privado legado das contas eliminadas, e o plano free guarda só 6 h de histórico.
2. **Depois do deploy:**
   - Rodar manualmente (Run, no painel de crons da Vercel) `/api/cron/account-purge` e depois `/api/cron/retention`.
   - Ler as linhas `[account-purge] passada …` (`pendingSignupsPurged`, …, `privateAccountsSwept`, `privateAccountsFailed`, `privateAccountsDeferred`, …) e `[retencao] passada …`, e conferir se alguma linha `… falhou: erro=…` apareceu.
   - Na primeira passada, `sessions` e `verifications` devem vir altos (o acúmulo desde o começo). Se aparecer `deferredSteps=N` ou `privateAccountsDeferred=N` com N > 0, o resto sai nas passadas seguintes (25 contas por dia, no máximo; `privateAccountsDeferred` conta só as do lote do dia, não quantas contas ainda faltam).
3. **Follow-ups a abrir como issues** (riscos do ADR-0050):
   - (a) `deleteOwnRecipe` não apaga o blob das fotos de avaliação da Receita apagada.
   - (b) Índices para `recipe_image.created_by`, `recipe.lineage_id`, `session.expires_at` e o `created_at` de `extraction_event`, `image_generation` e `meal_plan_suggestion_event`, numa migração quando o slot liberar; `recipe_review.recipe_id` só tem índice parcial. Os de `recipe_image` e `recipe` já estão no #601.
   - (c) Varredura de blobs órfãos pelo `list()` do `@vercel/blob`.
   - (d) Auditoria só de leitura do EXIF nos avatares e fotos de receita enviados antes do #596, com re-encode no lugar.
4. **Opcional, só leitura, no console do Neon (o implementador nunca toca produção):** quantas contas eliminadas a primeira varredura vai limpar. A conta é aproximada: só os alvos principais.

```sql
SELECT count(*) FROM users u
WHERE u.anonymized_at IS NOT NULL AND (
  EXISTS (SELECT 1 FROM recipe r WHERE r.owner_id = u.id AND r.visibility = 'private')
  OR EXISTS (SELECT 1 FROM creation_session cs WHERE cs.user_id = u.id
             AND (cs.free_text IS NOT NULL
                  OR EXISTS (SELECT 1 FROM transcript_message t WHERE t.creation_session_id = cs.id)))
  OR EXISTS (SELECT 1 FROM recipe_save s WHERE s.user_id = u.id)
  OR EXISTS (SELECT 1 FROM collection c WHERE c.user_id = u.id)
  OR EXISTS (SELECT 1 FROM shopping_list l WHERE l.user_id = u.id)
  OR EXISTS (SELECT 1 FROM user_follow f WHERE f.follower_id = u.id OR f.followee_id = u.id)
  OR EXISTS (SELECT 1 FROM notification n WHERE n.recipient_id = u.id)
);
```

## 3. Landmines e gotchas de ambiente

- **FK nova para `users.id` precisa entrar na `ERASURE_POLICY`** (`src/server/legal/private-content.ts`). O teste lê `getTableConfig(...).foreignKeys` e reprova até alguém decidir o destino. Se o destino for apagar ou limpar, o alvo novo entra também em `privateLeftovers`: os dois andam juntos, e a varredura só acha a conta pelo `privateLeftovers`.
- **A ordem de `RETENTION_STEPS` importa:** geração → sessão sem geração → Briefing sem sessão. Inverter faz o CHECK `creation_session_structured_briefing_chk` disparar (23514).
- **`creation_session.briefing_id` é a única FK para `briefing`.** Se outra tabela passar a apontar para ele, entra no NOT EXISTS de `orphanBriefings`.
- **`generation.prompt_stamp` fica NULL nas contas eliminadas.** Hoje ninguém o lê. Quem passar a ler trata o NULL.
- **Corte de prazo:** sempre com `now` injetado e operador tipado (`lt`, `gte`). Nada de `Date` dentro de `sql` cru.
- **Linha de erro do Drizzle:** sai `erro=Error codigo=<SQLSTATE>` (o Drizzle não muda o `name`; o código vem da `cause`). Uma linha fixada em teste usa isso, não `DrizzleQueryError`.
- **Testes com falha injetada** usam `withFailingTrigger(tabela, fn)` (`test/helpers/failing-trigger.ts`): trigger `BEFORE DELETE … FOR EACH ROW` que levanta `P0001`, derrubado no `finally`. Só falha quem tem linha na tabela. Espiões são restaurados à mão (o Vitest não tem `restoreMocks` aqui).
- **A ordem do lote da varredura muda todo dia.** Teste de `purgeAnonymizedPrivateContent` confere conjuntos, nunca a ordem.
- **`emitNotification` escreve por `db.execute`** (`INSERT … SELECT`). Teste que quer quebrar só a notificação dubla o `execute`, não o `insert`.
- **Rodar Vitest:** o projeto `node` sobe o global setup do Testcontainers, então `test/domain` e `test/unit` também passam pelo lock: `flock /var/tmp/vitest.lock npx vitest run --project node …`. O projeto `ui` roda sem lock. Nunca exporte `DATABASE_URL`/`TEST_DATABASE_URL`.
- **O cron de rate limit agora roda de hora em hora, no minuto 15.** O plano da Vercel é Pro, então a frequência é aceita. Os demais crons ficam nos minutos 0 e 30.

## 4. Critério de saída

"checks" e "e2e" verdes no PR. Local:
- `npm run lint`;
- `npm run typecheck`;
- `npx vitest run --project ui`;
- `flock /var/tmp/vitest.lock npx vitest run --project node`;
- `git diff --stat origin/main -- drizzle/` vazio.

Depois do deploy, as ações da §2 (2): as duas linhas de passada sem `falhou`.
