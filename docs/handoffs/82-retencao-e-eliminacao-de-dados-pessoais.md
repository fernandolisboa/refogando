# Handoff 82 — Retenção e eliminação de dados pessoais (#473) e foto sem EXIF/GPS no servidor (#596)

**Sessão:** 2026-10-22. **Branch:** `wip/pr-a-473` (sobre a main em `5b4580d`). **Migração:** nenhuma (só comentários no `src/db/schema.ts`; `drizzle/` intocado). Decisão no ADR-0049; base jurídica em `docs/legal/parecer-interno-2026-10-22.md` §5 e `docs/legal/registro-de-operacoes.md` (os dois entram neste PR). O PR fecha #473 e #596.

## 1. O que mudou

- **Eliminação apaga o privado na hora.**
  - O núcleo compartilhado é `src/server/legal/private-content.ts`: `purgePrivateContentInTx`, `privateLeftovers`, `orphanGalleryImage` e `ERASURE_POLICY` (destino de cada FK para `users.id`).
  - `eraseOwnAccount` (`src/server/legal/account-erasure.ts`) o chama na transação da anonimização e também apaga `verification` com `value` = id da conta.
  - Depois do commit, apaga os blobs com `deleteOrphanBlobsConcurrently` (`src/server/images/image-blobs.ts`, 8 por vez, nunca lança).
  - `emitNotification` não notifica conta anonimizada.
  - O docstring da rota `POST /api/me/erasure` agora diz a verdade: a 2ª chamada recebe 401 `nao_autenticado`, porque todas as sessões saíram.
  - O que sai, o que é limpo e o que fica está na tabela da decisão 1 do ADR-0049.
- **Varredura diária das contas já eliminadas.**
  - `purgeAnonymizedPrivateContent` (`src/server/legal/account-purge-scan.ts`) entra no cron `account-purge` entre o expurgo de fotos e o de cadastros pendentes.
  - Lote de 25, orçamento de 40 s com reserva de 15 s, uma transação por conta, falha isolada por conta, e `DSAR_FULFILLED` `account_private_purge` quando algo muda.
  - O loop de blobs de `purgeAnonymizedAccounts` NÃO mudou (o teste de falha dele depende do `owns` lançar fora do try).
- **Cron de retenção** `/api/cron/retention` (`vercel.json`, 11:30 UTC).
  - Os prazos ficam em `src/domain/data-retention.ts`, em dias arredondados para cima.
  - Os passos ficam em `src/server/legal/data-retention.ts` (`RETENTION_STEPS`, nessa ordem): uso de IA 24 meses, extração 30 dias, sessões e verificações vencidas, takedown encerrado há 12 meses, auditoria DSAR 5 anos (`purgeDsarEventsBefore` em `dsar-audit.ts`), cascos das contas eliminadas e tokens/custo das gerações antigas de contas vivas.
  - Lotes de 5000, até 10 por passo. O orçamento é da passada, e o passo que não começou sai como `deferredSteps=N`.
- **Rate limit de hora em hora:** `/api/cron/rate-limit-cleanup` passa de `0 10 * * *` para `0 * * * *`. O IP fica até 2 horas (contador de 1 h mais até 1 h até a próxima passada).
- **#596.**
  - `reencodeUserPhoto` (`src/server/images/user-photo.ts`, saído do route de avaliações sem mudar um byte) agora roda também no avatar (`/api/me/avatar`, 1024 px) e na Imagem da receita do dono e do Curador (`src/server/recipe/image.ts`, `src/server/curate/catalog-image.ts`, 2048 px, qualidade 90).
  - A saída é sempre WebP sem EXIF/ICC/XMP; entrada inválida dá 400 `tipo_invalido`.
  - `maxDuration = 60` nas três rotas de upload.
