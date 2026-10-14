# Achado A, 2º passo: ISR do detalhe público, proposta (sem código entregue)

**Data:** 2026-10-14. **Base:** `main` em `14f1f53`. **Branch:** `claude/performance-audit-rj4e07`, sem commits.

## 0. Decisão

**Não entreguei código.** O detalhe público não vira ISR sem mudar o que alguém vê. E as duas partes que dariam para entregar sozinhas (cache de leituras com tag numa página que segue dinâmica) não justificam o risco: o ganho é perto de zero, e cada uma leva junto uma superfície de escritores.

Medi tudo com `next build` + `next start` contra um Postgres local migrado (banco `repro_detail`, cluster `17/perf`, porta 5433), usando dois protótipos descartáveis que já foram revertidos. A árvore de trabalho está limpa.

Os cinco bloqueios estão no §3. Cada um precisa de uma decisão do dono, porque cada solução muda algo que hoje é visível.

## 1. Antes: o que a rota faz hoje (medido)

`/[locale]/recipes/[id]` aparece como `ƒ` na tabela do build. Toda resposta sai com `Cache-Control: private, no-cache, no-store`, e **todo desfecho responde 200**, porque o `loading.tsx` de `[locale]` abre um Suspense e o shell é enviado antes:

| Request (`next start`, `main`) | Status | O que vem no HTML |
|---|---|---|
| slug público, anônimo / dono / outro usuário | 200 | a receita (o dono e o outro recebem bytes idênticos entre si; o anônimo, 43 B a menos) |
| slug privado, anônimo ou outro usuário | 200 | not-found via streaming (`NEXT_HTTP_ERROR_FALLBACK;404`, `noindex`): soft 404 |
| slug privado, dono | 200 | a vista do dono |
| slug inexistente | 200 | soft 404 |
| UUID legado público | **200** | `NEXT_REDIRECT;replace;…;308` no payload: o redirect acontece no client, não é um 308 HTTP |
| Googlebot, slug privado | 200 | soft 404 |
| banco fora | 200 | `error.tsx` via streaming (digest) |

**Achado de passagem (fora do escopo, não mexi):** o ADR-0020 trata o "308" do link legado como permanente para SEO. Hoje ele sai como 200 com redirect no client, e o 404 é soft. As duas coisas vêm do mesmo Suspense do `loading.tsx`.

> **Atualização (2026-10-14):** corrigido a pedido do dono (handoff 71). As rotas de `recipes/` saíram de baixo do `loading.tsx` (grupo `(com-carregamento)`): o UUID legado público responde 308 com `Location`, e o slug privado (para quem não é dono) e o inexistente respondem 404. A tabela acima é o estado da `main` antes da correção.

## 2. Mapa: o que a página e os metadados mostram, e quem escreve cada coisa

