# Handoff 61 — Lista de compras no celular (#562) e pontes para o Cardápio (ADR-0040, #563)

**Sessão:** 2026-10-01. **Branch:** `claude/project-thread-1rzqse` (dois PRs em sequência: #562 e #563). **Migração:** nenhuma. **Merge:** #562 (229995f) e #563 (89f9b06, 2026-10-12).

Documento auto-suficiente: o que entrou, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

O dono escolheu, entre três propostas, (A) Despensa → Cardápio + "receita nova para um buraco da semana" e (C) um check de produção, e pediu junto a Lista de compras legível no celular.

- **#562 — Lista de compras no celular** (`src/components/shopping-list/shopping-list-items-view.tsx`). Abaixo de `sm`: ações da linha viram ícones de 36px (lápis/lixeira, mesmo `aria-label`) e nunca quebram para baixo; o texto do item é uma `Label` ligada ao checkbox (tocar no texto marca); a barra de ações vira grade de 2 colunas com "Guardar marcados na despensa" PRIMEIRO no DOM (ordem do Tab = ordem visual, sem `order-*`); o formulário de item avulso põe quantidade e unidade lado a lado (select com `h-9`, a altura do input). Desktop praticamente igual (a barra agora lê Guardar → Remover → Limpar).
- **#563 — Pontes para o Cardápio (ADR-0040).**
  - Despensa: todo card de "O que dá pra fazer" tem **"Pôr no cardápio"** (popover de dia + refeição, porções da Receita). Os cards também deixaram de estourar ~94px no celular (`min-w-0` no `li` da grade).
  - Cardápio: o seletor de cada dia tem **"Criar receita nova com IA"** → `/create?q=uma receita para o jantar&planDay=YYYY-MM-DD&planSlot=jantar`. Nunca gera sozinho.
  - Criação (Prompt, Estruturado e Conversa): o resultado mostra **"Pôr no cardápio: ter., 06/10, jantar"** (um toque) quando há alvo, ou o popover de dia + refeição quando não há. Brincadeira (`playful`) não ganha o botão.
  - Guia "Como usar" (pt-BR e en-US), CONTEXT.md e um ponteiro no ADR-0038.

## 2. O que ler primeiro

1. `docs/adr/0040-pontes-para-o-cardapio-despensa-e-criacao.md`.
2. `src/components/meal-plan/plan-recipe-panel.tsx` — `usePlanMealEntry` (o POST + mapeamento de erro), `PlannedNotice`, `PlanRecipePanel`, `PlanRecipePopoverButton`. Fonte única de "planejar uma Receita" fora do Cardápio.
3. `src/components/meal-plan/generated-recipe-plan-action.tsx` e `meal-plan-target-context.tsx`; `src/components/recipe/create-shell-client.tsx` (lê `?planDay&planSlot`).
4. `src/domain/meal-plan.ts` — `parseMealPlanTarget`, `createForMealSlotHref`.

## 3. Princípios inegociáveis (não regredir)

- **Nada gera nem planeja sozinho.** O link só semeia o pedido; planejar sempre exige o toque.
- **Alvo de semana passada vale como sem alvo** (link antigo/favorito nunca planeja numa data invisível); o rótulo do toque traz a data.
- **Gate único no servidor** (`POST /api/me/meal-plan/entries`, gate de Salvar). O cliente nunca decide elegibilidade; `playful` só some da UI porque o servidor recusaria.
- **Região viva sempre no DOM** (`sr-only`/`empty:sr-only`), nunca inserida junto do texto.
- **Lista no celular:** ações na mesma linha do item; ordem do DOM = ordem visual.

## 4. Landmines

- `recipe-meal-plan-button.tsx` (detalhe) ainda usa `PopoverAnchor` + `onClick` manual (padrão antigo, por conflito com o bookmark). Os botões novos usam `PopoverTrigger`. Não "unificar" sem testar o detalhe.
- **Ambiente local:** PG 16 do container não roda as migrações em uma transação só (`unsafe use of new value "web_imported"`). Para um banco de dev local, aplicar cada `drizzle/*.sql` com `psql -f` na ordem do `_journal.json`. Os testes de integração precisam do Docker (`dockerd &` no container) para o Testcontainers (pgvector pg17). `TEST_DATABASE_URL` nunca exportado.
- **Seed local:** `seed-catalog` usa o ledger commitado; para semear um banco local, esvaziar o ledger, rodar com `--force` e restaurar o arquivo com `git checkout`.

## 5. Check de produção (2026-10-01, só leitura)

- Produção em `67e181f` (#560); 16 deploys desde 09-28, todos READY.
- `account-purge` (inclui o expurgo de cadastros pendentes) respondeu 200 às 09:30 UTC em 09-29, 09-30 e 10-01; `dsar-sla` e `rate-limit-cleanup` rodaram todo dia.
- Zero 5xx, zero logs de erro ou warning desde o deploy de 09-29; zero "Resend recusou o envio".
- **Lacunas:** o cron de purge não loga as contagens (só no corpo da resposta), e `mailer.ts` não loga envio bem-sucedido nem fetch que lança. Proposto ao dono: uma linha de contagem no purge e `[mail]` para envio/erro.

## 6. Pendências e follow-ups

- Os logs acima (aguardando o dono).
- Do handoff 60/57/56: descontar da Despensa ao cozinhar, básicos configuráveis, trocar um item da prévia da Sugestão, editar anotação na linha, preferências de restrição no perfil, copiar de uma semana qualquer.
- **Jurídico (dono, #276):** a política de privacidade ainda não cita Cardápio, Lista e Despensa no export.

## 7. Critério de saída

#562 e #563 mergeados com o painel de revisão limpo e o "checks" verde; deploy de produção; memória do projeto atualizada.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

```
Leia docs/handoffs/61-lista-no-celular-e-pontes-para-o-cardapio-adr-0040.md e o ADR-0040. A Lista de compras no celular (#562) e as pontes Despensa/criação → Cardápio (#563) estão em produção. Próximo passo sugerido: os logs de contagem do purge e de envio de e-mail (seção 5), ou um follow-up da seção 6. Seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