- **Logs só com nome e código** (`errorLogFields` em `src/domain/error-report.ts`): `[conversations/stream]`, `[image-scene]`, `[notification]`, `[cache-tags]`, `[home]`, mais as linhas novas de `[account-purge]` e `[retencao]`. O catálogo está em `docs/observabilidade.md`.
- **Política de privacidade:** só `s31Valores[3]`, `s32Valores[3]` e `s33Valores[3]`. Em pt-BR, o texto da spec v3, palavra por palavra; em en-US, a tradução. O resto da política fica para o PR da v3 (handoff 83).
- **Docs.**
  - ADR-0049.
  - Notas datadas no ADR-0006 (retenção e a exceção do Briefing), no ADR-0016 (re-encode) e no ADR-0036 dec.7 (prazo do ledger; a metade da exportação é do PR B).
  - `docs/legal/takedown-e-remocao-titular.md` §5 (b), §6 (bullet Eliminação) e §8 (GAP-6 e Retenção).
  - Comentários de retenção no schema.
  - Docstrings de `src/domain/account-purge.ts` e `account-erasure.ts`.
- **Testes novos:**
  - `test/integration/account-erasure-private-content.test.ts`: IDOR, Receita ex-pública com terceiros, imagens compartilhadas e de catálogo, limpeza da sessão com o painel de custo intacto, atomicidade por trigger, falhas do Blob, e o teste de FKs da `ERASURE_POLICY`.
  - `test/integration/data-retention.test.ts`: bordas de cada prazo, takedown, lápide, cascos, lotes, orçamento, idempotência e a rota.
  - `test/domain/data-retention.test.ts`: todo dia de 2024 a 2032 contra o prazo de calendário.
  - `test/unit/user-photo-reencode.test.ts`.
- **Testes alterados:** `account-purge` (varredura, orçamento, falha isolada, rota 500), `me-erasure`, `notifications`, `me-avatar`, `recipe-image`, `catalog-image`, `image-derivatives`, `conversation-stream`, `recipe-image-generate`, `layout-data`, `home-feed` e `test/ui/error-report.test.ts`.

## 2. Ações do dono

1. **Backup antes do merge — feito.** O orquestrador disparou o `.github/workflows/db-backup.yml` (`workflow_dispatch`) em `<AAAA-MM-DD>`, que criou o branch `backup/<AAAA-MM-DD>` do Neon. É por ele que se volta atrás: a primeira varredura apaga, sem volta, o conteúdo privado legado das contas eliminadas, e o plano free guarda só 6 h de histórico.
2. **Depois do deploy:**
   - Rodar manualmente (Run, no painel de crons da Vercel) `/api/cron/account-purge` e depois `/api/cron/retention`.
   - Ler as linhas `[account-purge] passada …` (`privateAccountsSwept`, `privateAccountsFailed`, …) e `[retencao] passada …`, e conferir se alguma linha `… falhou: erro=…` apareceu.
   - Na primeira passada, `sessions` e `verifications` devem vir altos (o acúmulo desde o começo). Se aparecer `deferredSteps=N`, o resto sai nas passadas seguintes.
3. **Follow-ups a abrir como issues** (riscos do ADR-0049):
   - (a) `deleteOwnRecipe` não apaga o blob das fotos de avaliação da Receita apagada.
   - (b) Índices para `recipe_image.created_by`, `recipe.lineage_id`, `session.expires_at` e o `created_at` de `extraction_event`, `image_generation` e `meal_plan_suggestion_event`, numa migração quando o slot liberar; `recipe_review.recipe_id` só tem índice parcial.
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
- **Testes com falha injetada** criam função plpgsql e trigger por `getDb().execute(sql.raw(...))` e os derrubam no `finally`. Espiões são restaurados à mão (o Vitest não tem `restoreMocks` aqui).
- **Rodar Vitest:** o projeto `node` sobe o global setup do Testcontainers, então `test/domain` e `test/unit` também passam pelo lock: `flock /var/tmp/vitest.lock npx vitest run --project node …`. O projeto `ui` roda sem lock. Nunca exporte `DATABASE_URL`/`TEST_DATABASE_URL`.
- **O cron de rate limit agora roda de hora em hora.** O plano da Vercel é Pro, então a frequência é aceita.

## 4. Critério de saída

"checks" e "e2e" verdes no PR. Local:
- `npm run lint`;
- `npm run typecheck`;
- `npx vitest run --project ui`;
- `flock /var/tmp/vitest.lock npx vitest run --project node`;
- `git diff --stat origin/main -- drizzle/` vazio.

Depois do deploy, as ações da §2 (2): as duas linhas de passada sem `falhou`.
