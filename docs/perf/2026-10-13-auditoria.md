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
| C | Full-text e trigram da busca não usam os índices GIN (`recipe_ts_config(rt.locale)` por linha; `similarity() >= 0.3` em OR). O ramo de ingrediente faz `to_tsvector` de cada linha a cada busca. | **Resolvido.** Títulos e trigrama (handoff 66): GIN sem migração, resultado idêntico (§4); de quebra, `%`/`_`/`\` digitados deixaram de ser curinga no ILIKE. Ingrediente cru (handoff 68, migração 0076): uma coluna `tsvector` gerada por config em `recipe_ingredient`, com GIN, e um braço por config na Busca; resultado idêntico (§6). |
| D | Perfil público e a receita do dono chamam a própria API por HTTPS (`fetch(getBaseUrl()/api/...)`): duas invocações por visita. | **Resolvido** no PR seguinte (handoff 65): loaders compartilhados, sem self-fetch. |
| E | Pantry matches normaliza todo o corpus de ingredientes a cada request (`pantry.ts:350`). | **Resolvido** (handoff 68, migração 0076): `recipe_ingredient.raw_text_norm` e `ingredient_translation.nome_norm` gerados com a mesma normalização; resposta idêntica (§6). Seguem calculados na consulta, de propósito: o nome traduzido (jsonb de `recipe_translation`) e os aliases do canônico. Sem pré-filtro por palavras (§6). |
| F | Popularidade (receita da semana, cozinheiros recomendados, `sort=popularidade`) agrega `recipe_save`/`recipe_review` inteiras a cada request. | **Resolvido** (handoff 66): o vencedor da receita da semana fica 10 min em cache, invalidado ao salvar a config (§4). `sort=popularidade` e cozinheiros recomendados seguem ao vivo, como combinado. |
| G | Gaveta "Criar" (~340 KB de fonte) entra no header de toda página. | `next/dynamic` introduz o primeiro lazy chunk; o `AppUpdateGuard` pede revisão quando isso acontecer. |
| H | Listas sem LIMIT (`/api/me/recipes`, perfil, salvos) e trazendo `passos`/`descricao` que só viram título. | As colunas pesadas saíram no PR seguinte (handoff 65). Paginar muda o que a tela mostra: adiado. |
| I | Imagens do feed em tamanho cheio (PNG do Gemini) para thumbs de 144 px. | **Resolvido** (handoff 69, migração 0077): todo caminho que cria uma `recipe_image` gera dois derivados WebP com sharp (`detail_url` ~1280 px, `thumb_url` ~400 px) ao lado do original, que não muda; a `<img>` ganha `srcset`/`sizes` e cai no original sem derivados. As imagens antigas entram em lotes pelo cron `/api/cron/image-derivatives`. Card: 1,56 MB → 20 KB (§7). |
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

## 6. Achados C (ingrediente) e E: migração 0076 (handoff 68)

Banco local (PG 17.11): a base do §4 (8.000 receitas de catálogo, 12.200 traduções) com os Itens trocados por textos realistas (frases com medida, acento, pontuação, largura total, NULL e vazio), 10 Itens por Receita (80.000), 60 canônicos (120 traduções), nomes traduzidos en-US em 3.200 traduções e uma Despensa de 200 itens; mais 60 Receitas de um dono (privadas, públicas, uma `playful`, três removidas). `EXPLAIN (ANALYZE, BUFFERS)` da query inteira, três execuções.

**O que mudou.** `recipe_ingredient` ganhou `raw_text_tsv_portuguese` e `raw_text_tsv_english` (`to_tsvector('<config>', immutable_unaccent(raw_text))`, gerados STORED, um GIN em cada) e `raw_text_norm` (a normalização da Despensa, gerada); `ingredient_translation` ganhou `nome_norm`. A Busca escolhe o braço pela config da Receita (`recipe_ts_config(original_locale) = '<config>'`, como o título) e casa o tsquery na coluna da mesma config. A 0076 também cria a estatística `recipe_original_locale_ts_config_stx` sobre `recipe_ts_config(original_locale)` e roda `ANALYZE`: sem ela o planner estima 0,5% das Receitas por config e, com muitos termos, larga o GIN.

**Busca** (`requestLocale=pt-BR`, sem vetor; "antes" é a query de `main` no mesmo banco):

| `?q=` | Antes | Depois |
|---|---|---|
| `frango, cebola roxa` | 1,47–2,19 s; `ingredient_raw_hit` ~1,62 s (Hash Join com `Join Filter: to_tsvector(recipe_ts_config(r2.original_locale), …) @@ …`, 155.632 linhas descartadas pelo filtro) | 42–56 ms; `ingredient_raw_hit` ~15 ms (por braço, `Bitmap Index Scan on recipe_ingredient_raw_text_tsv_<config>_gin` parametrizado por termo, `loops=2`, ~0,15 ms cada, e `recipe` pela PK) |
| `ovos` | 0,66–0,90 s | 32–41 ms |
| `sal` (termo comum) | 0,76–0,87 s | 57–67 ms |
| `-farinha` (só negação) | 0,89–1,0 s | 0,71–0,82 s (tsquery só com NOT varre o GIN inteiro: casa quase toda linha) |
| 16 termos (o teto, `MAX_TERMS`) | 12,5–13,2 s | 0,15–0,21 s (sem a estatística da expressão: 3,3 s, Nested Loop pela Receita com o `@@` como filtro) |

**Despensa** (`loadPantryMatches`, 200 itens, "Tenho o básico" ligado): pt-BR 1,84–2,13 s → 1,45–1,83 s; en-US 2,2–2,8 s → 1,9–2,1 s (uma execução fria da query antiga em en-US, no banco ainda na 0075, estourou o `statement_timeout` de 5 s). O CTE `lines` cai de ~441 ms para ~168 ms. O resto não depende da normalização: quebrar cada linha em palavras (`tokens`, ~700 ms) e a regex dos básicos sobre cada linha (`hits`, ~800 ms), as duas em função dos termos da Despensa. Neste acervo sintético quase toda Receita tem algum item da Despensa (7.995 chegam ao `per_recipe`). Em produção (~239 Receitas) os dois casos são milissegundos antes e depois.

**Pré-filtro por palavras: não entrou.** Um `text[]` de palavras com GIN só ajudaria restringindo `lines` às Receitas com algum candidato a casamento real. O candidato também pode vir do nome traduzido (jsonb de `recipe_translation`), que não tem índice, então um pré-filtro exato ainda lê a tradução de toda linha, e o ganho não ficou demonstrado. Fica como próximo passo, com dado de produção.

**O que segue calculado na consulta, e por quê.** O nome traduzido do Item (`tr.nome`): mora no jsonb de `recipe_translation` e só vale quando `nomeOrigem` ainda casa com o `raw_text` atual; coluna gerada não alcança outra tabela, e gravá-lo na escrita pediria cobrir todo caminho que escreve `recipe_ingredient` (geração, importação da web, derivada, `recipe/ingredients.ts`, criação e resolução de Item pelo Curador, dois scripts) ou `recipe_translation.ingredientes` (tradução, re-tradução, regeneração, derivada, criação pelo Curador, edição dos nomes e o reparo de divergência), mais um backfill. Os `aliases` do canônico: coluna gerada não aceita subquery (o `unnest`), e o catálogo canônico é pequeno. A resolução canônica da Busca (`ingredient_canonical`, outra normalização) também segue como estava.

**Equivalência.** (a) `test/integration/ingredient-index-equivalence.test.ts`: num corpus adversarial (acento, caixa, largura total, ligadura, emoji, NBSP, tab e quebra de linha, pontuação pura, NULL e vazio; pt-BR, en-US, es-ES, `pt`, en-GB), cada coluna gerada é igual, linha a linha, à expressão que a consulta antiga calculava (e acompanha INSERT e UPDATE); o `ingredient_raw_hit` antigo (copiado literal) e o novo dão os mesmos pares (Receita, termo) em 41 conjuntos de termos, anônimo e com dois viewers; a Despensa antiga (a query de hoje com cada coluna trocada pela expressão que ela guarda) e a nova dão a mesma resposta em 48 combinações (quatro despensas, dois viewers, com e sem básicos, três locales); os GIN atendem o `@@` de cada braço. (b) No banco local reduzido (860 Receitas, 8.480 Itens), o módulo de `main` contra o novo: `searchRecipes` em 864 combinações (54 consultas × any/all × pt-BR/en-US × anônimo/dono × relevância/popularidade; 736 com resultado), `loadPantryMatches` em 12 e o "Cozinhei" (`withUsed` + `onlyRecipeId`) em 400 (380 não vazias): nenhuma diferença. (c) O SQL da Despensa de `main` é, byte a byte, o de hoje com `ri.raw_text_norm`/`it.nome_norm` trocados pela expressão (fora as linhas de comentário).

**Custo da migração.** A reescrita de `recipe_ingredient` levou 326 ms com 40.000 Itens no banco local; em produção (~2.400 Itens) são dezenas de ms sob ACCESS EXCLUSIVE (leitura de Itens bloqueada nesse intervalo).

## 7. Achado I: derivados WebP da Imagem da receita (handoff 69, migração 0077)

**Antes.** Todo card, miniatura e capa servia o `blob_url` da `recipe_image`: o PNG que o Gemini devolve (~1,5 MB a 1024²) ou a foto enviada (até 2 MB, sem reencode). Um feed de 20 cards baixava ~30 MB de imagem para slots de 128–144 px.

**O que mudou.**
- Migração 0077: `recipe_image.thumb_url`, `detail_url` (NULL = sem derivado) e `derivatives_attempted_at` (fila do backfill), com o CHECK `recipe_image_derivatives_pair_chk` (os dois juntos ou nenhum). Só ADD COLUMN nullable sem default e um CHECK, num ALTER TABLE, com `lock_timeout` de 5 s.
- Escrita (`src/server/images/image-derivatives.ts`): upload do dono e do catálogo e a geração por IA (`generateAndStoreGalleryImage`) reduzem o original com sharp em paralelo com o `put` dele, sobem os dois WebP (`recipes/w1280/`, `recipes/w400/`) e gravam as URLs na mesma linha. Falha nos derivados loga `[imagens] derivados não gerados (<etapa>): <erro>` e segue com as colunas NULL; o upload e a geração respondem como antes.
- Leitura: feed, Busca, Seguindo, receita da semana, perfil público, semelhantes, cozinheiros recomendados, Minhas criações, Salvos/coleções, Cardápio, Despensa, capa do detalhe e a galeria do estúdio do dono ganham `srcset` e `sizes` do slot (`IMAGE_SLOTS`/`imageSrcSetProps` em `src/domain/image-variants.ts`): thumb 400w e detail 1280w nos slots de até 200 px CSS (cards em lista e miniaturas), só o detail nos maiores. `src` segue sendo o original. Ficam no original: OG/Twitter e o `image` do JSON-LD (scrapers de preview tratam WebP de forma desigual e pedem ≥1200 px; é um acesso por compartilhamento), as telas do Curador (moderação, fila de revisão, comparador, estúdio do catálogo: julgar a imagem pede o arquivo inteiro) e o preview da geração no estúdio do dono.
- Imagens antigas: cron diário `/api/cron/image-derivatives` (10:30 UTC), até 25 imagens por passada (sem começar imagem nova com menos de 15 s dos 40 s do orçamento), as selecionadas primeiro; idempotente e não destrutivo. Falha permanente e imagem moderada ficam fora da fila (a falha volta uma vez por semana).

**Medidas** (sharp 0.34.5, WebP q80; PNG sintético "tipo Gemini": textura fractal `feTurbulence` + 120 formas com borda, o gerador de `test/integration/image-derivatives.test.ts`):

| Original | PNG | `detail_url` | `thumb_url` | sharp (mediana de 5) |
|---|---|---|---|---|
| 1024×1024 | 1.564 KB | 1024×1024, 66 KB (24×) | 400×400, 20 KB (78×) | 142 ms |
| 1536×1024 | 2.514 KB | 1280×853, 73 KB (35×) | 400×267, 16 KB (162×) | 212 ms |

Um feed de 20 cards cai de ~31 MB para ~0,4 MB. O WebP de foto real tende a ser um pouco maior que o desta textura; a ordem de grandeza é a mesma.

**Qual derivado o navegador escolhe** (`test/unit/image-variants.test.ts`). A spec deixa a escolha ao navegador; o Chrome usa a média geométrica entre candidatos vizinhos e pode ficar com o menor e ampliar (num slot de 350 px em DPR 2 escolheria o thumb de 400 px). Por isso só os slots que nunca passam de 200 px CSS oferecem o thumb, e o teste confere as duas regras ("menor densidade ≥ DPR" e a do Chrome) de 320 a 2560 px em DPR até 2. Card em lista (128–144 px) ⇒ thumb em celular até DPR 3 e em desktop até DPR 2; miniaturas ⇒ thumb; capa do detalhe, cards de Minhas criações/Salvos e grade das semelhantes ⇒ detail.

