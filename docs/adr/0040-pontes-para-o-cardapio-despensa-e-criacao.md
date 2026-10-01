# ADR-0040 — Pontes para o Cardápio: da Despensa e da criação ("receita nova para esta refeição")

Status: aceito

O dono (2026-10-01) escolheu, entre os follow-ups dos handoffs 57 e 60, "Despensa → Cardápio" e "gerar uma Receita nova para um buraco da semana". Os dois são pontes para o Cardápio (ADR-0035) a partir de lugares que já existiam; nenhuma tabela, rota ou regra de servidor nova. Relaciona: ADR-0035 (Cardápio, gate de Salvar), ADR-0038 (Despensa), ADR-0021 (drawer de criação e seus deep-links), #166 (o atalho `/create?q=` da Busca).

## Decisões

1. **Todo card de "O que dá pra fazer" tem "Pôr no cardápio".** Abre o mesmo painel do botão de calendário do detalhe (dia entre os próximos 7 + refeição), agora extraído para `PlanRecipePanel`. Vale também para "Dá pra fazer agora" (antes esses cards não tinham ação nenhuma). Porções: as da Receita (`porcoes` ausente), como no seletor do Cardápio; ajusta-se na linha depois. O gate é o de sempre (`POST /api/me/meal-plan/entries`, ADR-0035 dec.4), e o resultado da Despensa já usa o mesmo gate de Salvar (ADR-0038), então o que aparece pode ir para o Cardápio.

2. **"Criar receita nova com IA" no seletor de cada dia do Cardápio leva o dia e a refeição para a criação.** O link é `/create?q=<pedido>&planDay=<YYYY-MM-DD>&planSlot=<refeição>`: o pedido ("uma receita para o jantar") semeia o Prompt aberto, como o atalho da Busca, e **nunca gera sozinho** (a pessoa revisa e aciona "Gerar"). O dia e a refeição são os escolhidos no próprio seletor. **Rejeitado:** gerar direto do Cardápio (pularia a revisão do pedido e o custo de IA ficaria escondido atrás de um clique de "Adicionar") e um pedido montado com a Despensa (útil, mas mistura duas intenções; "Criar receita com o que tenho" já existe na Despensa).

3. **O resultado da criação oferece pôr a Receita nova no Cardápio.** Com o alvo na URL, é um toque: "Pôr no cardápio: terça-feira, jantar". Sem alvo (o drawer aberto pelo botão "Criar" do topo), o mesmo botão abre o painel de dia + refeição; antes, planejar uma Receita recém-gerada exigia abrir o detalhe. Nada é planejado sem o toque. Resultado brincadeira (`playful`) não ganha o botão: não passa no gate de Salvar e o servidor recusaria. O alvo chega por contexto React (`MealPlanTargetProvider` na `/create`), lido só pelo resultado, sem descer prop pelo drawer e pelos caminhos de criação. Alvo inválido na URL (dia inexistente, refeição desconhecida) é ignorado (`parseMealPlanTarget` é total).

## Consequências

- Domínio: `parseMealPlanTarget` e `createForMealSlotHref` em `@/domain/meal-plan`.
- UI: `plan-recipe-panel.tsx` (extraído de `recipe-meal-plan-button.tsx`), `generated-recipe-plan-action.tsx`, `meal-plan-target-context.tsx`; botão novo nos cards da Despensa e link no seletor do Cardápio.
- O guia "Como usar" ganhou uma linha no Cardápio e outra na Despensa.
- Sem migração.

## Alternativas rejeitadas

- **Gerar a Receita a partir do Cardápio sem passar pela tela de criação** (dec.2).
- **Planejar automaticamente ao terminar a geração quando há alvo**: a Receita pode não agradar; "Criar outra" e só então planejar é o caminho natural, e um toque não pesa (dec.3).
- **Passar o alvo por prop** por `CreateShellClient → CreateDrawer → CreateStructuredExperience/Wizard → GenerationResultRegion`: quatro componentes mudariam de assinatura para um dado que só o último usa.
