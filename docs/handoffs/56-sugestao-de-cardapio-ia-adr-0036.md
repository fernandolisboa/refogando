# Handoff 56 — Sugestão de cardápio pela IA (ADR-0036)

**Sessão:** 2026-09-28. **Branch:** `claude/next-feature-3-fmgw7p` (um PR). **Migração:** `0070_meal_plan_suggestion` (tabela `meal_plan_suggestion_event`; entra no deploy da main via `npm run db:migrate`).

Documento auto-suficiente: o que a feature é, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

O Cardápio (ADR-0035) ganhou quem preencha a semana: **"Sugerir com IA"**.

- **Botão "Sugerir com IA"** em `/me/meal-plan`, ao lado de "Gerar lista de compras". Abre um painel com: dias da semana visível (padrão: de hoje em diante na semana atual, a semana inteira nas outras), refeições (padrão almoço + jantar), porções por refeição (padrão 2, lembrado no navegador), restrições (filtro duro sobre o que as receitas **declaram**), fonte ("meu acervo e a comunidade" ou "só meus Salvos e minhas criações"), "só preencher refeições vazias" (padrão ligado) e uma nota livre (≤ 200, "peixe na sexta").
- **Prévia**: a IA devolve uma Receita por dia × refeição, com um motivo curto e um comentário da semana. Nada é gravado. Cada item tem checkbox; "Adicionar N ao cardápio" grava os marcados; "Sugerir de novo" e "Ajustar pedido".
- **A IA escolhe, não gera**: só Receitas existentes (acervo do usuário + amostra do pool público). Depois de aceitar, o "Gerar lista de compras" do ADR-0035 fecha o ciclo.
- **Admin**: quarto bloco na aba de IA, **"Sugestão de cardápio"** (tarefa `menu`), com modelo/esforço/thinking por modelo como as outras. Default: `claude-sonnet-5`, esforço low, thinking no default do modelo.
- **Cota**: 6 sugestões/24h (usuario), 12 (curador), ilimitado (admin), em código. Cada chamada fica no ledger com modelo, tokens e custo, e o custo entra no TEXTO do painel de custo de IA do admin (por dia e por usuário).

## 2. O que ler primeiro

1. `docs/adr/0036-sugestao-de-cardapio-pela-ia-escolhe-receitas-existentes.md` — as 7 decisões e o que foi rejeitado.
2. `CONTEXT.md` — termo "Sugestão de cardápio".
3. `src/domain/menu-suggestion.ts` — kernel puro: pedido, alvos, categorias por refeição, prompt (chaves `a1…`/`r1…`), schema da saída, resolução, aceite, cota por papel.
4. `src/server/meal-plan/menu-suggestion.ts` — candidatas (SQL cru, gate de Salvar + pool com amostra por categoria), cards da prévia, custo no ledger, aceite em transação.
5. `src/server/quota/atomic.ts` — `peekMenuSuggestionQuota` e `reserveMenuSuggestionSlot` (classId 4674).
6. `src/server/claude/client.ts` — `suggestMenu` (structured + reparo, prazo de 50s, `effort` só nas famílias selecionáveis).
7. Rotas: `src/app/api/me/meal-plan/suggestions/route.ts` (prévia) e `.../suggestions/apply/route.ts` (aceite).
8. UI: `src/components/meal-plan/meal-plan-suggest-panel.tsx` e o botão em `meal-plan-week-view.tsx`.

## 3. Princípios inegociáveis (não regredir)

- **Sugestão ≠ Geração.** A IA só escolhe de uma lista fechada; nunca cria Receita.
- **Nada é gravado sem aceite**, e o aceite **re-valida tudo** (gate de Salvar, teto por dia, UNIQUE). Já planejada no mesmo dia × refeição ⇒ pulada **sem mexer nas porções**.
- **Privada de outro nunca vira candidata.** Acervo = o predicado de `loadSavedRecipes`; pool = `communityVisibleSqlFragment` + barreiras do pool.
- **Restrição é filtro SQL sobre o declarado**, nunca decisão do modelo.
- **Saída do modelo toda string** (sem enum/limites no schema); a resolução descarta alvo/chave desconhecidos, alvo repetido e o par já planejado.
- **Texto de terceiros no prompt é dado**: saneado (sem `<`, `>`, `|`, uma linha, cortado) e delimitado.
- **Cota antes da IA**: 4xx baratos (pedido inválido, nada a preencher, sem candidatas) vêm antes da reserva; quem está no teto recebe 429 antes de carregar o pool. Falha da IA não devolve o slot.
- **Ajustes de IA por modelo no admin** (ADR-0034); nada de modelo/esforço fixo em código além do default da tarefa.
- **Toda tabela nova com FK para `users`** entra em `CONTENT_GUARDS` (o ledger já entrou).

## 4. Landmines

- **Preview da Vercel flaka em PR com migração** (0070 aqui): gatear só no check "checks".
- **Uma migração em voo por vez.** Se outra entrar na main antes, apagar `0070_*.sql` + snapshot, reverter `_journal.json` e `npx drizzle-kit generate --name meal_plan_suggestion` de novo.
- **`ClaudeClient` ganhou `suggestMenu`**: todo dublê de teste que `implements ClaudeClient` precisa do método (os 11 existentes já têm). `FakeClaudeClient` recebe a sugestão enlatada como 6º argumento.
- **`ORDER BY random()` no pool** ordena o pool elegível inteiro a cada pedido. Ok no tamanho de hoje; trocar por `TABLESAMPLE` se o pool chegar a dezenas de milhares.
- **Testes de integração locais**: PG 17 com pgvector, `TEST_DATABASE_URL` inline no comando, nunca exportado; nunca dois vitest ao mesmo tempo.

## 5. Pendências e follow-ups

- **Teto no admin:** o teto por papel está em código; vira coluna de `app_config` se precisar mexer sem deploy.
- **Produto:** "gerar uma Receita nova para este buraco" (chamando a Geração), trocar um item só da prévia, respeitar preferências salvas do usuário (não existe perfil de restrições persistido hoje).
- **Follow-ups do ADR-0035 que seguem abertos:** entrada de texto livre ("jantar fora"), copiar a semana passada.
- **Jurídico (dono, #276):** a política de privacidade não cita que a nota da sugestão vai ao provedor de IA (como o texto da Extração e o briefing da Geração já vão).

## 6. Critério de saída

PR mergeado com o painel de revisão limpo e o "checks" verde; migração 0070 aplicada no deploy de produção; memória do projeto atualizada.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

```
Leia docs/handoffs/56-sugestao-de-cardapio-ia-adr-0036.md e o ADR-0036. A Sugestão de cardápio pela IA está em produção. Próximo passo sugerido: um dos follow-ups de produto da seção 5 (texto livre no plano, copiar a semana passada, gerar Receita para um buraco da semana). Seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
