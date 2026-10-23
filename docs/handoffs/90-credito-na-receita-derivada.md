# Handoff 90 — Crédito público na Receita derivada (#610)

**Data:** 2026-10-23.
**PR:** "Crédito na receita derivada: \"Baseada na receita … de @x\" (#610)".
**Base:** `main` depois do #629 (#606).
**Migração:** 0084 (`recipe.credit_removed_at`, `users.credit_on_derivatives`).
**ADR:** ADR-0052 (novo); ADR-0051 (atualização: risco (i) resolvido, Termos v1.4).

## 1. Escopo

Decisão do Fernando: a derivada publicada ("Criar minha versão" ou "Clonar") mostra "Baseada na receita <título> de @handle", com link; cada pessoa decide se quer ser creditada; quem foi copiado pode retirar o nome de uma cópia específica.

- **Linha pública.** `RecipeDetailView`, logo abaixo do "por …". Título → a base (slug do locale, senão uuid); @ → `/u/<handle>`. Base de catálogo: "… do catálogo".
- **Decisão pura.** `decideDerivedCredit` (`src/domain/derived-credit.ts`). O doc do topo lista as condições: base pública e não importada, dono com conta pública (`publicAccountFilter`), crédito ligado, não retirado, dono diferente. Pai imediato.
- **Leitura.** `loadDerivedCredit` (`src/server/recipe/derived-credit.ts`), uma query, só para derivadas. Chamado na página pública por slug e em `loadRecipeDetailView`.
- **Opt-out global.** Editar perfil → "Crédito nas cópias" (`DerivativeCreditSection`, `GET/PUT /api/me/derivative-credit`).
- **Retirar de uma cópia.** `PUT /api/recipes/[id]/credit { exibir }`, só o dono da base (autorização pela linhagem; o resto é 404). O controle (`DerivedCreditAuthorControl`) aparece na área de gestão da cópia quando a view buscada traz `creditoDoAutor`, que o servidor decide pela sessão.
- **Legal.** Política v3.5 (item 3.1) e Termos v1.4 (item 5, novo 5[4]; destaques do CDC passam a 5[2], 5[3], 5[5]). Sem aviso de 15 dias: ADR-0052, "Por que vale na publicação". ROPA (operações 1 e 15 + atualização). Export com `account.creditOnDerivatives`.

## 2. O que ler primeiro

1. ADR-0052.
2. O doc do topo de `src/domain/derived-credit.ts` e `test/unit/derived-credit.test.ts` (cada condição).
3. `test/integration/derived-credit.test.ts`: os dois caminhos da página, a conta eliminada, a autorização do PUT.

## 3. Princípios inegociáveis

- **O dono da cópia não tira o crédito.** Só o dono da base, pela linhagem. O cliente nunca decide quem é o dono da base (nada de comparar o @ da sessão).
- **Nada de base não pública no crédito.** O gate é `eligibleForPublicRead` + não importada, no puro. Título e slug de receita privada não saem.
- **Conta eliminada ou desativada não é creditada** (`publicAccountFilter`, o mesmo do perfil).

## 4. Landmines

- **ISR.** A página da receita é lida por request. Se ganhar ISR (ADR-0020, "A passo 2"), base virar privada, opt-out e "Retirar meu nome" têm de invalidar as cópias.
- **A data legal.** `DATA_POLITICA_V3_5` e `DATA_TERMOS_V1_4` são o dia do merge em UTC (2026-10-23). Se o merge passar da meia-noite UTC, troque a data antes.
- **Destaques dos Termos.** Um parágrafo novo no meio de um corpo desloca os índices de `DESTAQUES` (`src/components/legal/terms-of-use.tsx`); o teste dos destaques reprova.
- **Uma migração por vez:** 0084 é desta PR. A próxima é 0085.

## 5. Follow-ups

- JSON-LD `isBasedOn` (só se a página tiver ISR e valer para SEO).
- Cards da Busca e do feed não mostram o crédito.
- Não há lista, em Editar perfil, das cópias de onde a pessoa tirou o nome: o desfazer fica na página da cópia.

## 6. Critério de saída

- [x] Cópia pública de receita pública mostra o crédito com os dois links; catálogo mostra "do catálogo".
- [x] Base privada, opt-out, conta eliminada, base apagada e crédito retirado não mostram nada.
- [x] O dono da base retira e devolve; dono da cópia, terceiro e anônimo não.
- [x] Política v3.5, Termos v1.4, ROPA, ADR-0051/0052 e `CONTEXT.md` alinhados.
- [ ] Painel de revisão limpo; `checks` e `e2e` verdes.

## 7. Gotchas de ambiente

- Vitest `node`: Docker (`nohup dockerd &` + `pgvector/pgvector:pg17`) e Testcontainers, sem `TEST_DATABASE_URL`.
- Preview da Vercel em PR com migração pode falhar se o build rodar antes do branch do Neon existir.
