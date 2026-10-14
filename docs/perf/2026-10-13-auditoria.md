# Auditoria de performance do Refogando (2026-10-13)

Base: `main` em 6b06b5c. Medidas de bundle tiradas de um `next build` de produção (Next 16.2.9, Turbopack). O resto vem da leitura do código, com `arquivo:linha`.

## 1. Reconhecimento

- **Stack:** Next.js 16 App Router + React 19 (Vercel), Drizzle ORM sobre postgres.js no Neon (pooler, `prepare:false`), better-auth 1.6 (sessão sem cookieCache, rate limit em tabela), Anthropic SDK, embeddings Gemini, Vercel Blob, Tailwind 4, radix-ui, lucide-react, zod 4.
- **Entradas:** `src/proxy.ts` (só locale, sem DB), root layout `src/app/[locale]/layout.tsx` (2 leituras de DB por request + 5 providers client), ~110 route handlers em `src/app/api`, 3 crons em `vercel.json`.
- **Config:** `next.config.ts` só tem headers de segurança e `remotePatterns`; minificação e tree-shaking são o default do Next (ok). `tsconfig` ok. Não há Webpack/Vite/estado global para auditar.
- **Pontos fortes já existentes:** pool do DB e instância do better-auth são singletons; o proxy não toca o banco; vocabulário tem cache de 30 s; o detalhe da receita já deduplica metadata e render com `cache()`; a home já carrega feed, receita da semana e config em paralelo.

## 2. Top 5 (o que mais custa)

