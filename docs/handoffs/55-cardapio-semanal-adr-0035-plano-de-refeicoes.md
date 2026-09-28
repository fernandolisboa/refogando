# Handoff 55 — Cardápio da semana (plano de refeições, ADR-0035)

**Sessão:** 2026-09-28. **Branch:** `claude/next-big-feature-w3rl1h` (um PR). **Migração:** `0069_meal_plan` (tabela `meal_plan_entry` + enum `meal_slot`; entra no deploy da main via `npm run db:migrate`).

Documento auto-suficiente: o que a feature é, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

O app deixou de ser só "achar/gerar receita" e passou a cobrir o ciclo da semana: **planejar → comprar → cozinhar**.

- **Página `/me/meal-plan` ("Cardápio")**: semana seg→dom (`?semana=YYYY-MM-DD` na URL), 4 refeições por dia (café da manhã, almoço, lanche, jantar), várias Receitas por refeição. Por entrada: ajustar porções (`− N +`, otimista com coalescência dos cliques), mover para outro dia/refeição, tirar. "Adicionar" em cada dia abre um seletor com Salvos + Minhas criações (busca local, cache entre aberturas).
- **Botão de calendário no detalhe da Receita** (ao lado do carrinho e do Salvar): escolhe um dos próximos 7 dias + refeição (padrão pela hora local); porções = o valor corrente do escalador da página, igual ao carrinho.
- **"Gerar lista de compras" a partir do plano**: semana inteira ou de hoje até domingo; destino = Lista existente ou nova (nome sugerido pela semana, pré-escolhe a lista da semana se já existir). Cada refeição entra **escalada pelas suas porções** e tudo soma pelo núcleo da Lista de compras (ADR-0032).
- **Índice de listas `/me/shopping-lists`** (antes só existia a página de uma lista): criar, apagar, contagem de itens; link "Todas as listas" na página da lista; item "Listas de compras" no menu da conta.
- **Nav**: link "Cardápio" no header (desktop e drawer).
- **LGPD**: o export da conta passou a incluir o plano **e as Listas de compras** (que tinham ficado de fora do #474). `meal_plan_entry.user_id` entrou nas `CONTENT_GUARDS` do expurgo de cadastro pendente. A eliminação self-service da conta apaga o plano (é privado; receitas e avaliações seguem mantidas e anonimizadas). As Listas de compras continuam sendo mantidas na eliminação, como antes; decidir junto da política de retenção pós-erasure (#473).

## 2. O que ler primeiro

1. `docs/adr/0035-plano-de-refeicoes-cardapio-semanal-lista-por-porcoes.md` — as 6 decisões e o que foi rejeitado.
2. `CONTEXT.md` — termo "Plano de refeições" (e a nota em "Lista de compras").
3. `src/domain/meal-plan.ts` — kernel puro: slots, datas de calendário, limites, `parsePlanRange(from, to, maxDays)`.
4. `src/server/meal-plan/meal-plan.ts` — CRUD, leitura da semana com hidratação, `applyMealPlanToShoppingList`.
5. `src/server/shopping-list/shopping-list.ts` — `readRecipeItemsForList` + `writeRecipeItemsToList` (o antigo `addRecipeItemsToList` virou esses dois) e `applyAddPlannedRecipesToShoppingList` (transação, cache de leitura por Receita).
6. Rotas: `src/app/api/me/meal-plan/{route.ts, entries/route.ts, entries/[entryId]/route.ts, shopping-list/route.ts}`.
7. UI: `src/components/meal-plan/*`, `src/components/recipe/recipe-meal-plan-button.tsx`, `src/components/shopping-list/shopping-lists-index.tsx`.

## 3. Princípios inegociáveis (não regredir)

- **Dia de calendário do CLIENTE.** O servidor nunca deriva "hoje" do próprio relógio (Vercel = UTC). `day` é `date`, semana ISO começando na segunda.
- **Plano aponta pra Receita VIVA** (não snapshot). Inelegível ⇒ `recipe: null` na leitura ("Receita indisponível"), **sem título**. A Lista de compras continua snapshot.
- **Gate = `eligibleToSaveByViewer`** (o mesmo de Salvar/Lista). Inelegível ⇒ 404 leak-safe; "não é sua" = "não existe" = 404.
- **Plano → Lista escala cada entrada pelas SUAS porções** (exceção consciente ao ADR-0032 dec.7). Nunca converte unidade; soma só chave+unidade idênticas.
- **Sem lista órfã:** a lista nova é criada pelo endpoint do plano, na mesma transação da soma, e desfeita se nenhuma refeição entrou (`plano_vazio`).
- **Re-planejar sem porções mantém as porções gravadas** (`coalesce` no upsert).
- **Tetos:** 12 refeições/dia; leitura ≤ 14 dias; gerar lista ≤ 7 dias; datas entre 2019-12-30 e 2101-01-02.
- **Toda tabela nova com FK para `users`** precisa entrar em `CONTENT_GUARDS` (`src/server/auth/pending-signup-purge.ts`) e no export LGPD.

## 4. Landmines

- **Preview da Vercel flaka em PR com migração** (0069 aqui): gatear só no check "checks".
- **Uma migração em voo por vez.** Se outra entrar na main antes, apagar `0069_*.sql` + snapshot, reverter `_journal.json` e `npx drizzle-kit generate --name meal_plan` de novo.
- **Testes de integração locais**: PG com pgvector, `TEST_DATABASE_URL` sempre inline no comando, nunca exportado; nunca dois vitest ao mesmo tempo.
- **`readJsonObject`** (`src/server/http/params.ts`): corpo JSON que não é objeto vira `{}`. Usar em rotas novas que fazem `'campo' in body`, senão um corpo primitivo dá 500.

## 5. Pendências e follow-ups

- **Jurídico (dono):** a política de privacidade §3.2 e `docs/legal/takedown-e-remocao-titular.md` não citam Listas de compras nem o Plano de refeições entre os dados exportados. O código já exporta; o texto legal fica para o advogado do #276.
- **Follow-ups de produto (não abertos como issue):** entrada de texto livre ("jantar fora", "sobras"); "copiar a semana passada"; sugestão de cardápio pela IA (se entrar, modelo/esforço configuráveis por modelo na aba de IA, como o resto).
- **Não feito de propósito:** teto total de entradas por usuário (consistente com o resto do app, que só tem tetos por dia/lista).

## 6. Critério de saída

PR mergeado com o painel de revisão limpo e o "checks" verde; migração 0069 aplicada no deploy de produção; memória do projeto atualizada.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

```
Leia docs/handoffs/55-cardapio-semanal-adr-0035-plano-de-refeicoes.md e o ADR-0035. O Cardápio da semana está em produção. Próximo passo sugerido: escolher um dos follow-ups da seção 5 (texto livre no plano, copiar a semana passada ou sugestão de cardápio pela IA) ou o modo despensa ("o que dá pra fazer com o que tenho"), seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
