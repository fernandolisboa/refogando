# Handoff 79 — Pontas soltas de segurança (#588)

**Sessão:** 2026-10-22. **Branch:** `claude/project-thread-6gx2v8` (sobre a main em `3757941`, depois do #587). **Migração:** nenhuma. Origem: follow-ups já registrados nos handoffs 69, 76 e 77, juntados na issue #588 a pedido do dono.

## 1. O que mudou

- **Teto do Derivar/Clonar.** `POST /api/recipes/[id]/derive` não tinha limite. Agora há um teto diário por papel (`DERIVE_CAP_BY_ROLE` em `src/domain/derive-cap.ts`: usuario 30, curador 60, admin ∞; papel desconhecido cai no de usuario), em janela de 24h deslizante (reusa `RECIPE_GEN_WINDOW_MS` + `decideRecipeGenQuota`). Derivar e Clonar dividem o teto.
  - Atômico: `assertDeriveSlotInTx` (`src/server/quota/atomic.ts`, classe de lock 4675) é a 1ª operação da transação de `deriveRecipe` e reconta as receitas `owner_id = viewer AND origin = 'user_edited'` da janela. A rota faz antes um `peekDeriveQuota` barato. Estourou ⇒ 429 `{ error: 'limite_derivar', retryAfterMs }`, sempre depois dos 404/409/400.
  - Espera do lock limitada a 5s (`lock_timeout` transaction-local, resetado logo após pegar o lock); 55P03 ⇒ 429 com `retryAfterMs` de 5s, nunca 500.
  - UI: `recipe-clone-button` e o modo derive do `recipe-edit-form` mostram "Libera em ~{tempo}" via `readDeriveLimit` (`src/lib/countdown.ts`, que também passou a ter o `formatCountdown` antes local do `recipe-image-manager`).
  - `deriveRecipe` exige `cap` (sem default) para nenhum chamador pular o gate.
  - ADR-0045 ganhou a emenda de 2026-10-22; glossário "Receita derivada" no `CONTEXT.md`.
- **CRON_SECRET em tempo constante.** `isAuthorizedCron` (`src/server/http/cron-auth.ts`): SHA-256 dos dois lados + `timingSafeEqual`, fail-closed sem secret ou sem header. Os 5 crons usam o helper.
- **Foto da avaliação pelos bytes.** `/api/recipes/[id]/reviews` lê o `metadata()` antes de decodificar e só aceita JPEG/PNG/WebP de um quadro (`classifyRasterInput` + `SAFE_RASTER_FORMATS`, compartilhados com os derivados WebP em `src/server/images/image-derivatives.ts`), com `.timeout()` no pipeline. SVG/GIF/WebP animado rotulados `image/png` ⇒ 400 `tipo_invalido`. O avatar não decodifica (só guarda os bytes e é servido em `<img>`), então ficou igual.
- **"Seguindo" na busca de Cozinheiros.** `/api/search/cooks` segue cookie-free. Logado, o `CooksDiscovery` em modo busca chama `POST /api/me/following/status` com os handles da página (máx. `2 × COOK_SEARCH_LIMIT`), que devolve `{ following, self }` com os handles armazenados (filtro `publicAccountFilter`, `no-store`, nunca id). O cartão vira "Seguindo" quando o status chega, e o próprio cartão perde o botão. ADR-0024 ganhou a emenda de 2026-10-22.
- Helpers extraídos no caminho: `capFromRoleTable` (`src/domain/user.ts`, usado também pela Sugestão de cardápio) e `hasControlChars` (`src/domain/search-terms.ts`, usado também pelo `cooks-cursor`).

## 2. Landmines

- O teto conta derivadas **vivas**: apagar uma libera o slot. O ciclo derivar→apagar não tem teto, nem o custo do embedder nele. Fechar exige um ledger imutável (migração); ficou registrado na emenda do ADR-0045 como limite aceito.
- APNG passa no `metadata()` (o sharp não informa `pages` para PNG) e é gravado só com o 1º quadro. Limite aceito.
- `handleSave` das avaliações ainda roda o sharp antes de checar se a receita existe/está no pool; o custo por requisição continua limitado pelo teto de pixels e pelo timeout. Candidato a follow-up.
- Na busca, o cartão aparece primeiro como "Seguir" e vira "Seguindo" quando o status chega (pequeno atraso visível, de propósito: segurar a página somaria latência).
- Testes locais: rode cada `vitest` com `flock /var/tmp/vitest.lock` quando houver mais de uma execução em paralelo contra o mesmo Postgres.

## 3. Critério de saída

"checks" verde e painel de revisão limpo. Em produção: clonar continua funcionando; `/cooks?q=<alguém que você segue>` mostra "Seguindo"; os crons seguem rodando (linhas `[account-purge]`, `[image-derivatives]` nos logs da Vercel).
