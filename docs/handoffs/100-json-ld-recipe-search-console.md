# Handoff 100 — JSON-LD Recipe e os avisos do Search Console

**Data:** 2026-11-13.
**Base:** `9fdcde3` (main depois do #655).
**Migração:** nenhuma.
**ADR:** ADR-0060 (novo).
**Política:** sem mudança (nenhum dado pessoal novo; o nome do autor humano já ia no JSON-LD).

## 1. Escopo

Primeiro de dois PRs da thread "Corrigir indexação e dados estruturados no Google". Este cobre os e-mails de
"Recipes structured data issues"; o segundo cobre "New reasons preventing your pages from being indexed".

- `src/domain/recipe-seo.ts`: `buildRecipeJsonLd` devolve `null` sem foto; `author: Organization` no catálogo;
  `keywords` das tags; `HowToStep.url` com âncora; `recipeStepAnchorId`.
- `src/server/recipe/seo.ts`: rótulos de cozinha/categoria, tags e `editorialCatalog` no input.
- `src/app/[locale]/recipes/[id]/page.tsx`: só emite o `<script>` quando há JSON-LD; passa o vocabulário e
  `stepAnchors`.
- `src/components/recipe/recipe-detail-view.tsx`: prop `stepAnchors` ⇒ `id="passo-N"` nos passos.

## 2. O que ler primeiro

1. ADR-0060.
2. `buildRecipeJsonLd` e o teste `test/domain/recipe-seo.test.ts` (bloco "correções do Search Console").

## 3. Depois do merge

- Conferir no ar (`curl` + extrair o `application/ld+json`): carbonara pt/en sem JSON-LD; ramen com
  `author.@type = Organization`, `recipeCuisine = "Japonesa"`/`"Japanese"` e `HowToStep.url` com `#passo-1`.
- No Search Console, Fernando pode pedir "Validar correção" em Melhorias > Receitas. Os avisos de `name`,
  `prepTime`/`cookTime`, `aggregateRating` e `video` ficam (ADR-0060 dec. 6).
- Para a carbonara voltar ao resultado de receita: gerar ou enviar uma foto dela.

## 4. Princípios inegociáveis

- Nada inventado no markup: sem foto, sem `image`; sem tag, sem `keywords`; sem autor conhecido, sem `author`.
- O número do `aggregateRating` continua a média crua visível na página.

## 5. Landmines

- O id `passo-N` é contrato com o JSON-LD já indexado. Não renomear.
- Não ligar `stepAnchors` em lugar com duas `RecipeDetailView` na mesma página.
- `editorialCatalog` usa `ownerId === null` estrito: fixture sem `ownerId` (undefined) não vira catálogo.
