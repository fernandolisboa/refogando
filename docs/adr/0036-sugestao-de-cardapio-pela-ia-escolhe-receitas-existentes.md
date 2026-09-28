# ADR-0036 — Sugestão de cardápio pela IA: escolhe Receitas existentes, prévia antes de gravar, cota diária

Status: aceito

O dono pediu (2026-09-28) "a próxima feature grande". O ADR-0035 (Cardápio da semana) deixou a **sugestão de cardápio por IA** como follow-up natural: o plano já existia, a lista de compras por porções também, faltava quem preenche a semana. Termo no `CONTEXT.md` (**Sugestão de cardápio**). Relaciona: ADR-0035 (Plano de refeições), ADR-0034 (ajustes de IA por tarefa e por modelo), ADR-0027 (gate de Salvar), ADR-0009 (structured output), #446/#447 (cota atômica com ledger), #463 (custo de texto).

## Decisões

1. **A IA ESCOLHE, não gera.** A sugestão preenche dias × refeições com Receitas que **já existem**: o acervo do Usuário (Salvos ∪ Minhas criações, mesmo as privadas dele) e, se ele quiser (padrão: sim), uma amostra do pool público (comunidade + catálogo aprovado). Gerar 7–28 Receitas novas numa chamada estouraria o prazo de 60s da rota, custaria dezenas de gerações e encheria o banco de Receitas que ninguém pediu. Escolher de uma lista fechada é uma chamada só, curta e barata. **Rejeitado:** gerar Receitas novas para os buracos (fica como follow-up: "gerar uma Receita para este dia" chamando a Geração que já existe).

2. **Prévia antes de gravar; o aceite re-valida tudo.** `POST /api/me/meal-plan/suggestions` devolve uma prévia e **não grava nada**. O Usuário desmarca o que não quer e aceita; `POST /api/me/meal-plan/suggestions/apply` grava os marcados. A prévia volta pelo cliente, então o aceite não confia nela: cada entrada passa de novo pelo gate de Salvar (`eligibleToSaveByViewer`), pelo teto por dia e pela UNIQUE. Receita já planejada naquele dia × refeição é **pulada sem tocar nas porções** (≠ o upsert de planejar à mão, que sobrescreveria as porções ajustadas). Uma transação; entradas de UMA semana ISO, no máximo 28. **Rejeitado:** guardar a sugestão no servidor (estado a mais, com expiração, para um fluxo de segundos).

3. **Candidatas: o gate de Salvar + filtros duros, com amostra por categoria.** Acervo (≤ 100, mais recentes primeiro) pelo mesmo predicado de `loadSavedRecipes` (legível pelo viewer + não lúdica, não removida, não importada da web). Pool (completa até 150) pelo gate de comunidade, fora do acervo, amostra **aleatória** (cada pedido vê outra fatia) com **cota por categoria** (`row_number() OVER (PARTITION BY categoria ORDER BY random())`) — sem ela, uma amostra de pratos principais deixaria o café da manhã sem opção. O `random()` ordena o pool elegível inteiro: aceito no tamanho de hoje; se o pool crescer para dezenas de milhares, trocar por `TABLESAMPLE` ou uma ordem pré-computada. **Restrições** pedidas são filtro SQL sobre o que a Receita **declara** (`restricoes @> pedidas`), nunca decisão do modelo (e a UI diz "declaradas nas receitas", ADR-0004). **Categoria** casa a refeição (`MENU_SLOT_CATEGORIAS`): bebida e molho nunca entram; Receita sem categoria entra e o modelo julga pelo título. Privada de outro nunca vira candidata.