### 2.1 `get-session` paga 3 queries de rate limit (uma delas é escrita) a cada chamada
- `src/lib/auth.ts:267` usa `rateLimit.storage: 'database'` sem regra para `/get-session`. O better-auth faz `findMany` antes e `findMany` + `insert/update` depois de cada request em `/api/auth/*`.
- `src/components/auth-slot.tsx:46-84` chama `get-session` na montagem, a cada navegação e 2× ao voltar para a aba. Visitante anônimo também (escreve uma linha em `rate_limit` por IP).
- **Custo:** ~3 round trips seriais + 1 escrita por navegação de qualquer pessoa. É a maior carga de escrita do banco.
- **Correção proposta (decisão sua):** `'/get-session': false` em `customRules`. Sessão idêntica; o que muda é que `get-session` deixa de ter teto de 100/60 s por IP (é leitura, sem senha). **Não está no PR** por mexer numa regra de segurança (#449).

### 2.2 Bundle: zod inteiro e os dois dicionários vão para toda página
- Os 20 chunks compartilhados somam **369 KB gzip**. Dois itens evitáveis:
  - **zod 4 completo (65 KB gz):** `src/domain/restricoes-perfil.ts:23` cria um schema no topo do módulo; o `RestricoesPerfilProvider` do root layout importa o módulo e arrasta o zod para todas as rotas, embora só use os helpers sem zod.
  - **pt-BR + en-US (61 KB gz):** `src/i18n/provider.tsx` importa `MESSAGES` dos dois idiomas; cada página só usa um.
- **Correção do zod (no PR):** a validação com zod passa para um módulo só do servidor (`restricoes-perfil-parse.ts`, `menu-suggestion-limits.ts`). Medido: nenhum chunk client tem zod.
- **Dicionários (fora do PR, proposta):** testei wrappers client por idioma e o Next carrega todos os client components do layout, então os dois chunks seguem indo. Passar o catálogo por prop troca JS cacheável por ~30 KB gzip no HTML de cada carga completa, um trade-off que não é claramente ganho. O caminho melhor é tirar do catálogo client as seções usadas só por páginas server (`admin`, `privacidade`, `seusDireitos`, `guia`: ~41 KB de JSON por idioma).

### 2.3 Cada tecla na busca da home renderiza a home de novo no servidor
- `src/components/recipe/search-experience.tsx:483-500` reflete o termo na URL com `router.replace` a cada tecla, sem debounce. A home é dinâmica, então cada tecla é um request RSC que roda `generateMetadata`, feed, receita da semana e config (3+ queries) e devolve o feed inteiro.
- Digitar "frango" = 6 renders da home, além da busca com debounce.
- **Correção (no PR):** `window.history.replaceState` (o Next sincroniza `useSearchParams`/`usePathname` com ele). A URL muda igual, sem ida ao servidor.

### 2.4 Índices faltando em caminhos quentes e em cascatas
- **better-auth:** `account` não tem índice nenhum (login e Google buscam por `user_id` e `provider_id+account_id`); `verification` não tem índice em `identifier` nem em `expires_at` (todo `findVerificationValue` faz `DELETE WHERE expires_at < now()`); `session.user_id` sem índice (reset de senha revoga sessões, purge).
- **Feed:** `src/server/recipe/feed.ts:54-77` ordena todo o pool por `(created_at, id)` a cada página; o próprio comentário diz "índice deferido".
- **Busca por ingrediente canônico:** `recipe_ingredient.ingredient_id` sem índice (`search.ts:648`).
- **Cascatas sem índice na FK:** `notification.recipe_id/review_id`, `creation_session.recipe_id`, `recipe.parent_recipe_id`, `shopping_list_item.source_recipe_id`; e as FKs para `users` que o purge diário varre por usuário (`recipe.moderated_by/reviewed_by`, `report.reporter_id`, …).
- **Correção (no PR):** uma migração só com `CREATE INDEX` (0075). Índices parciais `IS NOT NULL` nas colunas esparsas.

### 2.5 Leituras repetidas e cascatas seriais (waterfalls)
- `app_config` é lido 2–4× por request (layout + home + receita da semana + popularidade), sem dedupe (`src/server/app-config.ts:106`).
- Detalhe da receita: ~9 round trips seriais onde ~4 bastam (`recipes/[id]/page.tsx:189-220`; `loadRecipeReviews` também é serial).
- `/api/search` espera o embedding (HTTP externo) antes de começar a sessão; popularidade e média global em série em `search.ts:401` e `recommended-cooks.ts:95`; notificações (página + contagem) em série.
- **Correção (no PR):** `cache()` por request no `app_config`; `Promise.all` onde não há dependência.

## 3. Achados estruturais (propostas, fora do PR)

| # | Achado | Por que não entrou |
|---|---|---|
| A | Nenhuma página é cacheada: o root layout lê `cookies()` (tema) e o DB, então até `/privacidade` e o detalhe público renderizam a cada hit. | **Parcial** (handoff 67): tema por script pré-pintura (o layout não lê mais `cookies()`) e as leituras do layout no Data Cache com as tags `refogando:vocab:cozinha` e `refogando:app-config`, expiradas pelos escritores (perfil `'max'`). `/privacidade`, `/seus-direitos`, `/guia`, `/plano`, `/following`, `/forgot-password` e os redirects `/conversation` e `/recipes` viram ISR de 1 h (§5). **Pendente:** ISR do detalhe público; a home (lê `searchParams` no `generateMetadata`); `/cooks` e `/create`, mantidas dinâmicas de propósito (§5). |
| B | "Receitas semelhantes" e a busca semântica calculam a distância contra **todos** os embeddings (o `DISTINCT ON` impede o índice HNSW). Cresce linear com o catálogo, em toda visita a uma receita. | Um top-k via HNSW é aproximado: os resultados podem mudar. |
| C | Full-text e trigram da busca não usam os índices GIN (`recipe_ts_config(rt.locale)` por linha; `similarity() >= 0.3` em OR). O ramo de ingrediente faz `to_tsvector` de cada linha a cada busca. | **Parcial** (handoff 66): títulos e trigrama usam os GIN, sem migração e com resultado idêntico (§4); de quebra, `%`/`_`/`\` digitados deixaram de ser curinga no ILIKE. **Pendente:** o ingrediente cru (coluna `tsvector` em `recipe_ingredient`), na migração do E. |
| D | Perfil público e a receita do dono chamam a própria API por HTTPS (`fetch(getBaseUrl()/api/...)`): duas invocações por visita. | **Resolvido** no PR seguinte (handoff 65): loaders compartilhados, sem self-fetch. |
| E | Pantry matches normaliza todo o corpus de ingredientes a cada request (`pantry.ts:350`). | Precisa de colunas geradas (migração de schema). |
| F | Popularidade (receita da semana, cozinheiros recomendados, `sort=popularidade`) agrega `recipe_save`/`recipe_review` inteiras a cada request. | **Resolvido** (handoff 66): o vencedor da receita da semana fica 10 min em cache, invalidado ao salvar a config (§4). `sort=popularidade` e cozinheiros recomendados seguem ao vivo, como combinado. |
| G | Gaveta "Criar" (~340 KB de fonte) entra no header de toda página. | `next/dynamic` introduz o primeiro lazy chunk; o `AppUpdateGuard` pede revisão quando isso acontecer. |
| H | Listas sem LIMIT (`/api/me/recipes`, perfil, salvos) e trazendo `passos`/`descricao` que só viram título. | As colunas pesadas saíram no PR seguinte (handoff 65). Paginar muda o que a tela mostra: adiado. |
| I | Imagens do feed em tamanho cheio (PNG do Gemini) para thumbs de 144 px. | Reencodar (WebP) ou `next/image` muda o pipeline de imagem. |
| J | Foco + `visibilitychange` disparam 2 `get-session` e 2 `/api/notifications` ao voltar para a aba (mais 2 `get-session` do próprio client do better-auth). | **Resolvido** junto com o item 1: um refetch de cada por volta à aba. O ADR-0028 não pedia a chamada dupla (o "intencional" estava no código). |

## 4. Achados C (parcial) e F: medidas (handoff 66)

Banco local (PG 17.11, pg_trgm 1.6) com 8.000 receitas de catálogo, 12.200 traduções (pt-BR, en-US e 200 es-ES) e 40.000 itens de ingrediente. `EXPLAIN (ANALYZE, BUFFERS)` da query inteira da Busca, `requestLocale=pt-BR`, sem vetor:

| Nó | Antes | Depois |
|---|---|---|
| `matched` (full-text do título) | Seq Scan, `Filter: search_vector @@ websearch_to_tsquery(recipe_ts_config(locale), ...)`, ~31–33 ms | Dois braços, cada um `Bitmap Index Scan on recipe_translation_search_vector_gin` + `Filter: recipe_ts_config(locale) = <config>`, ~0,1–3,8 ms |
| `trgm_matched` (trigrama do título) | Seq Scan, `Filter: ILIKE ... OR similarity(...) >= 0.3`, ~72–93 ms | `BitmapOr` de dois `Bitmap Index Scan on recipe_translation_titulo_trgm_gin` (ILIKE e `%`), ~0,7–1,9 ms |
| `ingredient_raw_hit` | `to_tsvector` por linha, ~290 ms | igual (pendente: migração do E) |

Query inteira: 410–500 ms antes, 304–332 ms depois (o que sobra é o ingrediente cru). Em produção (~500 traduções) os dois Seq Scans somam poucos ms; o ganho cresce linear com o catálogo.

**Equivalência.** (a) `test/integration/search-index-equivalence.test.ts` roda o predicado antigo (copiado literal) e o novo sobre o mesmo corpus (pt-BR, en-US, es-ES, en-GB, `pt`) e compara ids e `ts_rank` exatos, e prova que o `%` é `>=` (com o GUC fixado exatamente na similaridade float4 de um par, 0,3f, o par casa; logo acima, não). (b) No banco local, a Busca antiga e a nova devolveram respostas idênticas (ids, seções e ordem) em 152 buscas (38 termos, pt/en, `any`/`all`, typos, multi-termo, operadores do websearch).

**Piso do trigrama.** O `%` lê `pg_trgm.similarity_threshold`. A Busca fixa o GUC em `TRGM_MIN_SIM` com `set_config(..., true)` numa transação (local, não vaza no pooler). Custo contado no fio com um proxy TCP e o cliente em `prepare:false`: 2 idas e voltas a mais (BEGIN e COMMIT), só quando há termo de 3+ caracteres. O `set_config` vai como query simples no mesmo envio que a query principal (`Promise.all` na conexão reservada da transação: o postgres.js escreve os dois em ordem e o servidor aplica o GUC antes de ler a query principal), então não soma ida e volta. Com RTT de 10 ms simulado (mediana de 15 buscas, três rodadas): 420–445 ms antes, 385–400 ms depois no banco de 8.000 receitas. Num catálogo do tamanho do de hoje o saldo fica perto de zero (alguns ms de RTT contra alguns ms de Seq Scan); a rota já espera o embedding antes da query.

**Receita da semana (F).** Só o id do vencedor por Popularidade (e o instante do cálculo) vai para o Data Cache (`unstable_cache`, 10 min, tag `receita-da-semana:popularidade`), uma entrada para todos: o vencedor não depende de quem vê nem do idioma. É um desvio consciente do "por idioma" de `2026-10-13-respostas.md`: por idioma, o mesmo id ficaria guardado várias vezes. O `revalidate` sozinho não limita a idade (o Next serve a entrada vencida e recalcula em segundo plano, então com pouco tráfego o vencedor teria a idade do intervalo entre visitas); a leitura compara o instante do cálculo com os 10 min e, vencida, calcula ao vivo. Um vencedor novo, inclusive a primeira receita de um catálogo vazio, aparece em até 10 min. A linha exibida é relida por PK com o mesmo gate a cada request, então remoção pela moderação, exclusão ou saída de `approved` valem na hora, sem invalidar tag nessas escritas. `PUT /api/admin/config` expira a tag (`{ expire: 0 }`) ao gravar `recipeOfWeek` ou `popularity`. Num acerto de cache o slot custa a leitura da config (já deduplicada no render) e uma busca por PK, em vez da média global e do agregado sobre `recipe_save`/`recipe_review`.

## 5. Achado A (parcial): o que virou estático (handoff 67)

`next build` (Next 16.2.9) contra um Postgres local migrado, antes e depois. Sem `DATABASE_URL` (o build da CI) tudo segue dinâmico, como antes: a leitura do layout falha e o `connection()` da degradação marca a rota como dinâmica.

| Rota | Antes | Depois | Por quê |
|---|---|---|---|
| `/[locale]/privacidade`, `/seus-direitos`, `/guia`, `/plano` | ƒ | ● ISR 1 h | Só leem `params`; o único bloqueio era o layout. |
| `/[locale]/following`, `/forgot-password` | ƒ | ● ISR 1 h | Idem: casca server sem leitura do request; os dados vêm do client. |
| `/[locale]/conversation`, `/recipes` | ƒ | ● ISR 1 h | Só `redirect()`/`permanentRedirect()`; a resposta (200 com o redirect no HTML, igual a antes) fica em cache. |
| `/[locale]/create` | ƒ | ƒ (de propósito) | Estática, o `useSearchParams` do `CreateShellClient` cairia no fallback do `<Suspense>` no servidor (bailout para o client). `connection()` na página. |
| `/[locale]/cooks` | ƒ | ƒ (de propósito) | Lê do banco a semente de cozinheiros; como ISR ela teria 1 h ou mais de idade (stale-while-revalidate) e a degradação para lista vazia ficaria em cache. `connection()` na página. Decisão à parte. |
| `/[locale]` (home) | ƒ | ƒ | `generateMetadata` lê `searchParams` (gate de índice). |
| `/[locale]/recipes/[id]` | ƒ | ƒ | Lê `searchParams` e `headers()` (ramo do dono). ISR por slug é o próximo passo. |
| `/[locale]/u/[handle]`, `/me/*` | ƒ | ƒ | Leem `cookies()`/`headers()` (`resolvePageLocale`, sessão). |
| `/[locale]/sign-in`, `/sign-up`, `/reset-password`, `/verify-email` | ƒ | ƒ | Leem `searchParams`. |
| `/[locale]/admin/*` | ƒ | ƒ | Sessão por `headers()` (`admin/gate.tsx`). |
| `/[locale]/conversation/[id]` | ƒ | ƒ | Segmento `[id]` sem `generateStaticParams` (só redireciona). |

Com `next start`: `/pt-BR/privacidade` responde `x-nextjs-cache: HIT` e `Cache-Control: s-maxage=3600, stale-while-revalidate=31532400`; com e sem `Cookie: theme=dark` o HTML é byte a byte o mesmo, e o script do `<head>` (minificado no build) põe `dark` só com o cookie. O HTML de cada página, sem os scripts, é o de antes, exceto a classe do `<html>` (agora `light` sempre, trocada pelo script), o próprio script e o segundo ícone do ThemeToggle (lua e sol no HTML, um escondido por CSS).

**Degradação não vai para o cache.** Simulado com o banco recusando conexões e `revalidate` de 5 s num build de teste: com uma entrada vencida no Data Cache, o `unstable_cache` a devolve quando o recálculo falha (a página regenera com o valor antigo); sem entrada nenhuma, a leitura falha, o `connection()` aborta a regeneração em segundo plano e o Next segue servindo o HTML anterior. Sem o `connection()`, a página degradada (sem cozinhas e sem links sociais) ficou em cache como `HIT` mesmo depois de o banco voltar.

**Expirar a tag com `{ expire: 0 }` derrubava as páginas ISR (corrigido: perfil `'max'`).** A primeira versão expirava as tags do layout na hora. Isso tira a cópia velha da página: o próximo request regenera bloqueando e, se o banco falhar nesse intervalo, a leitura não tem entrada para devolver, o `connection()` aborta e o Next responde 500 ("Page changed from static to dynamic", digest `DYNAMIC_SERVER_USAGE`) em todo request até o banco voltar. Reproduzido com `next build` + `next start` contra um Postgres local, numa cópia com uma rota descartável que expira as duas tags, e o banco tirado do ar (`ALTER DATABASE … ALLOW_CONNECTIONS false` + `pg_terminate_backend`):

| `/pt-BR/privacidade` | `{ expire: 0 }` (antes) | `'max'` (agora) |
|---|---|---|
| aquecida | 200 `HIT` | 200 `HIT` |
| expira as tags, banco fora: 1º request | **500** | 200 `STALE` (HTML antigo) |
| 2º e 3º requests, banco fora | **500**, **500** | 200 `HIT` (regenerada com o valor antigo do `unstable_cache`) |
| banco de volta | 200 `MISS`, depois `HIT` | 200 `HIT` |

Com o banco no ar, `'max'` entrega o valor novo um request depois do save: um rótulo de cozinha trocado no banco + expiração ⇒ 1º request `STALE` com o rótulo antigo, 2º `HIT` com o novo. A tag da receita da semana segue `{ expire: 0 }`: só a home (dinâmica) a lê. Tags e perfis em `src/server/cache-tags.ts`; tabela de rotas do build idêntica antes e depois da correção.

**Frescor de escrita fora do app.** A revalidação de 1 h também é stale-while-revalidate: o valor novo aparece na primeira regeneração depois de ≥1 h (o request que acha a página vencida ainda leva a antiga), ou um request depois de qualquer save no admin que expire a tag.

**O script do tema fica fora do bundle do client.** `applyThemeFromCookie`/`THEME_INIT_SCRIPT` moraram em `src/lib/theme.ts`, que o ThemeToggle (client) importa: a função ia para `.next/static`. Agora vivem em `src/lib/theme-script.ts`, importado só pelo layout; `grep -rl 'cookie.split' .next/static` não acha nada (antes: um chunk).

**`Vary: Accept-Language`.** O proxy põe o header também nos caminhos já prefixados, mas no `next start` o `Vary` do próprio Next (`rsc, next-router-state-tree, …`) substitui o do proxy nas respostas de página; só o 302 da raiz o mantém. O conteúdo dos caminhos prefixados não depende do `Accept-Language` (`resolvePageLocale` usa o locale da URL quando ele é válido, e o proxy garante isso). Não mexi: o efeito na CDN da Vercel precisa ser conferido num deploy (headers de `/pt-BR/privacidade` em produção).

