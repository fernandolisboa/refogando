# Handoff 63 — Despensa: "Cozinhei" no Cardápio e básicos de cada pessoa (ADR-0042)

**Sessão:** 2026-10-13. **Branch:** `claude/project-thread-e6iox3-pantry` (um PR, rebaseado na main em `29a73e2`, depois do #567). **Migração:** `0074_pantry_basics` (uma coluna em `users`; renumerada de 0073 depois que a `0073_users_restricoes` do #567 entrou). **Merge:** pendente.

Documento auto-suficiente: o que entrou, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

Dois follow-ups dos handoffs 60 e 61 que fecham o ciclo da Despensa (planejar → cozinhar → a casa muda).

- **"Cozinhei" no Cardápio.** Toda Refeição planejada com Receita legível tem o botão (Anotação e Receita indisponível não). O servidor parte só do id da entrada, roda o MESMO casamento do "o que dá pra fazer" restrito àquela Receita e tira da Despensa os itens que cobrem algum Item dela — **nunca os básicos da pessoa**. A linha mostra "Saiu da despensa: farinha, ovo." (+ "Os básicos ficam: sal." quando for o caso), com **"Desfazer"** (devolve exatamente aqueles nomes) e "Ver despensa". Nada bateu ⇒ "Nada da sua despensa bateu com esta receita." Sem estado gravado: o segundo toque não tira nada.
- **Básicos de cada pessoa.** Na Despensa, "Seus básicos" (fechado por padrão): chips da lista efetiva com "tirar", campo para adicionar (vários com vírgula) e "Voltar ao padrão". Quem nunca mexeu fica com a lista padrão de antes (`users.pantry_basics` NULL) e vê o rótulo de sempre em "Tenho o básico"; quem mexeu vê a lista dela no rótulo. "Tenho o básico", "Pôr o que falta na lista" e a exclusão do "Cozinhei" usam os básicos da pessoa.
- **Dados do titular:** `pantryBasics` no export LGPD; eliminação zera a coluna; guarda `pantry_basics IS NULL` no expurgo de cadastro pendente.
- **Guia "Como usar"** (pt-BR e en-US): linha nova no Cardápio ("Cozinhei") e a linha dos básicos da Despensa atualizada. `CONTEXT.md` (Despensa, Plano de refeições) e um ponteiro no ADR-0038 dec.3.

## 2. O que ler primeiro

1. `docs/adr/0042-despensa-cozinhei-e-basicos.md` — as 6 decisões (a dec.5 explica por que não há marcador "cozinhado").
2. `CONTEXT.md` — **Despensa** (básicos, Cozinhei) e **Plano de refeições**.
3. `src/domain/pantry.ts` — fim do arquivo: `MAX_PANTRY_BASICS`, `resolvePantryBasics`, `parsePantryBasics`, `parsePantryRestore`, `splitCookedPantryItems`.
4. `src/server/pantry/pantry.ts` — `queryPantryMatches` (agora recebe `items` com id, os básicos efetivos e `withUsed`; leia o comentário das CTEs e o bloco `usedCte`/`originCol`), `loadPantryBasics`, `applySetPantryBasics`, `applyCookedMealToPantry`.
5. Rotas: `src/app/api/me/meal-plan/entries/[entryId]/cooked/route.ts`, `src/app/api/me/pantry/{basics,restore}/route.ts`, `GET src/app/api/me/pantry/route.ts` (devolve `basics`/`basicsCustom`).
6. UI: `src/components/meal-plan/meal-plan-week-view.tsx` (fim do arquivo: `cookedMessage`, `useCookedMeal`, `CookedButton`, `CookedOutcome`) e `src/components/pantry/pantry-view.tsx` (`PantryBasicsEditor`, `basicsLabel`).
7. Testes: `test/domain/pantry.test.ts`, `test/integration/pantry.test.ts` (blocos ADR-0042), `test/ui/meal-plan-week-view.test.tsx` e `test/ui/pantry-view.test.tsx`.

## 3. Princípios inegociáveis (não regredir)

- **Um casamento só.** O "Cozinhei" usa `queryPantryMatches` com `withUsed` — nunca uma regra paralela. O que a Despensa diz que cobre é o que o "Cozinhei" tira.
- **Servidor decide a partir de ids.** O cliente manda só o id da entrada (e o locale); Receita e nomes saem do servidor. A entrada é escopada pelo dono (404 leak-safe); Anotação ⇒ 409 `sem_receita`.
- **Básicos nunca saem** — os da pessoa, pela chave de dedup, com a opção "Tenho o básico" ligada ou não.
- **NULL = lista padrão, byte a byte.** Quem nunca editou recebe `PANTRY_BASICS` no casamento e o texto `despensa.basicosLista` no rótulo. `{}` é "nenhum básico", não volta ao padrão.
- **Desfazer devolve exatamente o que saiu:** um nome por elemento, sem split por vírgula (`parsePantryRestore`), pelo mesmo `applyAddPantryItems` (idempotente, teto tudo-ou-nada).
- **Um "Desfazer" pendente trava o "Cozinhei" da linha** (`useCookedMeal`): sem isso, o segundo toque devolve `removed: []` e apaga o "Desfazer" que ainda pode devolver os itens. Uma ação por linha em voo; depois do "Desfazer", foco no "Cozinhei".
- **Região viva sempre no DOM** na linha da refeição (`role="status"` com `empty:sr-only`), como no ADR-0040.

## 4. Landmines

- **`users` também está sendo mexida por outro branch** (restrições alimentares no perfil). Conflito textual provável em `src/db/schema.ts` (a coluna `pantryBasics` fica entre `imageGenBlockedReason` e `pendingSignupAt`) e talvez em `account-export.ts`/`account-erasure.ts`: resolver mantendo as duas colunas.
- **`withUsed` muda a FORMA da query.** A coluna `origin` (id do item da Despensa) só entra nas CTEs dos termos quando `withUsed` é verdadeiro (`originCol`/`basicOrigin`/`srcItems`), e a CTE `used` só existe nesse caso. Carregar a coluna sempre, mesmo nula, deixava a lista de resultados ~10% mais lenta no acervo sintético (4.000 Receitas × 10 Itens, 200 itens na Despensa). Medido depois: ~0,55 s antes e depois. Não "simplificar" para uma query só com `origin` sempre presente. As landmines do handoff 60 (barras invertidas em `sql.raw(String.raw…)`, `MATERIALIZED`, `statement_timeout`) seguem valendo.
- **`origin` sem qualificação.** Nas CTEs, `${originCol}` vira `, origin` sem alias de tabela; funciona porque em cada `FROM` só uma relação tem essa coluna. Ao mexer num `FROM` (juntar outra CTE que também tenha `origin`), qualificar.
- **Gate do "Cozinhei" = gate de Salvar** (o do casamento). Uma Receita planejada que ficou inelegível aparece "indisponível" e sem botão; se a corrida acontecer, a resposta é `removed: []` ("nada bateu"), não erro.
- **`recipe-meal-plan-button.tsx`** segue com `PopoverAnchor` de propósito (handoff 61): não foi tocado.
- **Ambiente local:** como no handoff 61 — Testcontainers (pgvector pg17) com o Docker do container (`dockerd &` se `docker info` falhar); `TEST_DATABASE_URL`/`DATABASE_URL` nunca exportados.

## 5. Pendências e follow-ups

- **Histórico do que se cozinhou** ("cozinhei 3 vezes este mês", sugerir repetir): exigiria o marcador que o ADR-0042 dec.5 recusou para o "Cozinhei" de hoje. Se vier, é uma tabela própria de eventos, não uma coluna na entrada.
- **"Cozinhei" fora do Cardápio** (no detalhe da Receita ou no Modo cozinha) — mesma rota com a Receita em vez da entrada; não feito para manter o servidor partindo de um id que já é da pessoa.
- **Exclusão de básicos por plural/canônico** ("sal grosso" vs básico "sal"): hoje só pela chave de dedup.
- Do handoff 60/61/57/56, seguem abertos: trocar um item da prévia da Sugestão, editar anotação na linha, copiar de uma semana qualquer.
- **Jurídico (dono, #276):** a política de privacidade precisa citar, no export e na eliminação, os **básicos da Despensa** (lista de nomes que a pessoa escolheu; `null` quando nunca mexeu) — no mesmo bloco ainda pendente da Despensa, do Cardápio e da Lista.

## 6. Critério de saída

PR mergeado com o painel de revisão limpo e o "checks" verde; migração 0074 aplicada no deploy de produção; memória do projeto atualizada.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

```
Leia docs/handoffs/63-despensa-cozinhei-e-basicos-adr-0042.md e o ADR-0042. O "Cozinhei" no Cardápio (tira da Despensa o que a Receita usa, nunca os básicos, com Desfazer) e os básicos de cada pessoa (users.pantry_basics, NULL = lista padrão) estão em produção. Próximo passo sugerido: um follow-up da seção 5. Seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