4. **O prompt usa chaves curtas e trata texto de terceiros como dado.** Alvos viram `a1…aN` e Receitas `r1…rN` (nunca UUID nem data/refeição por extenso): menos tokens, e o modelo não "quase acerta" um id nem escreve "lunch" onde se esperava `almoco`. Títulos da comunidade e a nota do Usuário são saneados (uma linha, sem `<`, `>` ou `|`, cortados) e delimitados, e o system prompt diz que são dados. A saída é **structured** (ADR-0009) e **toda string** (`{ itens: [{alvo, receita, motivo}], comentario }`): enum ou limite de tamanho fariam o parse local do SDK lançar (ou hoistar `$defs`, que a API recusa). A resolução descarta o que estiver fora do pedido: chave desconhecida, alvo repetido (o primeiro vence), Receita já planejada naquele mesmo par. Pior caso de uma injeção via título: uma escolha enviesada e um motivo esquisito, exibido como texto puro e cortado em 140 caracteres.

5. **Quarta tarefa de IA no admin: `menu`.** Mesmo formato do ADR-0034: modelo e ajustes por modelo na aba de IA ("Sugestão de cardápio"), com default `claude-sonnet-5` (ou env `MENU_MODEL`), **`effort: low`** e thinking no default do modelo (escolher de uma lista fechada é tarefa curta; a chamada tem prazo de 50s com ~150 Receitas no prompt). `effort` só vai para Opus/Sonnet/Fable. `max_tokens` 4.000 + a folga de thinking. A chamada recebe o `request.signal`: fechar o painel cancela a chamada na Anthropic.

6. **Cota diária por papel, reservada antes da chamada, com custo medido.** usuario 6/24h, curador 12/24h, admin ilimitado — **em código** no v1 (`MENU_SUGGESTION_CAP_BY_ROLE`); se precisar mexer sem deploy, vira coluna em `app_config` como o teto da Extração (#447). Ledger novo `meal_plan_suggestion_event` (migração 0070): a rota faz uma pré-checagem barata (quem está no teto não dispara a leitura do pool), e depois reserva o slot **atomicamente** (lock do usuário + recontagem + INSERT, #446) logo antes da IA; tudo que pode dar 4xx vem antes (pedido inválido, nada a preencher, sem candidatas não gastam slot). Falha ou recusa do modelo **não devolve** o slot (o custo já foi gasto — como a Extração). Admin também grava a linha (sem lock). Depois da chamada a linha ganha modelo, tokens e `cost_usd` snapshot (#463).

7. **Privacidade.** O ledger não guarda conteúdo (nem a nota, nem a prévia) — só usuário, hora, modelo, tokens e custo. `user_id` cascade e está nas `CONTENT_GUARDS` do expurgo de cadastro pendente. Fica fora do export LGPD e é mantido na eliminação (anonimizado com a conta), como o `extraction_event`. A nota do Usuário vai à Anthropic no prompt, como o texto da Extração e o briefing da Geração já vão.

## Consequências

- Uma tabela nova (0070): `meal_plan_suggestion_event (id, user_id FK cascade, created_at, model, input_tokens, output_tokens, cost_usd numeric(12,6))`, índice `(user_id, created_at)`.
- Domínio puro `@/domain/menu-suggestion` (pedido, alvos, categorias por refeição, prompt, schema, resolução, aceite); núcleo `@/server/meal-plan/menu-suggestion` (candidatas, cards da prévia, custo, aceite); `ClaudeClient.suggestMenu`; `reserveMenuSuggestionSlot`/`peekMenuSuggestionQuota` em `@/server/quota/atomic`.
- UI: botão "Sugerir com IA" no Cardápio, painel com pedido → prévia → aceite (`MealPlanSuggestPanel`).
- O custo por sugestão entra no TEXTO do painel de custo de IA do admin (#465: por dia e por usuário; fora do "custo por desfecho", que é sobre Receitas geradas).

## Alternativas rejeitadas

- **Gerar Receitas novas** (dec.1) — lento, caro, e enche o banco.
- **Gravar direto no plano** — o Usuário perderia o controle do que entra; a prévia custa um clique.
- **Mandar o pool inteiro no prompt** — tokens e custo crescem com o app; a amostra por categoria basta.
- **Deixar o modelo aplicar as restrições** — restrição alimentar não é julgamento de modelo (ADR-0004).
- **Enums no schema de saída** — um valor fora do enum derruba o parse inteiro (dec.4).
