# Handoff 60 — Despensa: "o que dá pra fazer com o que eu tenho" (ADR-0038)

**Sessão:** 2026-09-28/29 (mergeado depois do guia de uso, handoff 59). **Branch:** `claude/next-feature-round-five-kr6dzu` (um PR). **Migração:** `0072_pantry` (tabela `pantry_item`; entra no deploy da main via `npm run db:migrate`).

Documento auto-suficiente: o que a feature é, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

Quinta rodada do "construa a próxima feature grande". Sem issue `ready-for-agent`; os follow-ups do Cardápio que sobraram eram pequenos, então saiu o **modo despensa** (segundo colocado da rodada 2, handoff 55).

- **Página `/me/pantry` ("Despensa" na nav logada, desktop e drawer).** A pessoa diz o que tem em casa: campo que aceita vários nomes separados por vírgula, atalhos de itens comuns (somem quando já estão na Despensa), chips com "tirar", "Limpar despensa". Sem quantidade.
- **"O que dá pra fazer"**: Receitas que a pessoa pode Salvar com **no máximo 3 Itens faltando**, em duas seções — **"Dá pra fazer agora"** e **"Falta pouco"** — com "Você tem 5 de 7" e "Falta: açúcar, fermento". Opção **"Tenho o básico"** (sal, água, óleo, azeite, pimenta-do-reino), ligada por padrão.
- **"Pôr o que falta na lista"** em cada Receita: o servidor recalcula o que falta e põe só isso, na quantidade base, na lista-padrão (link "Abrir lista").
- **"Criar receita com o que tenho"**: link para `/create?q=uma receita com …` (o mesmo atalho da Busca; nunca gera sozinho).
- **Na Lista de compras, "Guardar marcados na despensa"**: copia os nomes dos itens comprados para a Despensa, sem apagar nada da Lista.
- **Guia "Como usar" e tour (ADR-0039):** seção **Despensa** em `messages.guia` e passo `despensa` no tour, com âncora `nav-despensa` no link da nav.
- Export LGPD ganha `pantry`; eliminação de conta apaga a Despensa; `pantry_item` entrou nas guardas do expurgo de cadastro pendente.

## 2. O que ler primeiro

1. `docs/adr/0038-despensa-o-que-da-pra-fazer-com-o-que-tenho.md` — as 7 decisões.
2. `CONTEXT.md` — **Despensa**.
3. `src/domain/pantry.ts` — `parsePantryName`, `pantryMatchKey` (dedup), `splitPantryInput`, `PANTRY_BASICS`, tetos, `splitPantryMatches`. O texto do atalho de criação e o rótulo dos básicos moram nas mensagens (`despensa.criarPrompt`, `despensa.basicosLista`).
4. `src/server/pantry/pantry.ts` — CRUD, `queryPantryMatches` (a query do casamento, com o comentário das CTEs), `loadPantryMatches`, `applyPantryMissingToShoppingList`, `applyCheckedItemsToPantry`.
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

- **Barras invertidas no SQL:** `ESC_TERM`, `SINGULAR_ES`, `SINGULAR_S`, `PLURAL_FIRST_S` e `PLURAL_FIRST_ES` são `sql.raw(String.raw\`…\`)` de propósito. Dentro de um template `sql\`…\``, `\1` vira escape do JS e some. Não "simplificar".
- **`[[:punct:]]`/`lower()` dependem do locale do banco** (C/UTF-8 no Neon e nos testes): acento sai antes via `immutable_unaccent`, então letras latinas funcionam; scripts não latinos casam só por igualdade exata.
- **Forma da query (desempenho).** A primeira versão casava cada linha com uma regex gigante e levava ~10 s num acervo sintético de 4.000 Receitas × 10 Itens com 200 itens na Despensa. A atual leva ~0,6 s no mesmo banco: o termo real vira `real_forms` (termo, `+s`, `+es`, plural da primeira palavra) com a PRIMEIRA palavra separada; cada linha normalizada é quebrada em palavras (`tokens`) e o casamento é um JOIN de igualdade na primeira palavra, seguido da comparação da fatia do array. Só os básicos usam regex, e ela é ancorada na linha inteira. `it_names`, `lines` e `hits` são `MATERIALIZED` para o planner não reavaliar `norm()` por linha. Não voltar para `~` por termo.
- **Timeout.** A query roda num `db.transaction` com `SET LOCAL statement_timeout` de 5 s (`PANTRY_QUERY_TIMEOUT_MS`): um acervo que cresça demais falha a tela em vez de segurar conexão. Sem rate limit (leitura autenticada, como as outras de `/api/me`). Se ficar lento: coluna gerada com o `raw_text` normalizado + índice.
- **Teto de "o que falta" na ponte:** `applyPantryMissingToShoppingList` recalcula com `maxMissing: NO_MISSING_CAP` (100.000, cabe num `int`; `Number.MAX_SAFE_INTEGER` estoura o bind).
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
Leia docs/handoffs/60-despensa-adr-0038.md e o ADR-0038. A Despensa ("o que dá pra fazer com o que eu tenho", /me/pantry) está em produção. Próximo passo sugerido: um dos follow-ups da seção 5 (Despensa → Cardápio, descontar da Despensa ao cozinhar, ou os pendentes do Cardápio). Seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