| O que aparece | Fonte | Quem escreve |
|---|---|---|
| Espinha (porções, tempos, cozinha, categoria, restrições, origem, proveniência, fonte/atribuição) | `recipe` | `editOwnRecipe`, `deleteOwnRecipe`, `deriveRecipe`, `persistGeneration` (geração, conversa, sessão, regenerar, comparar), `persistImport`, `createCatalogRecipe`, `editCatalogRecipe`, `applyStaleDecision`, `clearSourceAttribution` / `operatorClearSourceAttribution` / takedown / DSAR / expurgo, scripts |
| Gate de leitura pública (visibilidade, `playful`, moderação, curadoria) | `recipe` | `applyVisibilityTransition` (publish/unpublish, `social.ts`, `stale.ts`, `clear-attribution.ts`), `applyModerationRemove`, `keepReport`, `approve`/`reject`/`startEditing`/`unrejectCatalogRecipe`, `deleteOwnRecipe`, `eraseOwnAccount`, `purgeAnonymizedAccounts` |
| Título, descrição, passos, notas, nomes traduzidos, slugs de todos os locales (hreflang, canonical, OG, JSON-LD) | `recipe_translation` | `ensureTranslation` (rota de tradução, `/api/generations`), `retranslateOutdated` (admin), `translations/[locale]/review`, `editTranslatedIngredientNames`, os editores do dono e do Curador, `stale.ts`, `derive`, `persist*`. O slug congela no 1º insert (`freezeSlug`) e não muda na edição. |
| Itens e alérgenos | `recipe_ingredient` + `ingredient.alergenos` | `replaceIngredients`, `resolveItem`, `createIngredient`/`updateIngredient` (o alérgeno do canônico muda a página de **toda** receita que usa aquele canônico), `persist*`, scripts `strip-measure`/`restore-overstrip` |
| Tags | `recipe_tag`/`tag` | `editCatalogRecipe` |
| Imagem (capa, `srcset`, selo de IA, moderação) | `recipe_image` + `recipe.image_id` | upload, geração, seleção, remoção e exclusão da galeria (dono e Curador, 10 funções), `applyImageModeration`, `reapOrphanImage`, **cron `/api/cron/image-derivatives`** (#575: grava `thumb_url`/`detail_url`, então muda o `srcset`) |
| Byline (nome e handle do dono) | `users` | `PATCH /api/me` (nome e handle), **`/api/auth/update-user` do better-auth** (nome), endpoints do plugin admin, `assignNameHandle`, `eraseOwnAccount`, expurgo |
| Avaliações: média, contagem (sobre **todas** as linhas vivas) e lista de 50 com nome, handle e foto do avaliador | `recipe_review` + `users` | `applyReview` (salvar e apagar), `applyReviewModeration`, `applyReviewImageModeration`/`dismissReviewImage`, renomear, trocar o handle ou apagar **qualquer avaliador**, cascata `users → recipe_review`, expurgo; também o gate de pool da receita (as avaliações somem fora do pool) |
| Aviso de catálogo | `app_config` | `PUT /api/admin/config` |
| Rótulo da cozinha (escopo `display`) e `recipeCuisine` (escopo `active`) | `vocabulary_term` | admin de vocabulário, `approveCozinha` (as tags que já existem) |
| **Trilho de semelhantes** (4 cards: título, slug, imagem, autor) | `recipe_embedding` de **todo o catálogo** + o gate de pool + exibição de outras receitas | qualquer escrita de embedding (`embedTranslation` em ~10 caminhos, `recomputeMissingEmbeddings`, `stale.ts`), qualquer mudança de pool, título, imagem ou autor de **qualquer outra** receita |
| `searchParams` | `?original` (idioma do conteúdo, só no ramo do dono) e `?reviewImage=1` (abre o fluxo da foto, só no ramo do dono). O ramo público ignora os dois. | — |
| Sessão | `headers()` só no ramo do dono (slug não público, ou UUID que não redireciona) | — |

No total são ~55 funções escritoras, chamadas de ~40 Route Handlers, 2 crons e do handler do better-auth, mais cascatas de FK e scripts.

## 3. Bloqueios

### B1. O ramo do dono não convive com ISR na mesma rota
Protótipo 1: só `generateStaticParams() { return [] }` na página que já existe. O build marca `●`, e o slug público dá `MISS`, depois `HIT`. Já o slug privado responde **500 `DYNAMIC_SERVER_USAGE`** para todo mundo, **inclusive para o dono**, que perde o acesso à própria receita privada. Para ligar o ISR, o tráfego do dono tem de ir para outra rota.

O que funcionou (protótipo 2): o proxy, sem tocar o banco, só lendo o cookie, reescreve `/{locale}/recipes/<slug>` para uma rota interna ISR **quando não há cookie de sessão do better-auth** (`better-auth.session_token` / `__Secure-…`), o param não tem forma de UUID e não há `original`/`reviewImage`. O resto continua na rota de hoje, sem nenhuma mudança. Resultado medido:
- anônimo: `MISS`, depois `HIT`, com `s-maxage=3600, stale-while-revalidate=…`; com e sem `Cookie: theme=dark` o HTML é **byte a byte o mesmo**;
- o conteúdo visível (texto, links, imagens), o JSON-LD, o canonical, o hreflang e o OG são **iguais aos de `main`** (só muda a porta da URL base) e o `<title>` muda de lugar (vai para o `<head>`);
- dono e outro usuário: rota dinâmica, como hoje, com bytes idênticos entre os dois;
- slug privado anônimo: o soft 404 fica em cache (`HIT`, 200, como hoje); o dono segue vendo a receita privada.

**O que muda para quem vê:**
- quem está logado não ganha cache (cerca de metade do benefício, se o tráfego logado for relevante);
- o esqueleto do `loading.tsx` some do HTML do anônimo;
- ao entrar ou sair da conta sem recarregar a página (`router.refresh`), a árvore troca de rota e a página remonta, perdendo o estado do client (por exemplo, o fator de porções);
- a rota interna fica acessível por URL direta e precisa de bloqueio no proxy;
- é DB-free, mas tira o proxy do "só locale".

### B2. O perfil `'max'` (o obrigatório do pedido) entrega receita despublicada ou moderada
Protótipo 2: receita aquecida, despublicada no banco, tag expirada com `'max'`. **O 1º request anônimo recebe `STALE` com a receita inteira**, e só o 2º recebe o 404. Isso viola a regra 2 ("nunca servir privada/moderada do cache compartilhado"), e vale também para moderação, remoção de imagem ou avaliação, takedown de atribuição, exclusão e conta apagada.

Com `{ expire: 0 }` o 1º request já é `MISS` com o 404: não vaza. Mas com o banco fora a rota responde **500** (medido), onde hoje responde 200 com o `error.tsx` em streaming, e é exatamente o que o pedido proíbe.

Com `'max'` e o banco fora, o resultado foi `STALE`, depois `HIT`, sempre 200 com a página antiga (medido). É o comportamento desejado para edições, nunca para remoções.

**Decisão do dono:** usar dois perfis por escritor, `{ expire: 0 }` para remoção e `'max'` para edição, aceitando 500 em vez de 200-com-erro numa queda do banco logo depois de uma remoção. Ou não fazer ISR.

### B3. O 404 em cache não tem tag de receita
Protótipo 2: receita despublicada, depois o 404 aquecido, republicada, tag `receita:<id>` expirada. **Continua o 404 em `HIT`**, porque o render do 404 nunca soube o id. O anônimo não vê a receita republicada por ≥1 h (e, com stale-while-revalidate, sem teto real com pouco tráfego).

A correção é uma tag por `(locale, slug)` no 404, expirada por todo escritor que torna uma receita pública: publish, aprovação da curadoria, `unreject`, `keepReport`, tradução nova, que cria um slug novo. O slug é estável (`freezeSlug`), o que ajuda, mas a superfície cresce.

### B4. A superfície de invalidação é grande e acoplada ao catálogo todo
- ~55 escritores (§2), incluindo três que o app não controla diretamente:
  - o `/update-user` e o plugin admin do better-auth: daria para cobrir com `databaseHooks.user.update/delete`;
  - as cascatas de FK (`users → recipe_review`);
  - os scripts.
- **O trilho de semelhantes** depende do embedding e do pool de **todas** as receitas. Uma receita nova pública, ou um embedding recalculado, pode entrar no top-4 de qualquer outra página, e não dá para saber quais sem recalcular todas. Isso exige uma tag global de detalhe, expirada por praticamente todo escritor de receita, tradução, imagem, embedding ou usuário. Com remoção em `{ expire: 0 }` (B2), cada remoção derruba a cópia velha de **todas** as páginas de detalhe.
- Renomear, trocar o handle ou apagar um avaliador muda páginas de receitas alheias. A contagem pega avaliadores fora da lista de 50, então a tag tem de vir do lado do escritor, por consulta (receitas que a pessoa avaliou ou possui).
- Escritor esquecido = conteúdo velho para o anônimo, e numa remoção isso é vazamento. Hoje esse risco não existe.

### B5. Status HTTP e degradação
- ISR só dá 200, igual a hoje, nos dois casos que medi (página e soft 404).
- O que muda é a regeneração bloqueante sem cópia (rota fria, deploy novo, `{ expire: 0 }`) com o banco fora: **500**, onde hoje é 200 com o `error.tsx`.

## 4. O que dá para fazer, por ordem de valor/risco

1. **Nada agora (recomendado).** Com ~239 receitas a rota custa ~5 idas e voltas ao Neon por visita. O ganho do ISR é a CDN, e o custo é B1 a B4.
2. **ISR só para anônimos**, se o dono decidir B1, B2 e B5. Desenho validado nos protótipos:
   - rewrite no proxy pelo cookie;
   - rota interna `●` com `generateStaticParams() → []`;
   - tags `refogando:receita:<id>` (página da receita e páginas cujo trilho mostra a receita) e `refogando:receita-slug:<locale>:<slug>` (o 404), mais uma global `refogando:receita-detalhe` (entrada no trilho, embeddings), todas registradas em `cache-tags.ts`;
   - um helper `expireRecipeDetail({ ids, slugs, global, removal })` (`removal` ⇒ `{ expire: 0 }`), chamado depois da escrita;
   - `databaseHooks.user.update/delete` para o better-auth;
   - um teste de integração por escritor, mais um teste "arquitetural" que procura `.insert/.update/.delete` nas tabelas de conteúdo e exige o helper (ou uma justificativa numa allowlist), para os escritores futuros não esquecerem.

   Tamanho estimado: ~60 arquivos tocados e ~60 casos de teste. Mesmo assim fica de fora a escrita feita fora do app (scripts, SQL à mão), que só a revalidação por tempo alcança.
3. **Barato e sem cache, se o objetivo for latência:** juntar o gate e a espinha numa query em `loadPublicRecipeBySlug`, e tirar a releitura do gate em `loadRecipeReviews` quando a linha já foi carregada. Corta ~2 idas e voltas seriais por visita, com saída idêntica e nenhuma invalidação. É escopo novo e pede aprovação.
4. **Não recomendo:** cache com tag das leituras pequenas (config do aviso, conjunto ativo de cozinhas) na página dinâmica. Elas rodam em paralelo com o resto (ganho de latência ~0), e com `'max'` numa página dinâmica quem salvou veria o valor antigo uma vez.

## 5. Decisões pedidas ao dono

1. Vale ISR só para anônimos, com logados seguindo dinâmicos (B1)?
2. Aceita `{ expire: 0 }` nas remoções (sem vazamento, 500 numa queda do banco logo depois) no lugar do `'max'` obrigatório (B2/B5)?
3. Aceita a tag global no trilho de semelhantes (toda escrita de receita expira todas as páginas de detalhe)? Ou prefere uma janela de frescor só no trilho, declarada?
4. Abre issue para o 308 legado e o soft 404 que saem como 200 (§1)? **Decidido: corrigir já** (handoff 71).

## 6. Reprodução

- **Banco:** `create database repro_detail` e `drizzle-kit migrate` com `DATABASE_URL`/`DATABASE_URL_UNPOOLED` inline. Seed em `scratchpad/seed.sql`: 2 públicas do dono (uma com imagem, derivados, en-US e avaliação), 1 privada, 1 de catálogo aprovada, embeddings parecidos.
- **Build e servidor:** `DATABASE_URL=… BETTER_AUTH_SECRET=dummy_ci_build_secret_0123456789_abcdef npx next build`, depois `next start` com `APP_URL`/`BETTER_AUTH_URL`. Usuários criados por `/api/auth/sign-up/email`.
- **Banco fora:** `ALTER DATABASE repro_detail ALLOW_CONNECTIONS false` + `pg_terminate_backend` (o método do handoff 67).
- **Evidência bruta:** `scratchpad/evid/` (headers e HTML de cada request, tabelas de rotas `build-before.txt`, `build-proto1.txt`, `build-proto2.txt`). O `.next` de `main` está em `scratchpad/next-before`.
