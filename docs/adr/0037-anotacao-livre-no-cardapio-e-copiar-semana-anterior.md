# ADR-0037 — Anotação livre no Cardápio e "Copiar semana anterior"

Status: aceito

O dono pediu (2026-09-28) "a próxima feature grande". Não havia issue `ready-for-agent` aberta; o ADR-0035 (dec.1 e Consequências) e o handoff 56 deixaram dois follow-ups do Cardápio: **entrada de texto livre** ("jantar fora", "sobras") e **copiar a semana anterior**. Os dois tratam do mesmo atrito — montar a semana dá trabalho, e a semana real tem refeições que não são Receita — e mexem na mesma tabela, então saem juntos. Termo no `CONTEXT.md` (**Anotação**, dentro de **Plano de refeições**). Relaciona: ADR-0035 (Plano de refeições), ADR-0036 (Sugestão de cardápio), ADR-0027 (gate de Salvar), ADR-0032 (Lista de compras).

## Decisões

1. **Uma Refeição planejada é uma Receita OU uma Anotação — exatamente uma das duas.** A mesma tabela `meal_plan_entry` ganha `note text` e `recipe_id` passa a aceitar NULL; um CHECK (`(recipe_id IS NULL) <> (note IS NULL)`) garante que toda linha é de um tipo só. A Anotação é texto curto de UMA linha (1–80 caracteres, normalizado: NFC, sem controles, marcas de direção bidi nem invisíveis de largura zero, espaços colapsados; o ZWJ dos emoji compostos fica) e **não tem porções** (outro CHECK). **Rejeitado:** tabela à parte para anotações (duplicaria a leitura por semana, o teto por dia, o mover e o apagar); anotação como comentário preso a uma Receita (resolve outro problema — "sem cebola" — e não o "jantar fora").

2. **A Anotação ocupa a refeição do dia.** Conta no teto de 12 por dia, aparece na semana na ordem das refeições, pode ser movida e tirada como qualquer entrada, e **preenche o buraco**: a Sugestão de cardápio com "só preencher refeições vazias" não planeja por cima de um "jantar fora", e a cópia da semana também não. A MESMA anotação na MESMA refeição do dia é idempotente (`UNIQUE(user_id, day, slot, note)`; NULLs são distintos, então as linhas de Receita nunca colidem nela, nem as anotações na UNIQUE da Receita). Mover uma anotação para onde já existe a mesma anotação ⇒ 409, como a Receita. Porções numa anotação ⇒ 400 (o CHECK seria um 500).

3. **Anotação nunca vai para a Lista de compras** (não tem ingredientes). "Gerar lista de compras" lê só as linhas com Receita; um período só com anotações é `plano_vazio`, e o botão fica desabilitado quando a semana visível não tem nenhuma Receita.

4. **O texto da Anotação nunca vai ao modelo.** A Sugestão lê do plano só dia, refeição e Receita (`loadPlannedSlots`); a coluna `note` não é selecionada ali. Um texto livre do Usuário no prompt seria injeção de prompt gratuita, sem ganho: o que importa para a sugestão é que a refeição está ocupada.

5. **"Copiar semana anterior" repete a semana de antes, só nas refeições VAZIAS.** `POST /api/me/meal-plan/copy-previous-week {week, fromDay?}`: `week` é a segunda-feira do destino; a origem é a semana de 7 dias antes, dia a dia (segunda → segunda). Entram Receitas (com as porções gravadas) e Anotações. Uma refeição do dia que já tem QUALQUER coisa no destino fica como está — copiar preenche buracos, nunca empilha um segundo almoço (o mesmo default do "só preencher refeições vazias" da Sugestão); entradas da origem na mesma refeição vazia entram juntas (prato + acompanhamento). Respeita o teto por dia. **Rejeitado:** substituir a semana (destrutivo e sem desfazer); copiar de uma semana qualquer (o caso real é "repete a da semana passada"; outra semana é navegar até ela e copiar dali).

6. **Na semana corrente, de hoje em diante.** O cliente manda `fromDay = hoje` (o dia é do fuso de quem planeja — ADR-0035 dec.2; o servidor nunca deriva o dia): os dias que já passaram não são preenchidos, e o que caía neles nem conta como "pulado". Nas outras semanas, a semana inteira.

7. **A cópia re-aplica o gate de Salvar.** Uma Receita da semana passada que ficou inelegível (virou privada de outro, removida por moderação) **não é copiada** — senão a cópia criaria uma referência nova a uma Receita que o Usuário não pode mais ler. Conta como pulada. Tudo escopado pelo `user_id` da sessão: a cópia só lê o plano do próprio Usuário. Escrita numa transação, com `ON CONFLICT DO NOTHING` sem alvo (cobre as duas UNIQUEs): um duplo clique não duplica nada.

## Consequências

- **Migração 0071** (`0071_meal_plan_note`): `recipe_id` DROP NOT NULL, coluna `note`, os dois CHECKs e a UNIQUE da anotação. Linhas existentes já satisfazem tudo (têm Receita, sem anotação). A FK de `recipe_id` segue ON DELETE cascade.
- Domínio: `parsePlanNote`, `MEAL_PLAN_NOTE_MAX`, `planPreviousWeekCopy` (kernel puro da cópia) em `@/domain/meal-plan`.
- Servidor: `applyAddMealPlanNote`, `applyCopyPreviousWeek`; `loadMealPlan` lê as anotações numa segunda consulta; `MealPlanEntryView` ganha `note`. `POST .../entries` aceita `{note, day, slot}` no lugar de `{recipeId, …}`.
- UI: o seletor do "Adicionar" ganha "Sem receita" (campo + atalhos "Comer fora", "Sobras", "Delivery"); a semana mostra a anotação com o texto e um ícone, sem porções; botão "Copiar semana anterior" no topo, com o resultado numa linha.
- Export LGPD inclui `note` (texto do próprio titular). A eliminação da conta e o expurgo de cadastro pendente já apagam o plano inteiro.
- **Jurídico (dono, #276):** a política de privacidade já não citava o Cardápio no export (pendência do ADR-0035); a anotação é mais um campo desse mesmo bloco.

## Alternativas rejeitadas

- **Tabela própria para anotações** — dec.1.
- **Mandar o texto da anotação para a IA** como contexto da sugestão — dec.4.
- **Copiar substituindo a semana de destino** — dec.5.
- **Copiar Receitas inelegíveis como "indisponível"** — dec.7.
