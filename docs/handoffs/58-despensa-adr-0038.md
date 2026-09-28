# Handoff 58 — Despensa: "o que dá pra fazer com o que eu tenho" (ADR-0038)

**Sessão:** 2026-09-28. **Branch:** `claude/next-feature-round-five-kr6dzu` (um PR). **Migração:** `0072_pantry` (tabela `pantry_item`; entra no deploy da main via `npm run db:migrate`).

Documento auto-suficiente: o que a feature é, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

Quinta rodada do "construa a próxima feature grande". Sem issue `ready-for-agent`; os follow-ups do Cardápio que sobraram eram pequenos, então saiu o **modo despensa** (segundo colocado da rodada 2, handoff 55).

- **Página `/me/pantry` ("Despensa" na nav logada, desktop e drawer).** A pessoa diz o que tem em casa: campo que aceita vários nomes separados por vírgula, atalhos de itens comuns (somem quando já estão na Despensa), chips com "tirar", "Limpar despensa". Sem quantidade.
- **"O que dá pra fazer"**: Receitas que a pessoa pode Salvar com **no máximo 3 Itens faltando**, em duas seções — **"Dá pra fazer agora"** e **"Falta pouco"** — com "Você tem 5 de 7" e "Falta: açúcar, fermento". Opção **"Tenho o básico"** (sal, água, óleo, azeite, pimenta-do-reino), ligada por padrão.
- **"Pôr o que falta na lista"** em cada Receita: o servidor recalcula o que falta e põe só isso, na quantidade base, na lista-padrão (link "Abrir lista").
- **"Criar receita com o que tenho"**: link para `/create?q=uma receita com …` (o mesmo atalho da Busca; nunca gera sozinho).
- **Na Lista de compras, "Guardar marcados na despensa"**: copia os nomes dos itens comprados para a Despensa, sem apagar nada da Lista.
- Export LGPD ganha `pantry`; eliminação de conta apaga a Despensa; `pantry_item` entrou nas guardas do expurgo de cadastro pendente.

## 2. O que ler primeiro

1. `docs/adr/0038-despensa-o-que-da-pra-fazer-com-o-que-tenho.md` — as 7 decisões.
2. `CONTEXT.md` — **Despensa**.
3. `src/domain/pantry.ts` — `parsePantryName`, `pantryMatchKey` (dedup), `splitPantryInput`, `PANTRY_BASICS`, tetos, `splitPantryMatches`, `pantryCreatePrompt`.
4. `src/server/pantry/pantry.ts` — CRUD, `queryPantryMatches` (a query do casamento, com o comentário das 7 CTEs), `loadPantryMatches`, `applyPantryMissingToShoppingList`, `applyCheckedItemsToPantry`.
5. `src/server/shopping-list/shopping-list.ts` — `readRecipeItemsForList` aceita `lineIds`; `applyAddRecipeLinesToShoppingList` (novo, mesmo upsert do ADR-0032).
6. Rotas: `src/app/api/me/pantry/{route,[itemId]/route,matches/route,missing-to-list/route}.ts` e `src/app/api/me/shopping-lists/[listId]/items/checked/to-pantry/route.ts`.
7. UI: `src/components/pantry/pantry-view.tsx`; o botão novo em `src/components/shopping-list/shopping-list-items-view.tsx`.

## 3. Princípios inegociáveis (não regredir)

- **Privada.** Toda leitura/escrita escopa por `session.user.id`; item de outro e inexistente são o mesmo 404.
- **Casamento por nome, nunca por IA.** Palavra(s) inteira(s) + plural regular + expansão pelo canônico (todos os locales). Os dois lados normalizados pela MESMA expressão SQL (`norm()` em `pantry.ts`).
- **Básicos cobrem só a linha feita inteira de básicos** e nunca bastam sozinhos para mostrar uma Receita (`real_covered >= 1`).
- **Gate = o de Salvar** (`viewerReadableSqlFragment` + `poolBarriersSqlFragment`), não o da Busca: a ponte para a Lista usa `eligibleToSaveByViewer`, e o que aparece tem de poder ir para a lista.
- **"O que falta" é recalculado no servidor**; o cliente só manda `recipeId` e `basics`.
- **Adicionar é tudo ou nada no teto** (200 itens), com advisory lock por usuário.

## 4. Landmines

- **Barras invertidas no SQL:** `ESC_TERM`, `SINGULAR_ES` e `SINGULAR_S` são `sql.raw(String.raw\`…\`)` de propósito. Dentro de um template `sql\`…\``, `\1` vira escape do JS e some. Não "simplificar".
- **`[[:punct:]]`/`lower()` dependem do locale do banco** (C/UTF-8 no Neon e nos testes): acento sai antes via `immutable_unaccent`, então letras latinas funcionam; scripts não latinos casam só por igualdade exata.
- **Custo da query:** varre os Itens de todas as Receitas legíveis (Seq Scan), com uma regex compilada por tipo (real/básico). Aceito pelo tamanho do acervo. Se ficar lento: coluna gerada com o `raw_text` normalizado + índice trigram.
- **Plural irregular** (limão/limões, pão/pães) só casa via canônico. `SINGULAR_ES` exige radical de 3+ letras para "pães" não virar "pa".
- **Preview da Vercel flaka em PR com migração** (0072 aqui): gatear só no check "checks".
- **Uma migração em voo por vez.** Se outra entrar na main antes, apagar `0072_*.sql` + snapshot, reverter `_journal.json` e `npx drizzle-kit generate --name pantry` de novo.
- **Testes de integração locais:** PG 17 com pgvector, `TEST_DATABASE_URL` inline no comando, nunca exportado.

## 5. Pendências e follow-ups

- **Ponte Despensa → Cardápio:** "adicionar ao cardápio" direto do card de resultado.
- **Descontar da Despensa ao cozinhar** (hoje a Despensa só muda à mão ou pela Lista).
- **Básicos configuráveis** por pessoa (hoje lista fixa, opção só na tela).
- Do handoff 57/56, seguem abertos: gerar uma Receita para um buraco da semana, trocar um item da prévia da Sugestão, editar anotação na linha, preferências de restrição salvas no perfil.
- **Jurídico (dono, #276):** a política de privacidade não cita a Despensa no export (mesmo bloco pendente do Cardápio e da Lista).

## 6. Critério de saída

PR mergeado com o painel de revisão limpo e o "checks" verde; migração 0072 aplicada no deploy de produção; memória do projeto atualizada.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

```
Leia docs/handoffs/58-despensa-adr-0038.md e o ADR-0038. A Despensa ("o que dá pra fazer com o que eu tenho", /me/pantry) está em produção. Próximo passo sugerido: um dos follow-ups da seção 5 (Despensa → Cardápio, descontar da Despensa ao cozinhar, ou os pendentes do Cardápio). Seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
