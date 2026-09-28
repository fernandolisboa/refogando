# ADR-0035 — Plano de refeições: cardápio semanal privado, dias de calendário do cliente, lista de compras por porções planejadas

Status: aceito

O dono pediu (2026-09-28) "a próxima feature grande, que mude alguma coisa no app". O handoff 54 e o ADR-0032 deixaram o **planejador semanal** como o degrau seguinte da Lista de compras: a agregação por ingrediente e a escala por porções já existiam, faltava o "o que vou cozinhar quando". Termo no `CONTEXT.md` (**Plano de refeições**). Relaciona: ADR-0032 (Lista de compras, merge/snapshot), ADR-0027 (Salvar — o gate de elegibilidade), #452 (escalador de porções), ADR-0011 (privacidade por dono).

## Decisões

1. **Uma Refeição planejada = (dono, dia, refeição do dia, Receita, porções).** Refeições do dia fixas: café da manhã, almoço, lanche, jantar (enum `meal_slot`, ordem de exibição). Várias Receitas na mesma refeição (prato + acompanhamento). A mesma Receita duas vezes na MESMA refeição do MESMO dia não faz sentido: `UNIQUE(user_id, day, slot, recipe_id)`, e re-planejar é upsert (idempotente): com porções no pedido elas valem; sem porções (o seletor do Cardápio não manda) as já ajustadas ficam. Teto de 12 por dia (anti-abuso, no servidor). **Rejeitado no v1:** entrada de texto livre ("jantar fora", "sobras") — útil, mas pede outro formato de linha; fica como follow-up.

2. **Dia de calendário do cliente, semana ISO.** `day` é `date` (sem fuso): "terça" é a terça de quem planeja. O **navegador** diz qual é hoje e qual semana quer ver (`?from&to`); o servidor nunca deriva o dia do próprio relógio (Vercel roda em UTC; às 22h de São Paulo já seria amanhã). A semana começa na **segunda** (ISO 8601). Leituras aceitam no máximo 14 dias e "gerar lista" no máximo 7 (limita o trabalho por requisição), entre 2019-12-30 e 2101-01-02 (uma segunda e um domingo; só barra lixo). **Rejeitado:** timestamp com fuso (um dia de cardápio não é um instante) e semana começando no domingo (a semana de refeições e de compras é seg→dom; o fim de semana fica junto).

3. **O plano aponta pra Receita VIVA (não é snapshot).** Diferente da Lista (ADR-0032 dec.3), o plano é intenção futura: abrir a Receita planejada mostra a versão atual. FK `recipe_id` ON DELETE **cascade** (o dono apagou a Receita ⇒ a refeição planejada some). Receita que só ficou **inelegível** (virou privada, removida por moderação) continua no plano e a leitura a mostra como **"Receita indisponível"**, sem título, com o botão de tirar. **Rejeitado:** snapshot do título (congelaria um nome que o autor pode ter mudado por um motivo, e vazaria o título de uma Receita que o dono do plano não pode mais ler).

4. **Quem entra no plano: o gate de Salvar.** `eligibleToSaveByViewer` (ADR-0027 D2), o mesmo da Lista: pool público (comunidade + catálogo aprovado) OU a própria Receita, mesmo privada. Planejar uma inelegível ⇒ 404 leak-safe. Dois caminhos de entrada: o **botão de calendário** no detalhe de qualquer Receita (dia entre os próximos 7 a partir de hoje + refeição; porções = o valor corrente do escalador da página, como o carrinho) e o **"Adicionar"** de cada dia no Cardápio, que abre um seletor com as Receitas do próprio acervo (Salvos + Minhas criações).

5. **Plano → Lista de compras escala CADA entrada pelas suas porções.** "Gerar lista de compras" joga numa Lista (existente ou nova, com nome sugerido pela semana) os ingredientes de todas as refeições do período (semana inteira, ou de hoje até domingo na semana corrente), pelo MESMO núcleo do ADR-0032 (`readRecipeItemsForList` + `writeRecipeItemsToList`: merge por chave+unidade, soma só unidade idêntica, snapshot, nunca converte). Cada entrada entra escalada pelas **suas** porções (`null` ⇒ base); a mesma Receita em dois dias entra duas vezes e soma. Isto é uma exceção consciente ao ADR-0032 dec.7 (multi-adicionar sempre na base): lá a base evitava um seletor de porções por item na grade de seleção; aqui as porções já foram escolhidas entrada a entrada. Receita sem `porcoes` com porções pedidas ⇒ base + aviso (contado). Cada Receita é lida uma vez e a escrita roda numa **transação** (um timeout no meio não deixa lista meio escrita que um retry somaria de novo). A lista NOVA é criada pelo próprio endpoint, na MESMA transação da soma, e só fica se ao menos uma refeição entrou (período vazio ou só com Receitas indisponíveis ⇒ `plano_vazio`, nada criado): nunca sobra lista órfã. A posse da Lista é checada dentro da transação com `FOR UPDATE`, o que serializa dois "adicionar" na mesma lista. Gerar duas vezes pra mesma lista soma de novo (a lista é artefato de compra; a UI pré-escolhe a lista da semana já gerada).

6. **Privado, como Salvos e a Lista.** Toda leitura e escrita escopa por `user_id` da sessão; "não é sua" e "não existe" são o mesmo 404. Entra no **export LGPD** (e as Listas de compras, que tinham ficado de fora, entram junto). Cai em cascata com o Usuário (e está nas guardas do expurgo de cadastro pendente, `CONTENT_GUARDS`). Na eliminação self-service da conta (que anonimiza e MANTÉM receitas e avaliações, das quais terceiros dependem) o plano é APAGADO: é privado e ninguém mais depende dele.

## Consequências

- **Uma tabela nova** (migração 0069): `meal_plan_entry` (`user_id` FK cascade, `day date`, `slot meal_slot`, `recipe_id` FK cascade, `porcoes smallint` 1–99 nullable com CHECK, timestamps), `UNIQUE(user_id, day, slot, recipe_id)`, índice `(recipe_id)` (a UNIQUE, com prefixo `(user_id, day)`, já serve as leituras por semana).
- Domínio puro `@/domain/meal-plan` (datas de calendário, semana ISO, validação de intervalo/porções, ordenação); núcleo `@/server/meal-plan/meal-plan`; `applyAddPlannedRecipesToShoppingList` no núcleo da Lista (reuso, não reimplementação).
- Rotas: `GET /api/me/meal-plan?from&to`, `POST /api/me/meal-plan/entries`, `PATCH|DELETE /api/me/meal-plan/entries/[id]`, `POST /api/me/meal-plan/shopping-list` (`listId` ou `newListName`).
- UI: página `/me/meal-plan` ("Cardápio da semana", `?semana=` na URL), "Cardápio" na nav logada, botão de calendário no detalhe. E o **índice das Listas** (`/me/shopping-lists`, no menu da conta): antes uma lista só era alcançável pelo link logo depois de criada.
- Follow-ups naturais: entrada de texto livre (dec.1), copiar a semana anterior, sugestão de cardápio por IA (configurável por modelo no admin, como toda feature de IA).

## Alternativas rejeitadas

- **Texto livre no v1** — adiado (dec.1).
- **Dia/semana pelo relógio do servidor** — errado perto da meia-noite pra quem não está em UTC (dec.2).
- **Snapshot da Receita no plano** — o plano é intenção, não artefato; e vazaria título de Receita inelegível (dec.3).
- **Gerar a lista sempre na base** (como o multi-adicionar) — jogaria fora as porções que o usuário escolheu por refeição (dec.5).
