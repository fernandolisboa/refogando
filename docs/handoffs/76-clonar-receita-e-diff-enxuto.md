# Handoff 76 — Clonar receita e "O que mudou" só com o que mudou

**Sessão:** 2026-10-15. **Branch:** `claude/clone-receita-diff-enxuto-ozj7j9`. **Sem migração** (a última aplicada segue 0078). Origem: o dono pediu (1) um botão para clonar direto, ao lado de "Criar minha versão" (que abre o modal de edição), e (2) que "O que mudou" mostrasse só o que mudou: ele criou uma cópia sem mexer em nada e a seção listava o antigo e o novo iguais. Decisões no ADR-0045; termo **Clonar** no `CONTEXT.md` (verbete **Receita derivada**).

## 1. O que mudou

- **Causa do diff fantasma:** `decideDerivedDiff` comparava byte a byte e o form devolve outra forma ("3.000" do banco vira "3"; títulos/rawText aparados; passos um por linha; descrição vazia vira null). Agora compara como o leitor lê (`src/domain/recipe-diff.ts`: `quantidadesIguais`, `normTexto`, `normPassos`).
- **Diffs já gravados:** `pruneNoopChanges` poda o ruído na projeção do dono (`src/domain/recipe-read.ts`); o banco não é reescrito.
- **Vista** (`src/components/recipe/recipe-diff-view.tsx`): diff vazio ⇒ sem seção (com vínculo perdido, só a nota); passos listam só os que entraram/saíram (`stepChanges`) ou "Ordem dos passos alterada".
- **Clonar:** `POST /api/recipes/[id]/derive` com `{ clone: true }` ⇒ `deriveRecipe({ edits: null })`, cópia fiel (todas as traduções com provenance, nomes por-locale, ingredientes com unidade/nota/FK, restrições). Botão `RecipeCloneButton` ao lado do gatilho do modal em `recipe-detail-actions.tsx`; navega para a cópia.

## 2. Evidência

- Testes: `test/unit/recipe-diff.test.ts` (igualdade semântica, poda, `stepChanges`; o caso "null vs [] distintos" virou "iguais"), `test/ui/recipe-diff-view.test.tsx` (T5–T8), `test/ui/recipe-detail-actions.test.tsx` (Clonar), `test/integration/recipe-derive.test.ts` (clone fiel, gates, 400 ambíguo, salvar sem mexer ⇒ diff vazio, diff legado podado no GET).
- Suíte completa, lint e `tsc` verdes localmente (Postgres 17 na 5433).

## 3. Landmines

- O diff é **congelado no fork**; editar a cópia depois (in-place) não o atualiza. Por isso a seção some quando vazia em vez de dizer "sem alterações".
- `unidade` continua fora do diff.
- Clonar herda a regra do ADR-0022: a cópia nasce **sem imagem**.

## 4. Critério de saída

"checks" verde, painel limpo, e em produção: a cópia que o dono fez sem mudar nada deixa de mostrar "O que mudou"; "Clonar" aparece numa receita do catálogo para quem está logado.
