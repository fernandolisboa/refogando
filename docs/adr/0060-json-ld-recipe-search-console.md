# ADR-0060 — JSON-LD Recipe: sem foto, sem markup; autor do catálogo, keywords, âncora dos passos e rótulos

Status: aceito (2026-11-13)

Relaciona: ADR-0020 (dec. 7, campos do JSON-LD), ADR-0023 (dec. 4, só `totalTime`), ADR-0027 (dec. 6,
`aggregateRating`), ADR-0011 (catálogo sem dono). Emenda o builder `buildRecipeJsonLd` (`src/domain/recipe-seo.ts`).

## Contexto

O Search Console mandou três e-mails de "Recipes structured data issues" para `refogando.com` (novembro de 2026):

- **crítico:** `image` ausente (3 itens). No ar, a carbonara (pt e en) não tem foto, e o JSON-LD saía sem `image`.
  Sem `image` o item é inválido para o resultado de receita;
- **não críticos:** `author` (receitas do catálogo, que não têm dono), `keywords`, `name` e `url` em
  `recipeInstructions`, `prepTime`/`cookTime`, `aggregateRating`, `video`.

Também conferido no HTML público: `recipeCuisine` e `recipeCategory` saíam com o token cru (`japonesa`,
`prato_principal`), inclusive na página em inglês, quando a página mostra "Japonesa"/"Japanese" e "Prato principal".

A documentação do Google (Recipe, lida em 2026-11-13): `image` é "Image of the completed dish"; `author` aceita Person
ou Organization; `keywords` não deve repetir `recipeCategory`/`recipeCuisine`; `totalTime` sozinho é aceito
("Use totalTime or a combination of both cookTime and prepTime"); `HowToStep.name` é uma frase que resume o passo
e não pode ser "Step 1"; `HowToStep.url` é o link direto para o passo, por exemplo uma âncora.

## Decisão

1. **Sem foto visível, sem JSON-LD Recipe.** `buildRecipeJsonLd` devolve `null` quando não há `imageUrl` (ausente ou
   moderada) e a página não emite o `<script>`. Rejeitado: usar o card de marca como `image`. Ele não é o prato e
   viraria structured data enganoso. A página continua indexável e o OG continua com o card de marca. Quando a
   receita ganha foto, o markup volta sozinho.
2. **Catálogo assina como a marca.** Receita sem dono (`owner_id IS NULL`) e não importada ⇒ `author:
   Organization` com o nome da marca. Importada da web segue só com `isBasedOn`: não sabemos quem escreveu o
   original. Comunidade sem autor visível fica sem autor. É a primeira implementação do "`author` (editorial p/
   `catalog`)" que o ADR-0020 dec. 7 já previa; a condição é `owner_id IS NULL` **e** `origin = 'catalog'`, as
   mesmas das travas do Curador.
3. **`keywords` = tags visíveis** (`recipe_tag`, os chips "Tags" do detalhe), sem as que repetem a cozinha ou a
   categoria, rótulo ou token cru (as tags não são traduzidas; comparação sem acento, caixa e `_`), sem
   duplicatas e sem vírgula dentro da tag (separador do campo). Sem tags ⇒ sem `keywords`. Nada é gerado
   para preencher o campo.
4. **`HowToStep.url` = âncora do passo.** O detalhe público dá a cada `<li>` do modo de preparo o id `passo-N`
   (`recipeStepAnchorId`, fonte única) e o JSON-LD aponta `url` para `<canonical>#passo-N`. Só a página de detalhe
   liga as âncoras (`stepAnchors`); a região "gerar 2" mostra duas vistas e repetiria ids.
   `HowToStep.name` continua de fora: não temos um resumo honesto do passo, e "Passo 1" é vetado pelo Google.
5. **`recipeCuisine`/`recipeCategory` levam o rótulo exibido** no locale da página: cozinha pelo vocabulário
   `display` já carregado no detalhe, categoria pelo `categoriaLabel` do i18n. A contenção do #319 continua:
   cozinha fora do conjunto ativo não entra.
6. **Continuam como estão, de propósito:**
   - `prepTime`/`cookTime`: ADR-0023 dec. 4. Não modelamos a divisão preparo × cozimento, e `totalTime` sozinho é
     aceito. Receita sem tempo total fica sem tempo nenhum;
   - `aggregateRating`: só com avaliações reais (ADR-0027 dec. 6). O aviso some quando a receita recebe avaliação;
   - `video`: não temos vídeo.

## Consequências

- Os avisos de `image`, `author`, `url` e `keywords` (este, só onde houver tag) somem na próxima leitura do Google.
  Os de `name`, `prepTime`/`cookTime`, `aggregateRating` e `video` continuam como informativos.
- Receita pública sem foto não aparece como resultado de receita até ganhar foto. Ela já não aparecia, porque o item
  era inválido.
- Mudar o id das âncoras quebra os links do JSON-LD já lidos pelo Google até a próxima leitura; manter `passo-N`.
