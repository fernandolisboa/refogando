# Handoff 57 — Anotação livre no Cardápio e "Copiar semana anterior" (ADR-0037)

**Sessão:** 2026-09-28. **Branch:** `claude/next-feature-round-four-m506vr` (um PR). **Migração:** `0071_meal_plan_note` (coluna `note`, `recipe_id` nullable, 2 CHECKs, 1 UNIQUE; entra no deploy da main via `npm run db:migrate`).

Documento auto-suficiente: o que a feature é, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

Os dois follow-ups do Cardápio que o ADR-0035 e o handoff 56 deixaram abertos.

- **Anotação livre.** No "Adicionar" de cada dia, a seção **"Sem receita"**: um campo (até 80 caracteres) e três atalhos (Comer fora / Sobras / Delivery; em inglês Eating out / Leftovers / Takeout) que anotam com um toque no dia e refeição escolhidos. Na semana, a anotação aparece com o texto em itálico e um ícone de caderno, sem seletor de porções; pode ser movida e tirada como uma Receita.
- **A anotação ocupa a refeição**: conta no teto por dia, "Sugerir com IA" com "só preencher refeições vazias" não planeja por cima dela, e a cópia também não. **Não vai para a lista de compras**; "Gerar lista de compras" fica desabilitado numa semana só de anotações.
- **"Copiar semana anterior"**: botão no topo do Cardápio. Repete a semana de 7 dias antes (Receitas com as porções gravadas + anotações) **só nas refeições vazias**; na semana corrente, de hoje até domingo. Receita que ficou inelegível não é copiada. O resultado vem numa linha ("3 refeições copiadas… 1 ficou de fora…").

## 2. O que ler primeiro

1. `docs/adr/0037-anotacao-livre-no-cardapio-e-copiar-semana-anterior.md` — as 7 decisões.
2. `CONTEXT.md` — **Anotação** dentro de **Plano de refeições**.
3. `src/domain/meal-plan.ts` — `parsePlanNote`, `MEAL_PLAN_NOTE_MAX`, `planPreviousWeekCopy` (kernel puro da cópia).
4. `src/server/meal-plan/meal-plan.ts` — `applyAddMealPlanNote`, `applyCopyPreviousWeek`, `loadMealPlan` (segunda consulta pras anotações), filtro `isNotNull(recipe_id)` no "gerar lista".
5. Rotas: `src/app/api/me/meal-plan/entries/route.ts` (`{note, day, slot}`), `.../entries/[entryId]/route.ts` (400 pra porções em anotação), `.../copy-previous-week/route.ts` (novo).
6. UI: `src/components/meal-plan/meal-plan-recipe-picker.tsx` (seção "Sem receita") e `meal-plan-week-view.tsx` (linha da anotação, botão de copiar, `copyResultMessage`).

## 3. Princípios inegociáveis (não regredir)

- **Receita XOR Anotação** em toda linha de `meal_plan_entry` (CHECK `meal_plan_entry_kind_chk`); anotação sem porções (CHECK `meal_plan_entry_note_chk`).
- **O texto da anotação nunca vai ao modelo.** `loadPlannedSlots` (Sugestão) não seleciona `note`; mantenha assim.
- **Anotação nunca vai para a Lista de compras.**
- **Copiar só preenche refeições vazias**, nunca substitui nem empilha; **re-aplica o gate de Salvar** na origem; escopo sempre `session.user.id`.
- **O dia é do cliente** (`fromDay` = hoje do navegador na semana corrente), nunca do relógio do servidor (ADR-0035 dec.2).
- **Toda escrita da cópia numa transação com `ON CONFLICT DO NOTHING` sem alvo** (cobre as duas UNIQUEs): duplo clique é no-op.

## 4. Landmines

- **Drizzle + leftJoin + objeto aninhado:** em `applyCopyPreviousWeek` o gate vem em colunas SOLTAS. Com `gate: GATE_COLS` aninhado num `leftJoin`, o drizzle devolveu `gate: null` para Receitas de catálogo (`owner_id` NULL) e a cópia pulava tudo. Não "simplificar" de volta.
- **`MealPlanEntryView.note`** é obrigatório (`string | null`): dublês de teste que montam entradas precisam de `note: null`.
- **`recipe_id` agora é nullable**: qualquer leitura nova de `meal_plan_entry` que precise da Receita deve filtrar `isNotNull(recipe_id)` ou fazer `innerJoin`.
- **Preview da Vercel flaka em PR com migração** (0071 aqui): gatear só no check "checks".
- **Uma migração em voo por vez.** Se outra entrar na main antes, apagar `0071_*.sql` + snapshot, reverter `_journal.json` e `npx drizzle-kit generate --name meal_plan_note` de novo.
- **Teto de 12 por dia sem lock** (como no ADR-0035/0036): anotar e copiar contam e inserem sem trava por usuário; requisições paralelas podem passar do teto. Inofensivo (as leituras são limitadas); se importar, um `pg_advisory_xact_lock` por usuário nos caminhos de escrita.
- **Testes de integração locais**: PG 17 com pgvector, `TEST_DATABASE_URL` inline no comando, nunca exportado.

## 5. Pendências e follow-ups

- **Editar o texto de uma anotação** na própria linha (hoje: tirar e anotar de novo). O PATCH não aceita `note`; seria um campo a mais nele.
- **Copiar de uma semana qualquer** (hoje só a anterior) ou **repetir um dia**.
- Do handoff 56, seguem abertos: "gerar uma Receita nova para um buraco da semana", trocar um item só da prévia da Sugestão, preferências de restrição salvas no perfil.
- **Jurídico (dono, #276):** a política de privacidade não cita o Cardápio (nem, agora, as anotações) no export.

## 6. Critério de saída

PR mergeado com o painel de revisão limpo e o "checks" verde; migração 0071 aplicada no deploy de produção; memória do projeto atualizada.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

```
Leia docs/handoffs/57-anotacao-livre-e-copiar-semana-adr-0037.md e o ADR-0037. A Anotação livre e o "Copiar semana anterior" do Cardápio estão em produção. Próximo passo sugerido: um dos follow-ups da seção 5 (editar a anotação na linha, gerar uma Receita para um buraco da semana, preferências de restrição salvas no perfil). Seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
