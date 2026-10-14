# Handoff 67 — Páginas públicas em cache: tema por script e leituras do layout com tag

**Sessão:** 2026-10-14. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `4a31c52`, depois do #572). **Migração:** nenhuma. Continuação da auditoria do handoff 64: achado A, primeiro passo (passo 4 da ordem aprovada em `docs/perf/2026-10-13-respostas.md`).

## 1. O que foi entregue

- **Tema sem `cookies()` no layout.** `src/app/[locale]/layout.tsx` não lê mais o cookie `theme` (era o que deixava toda rota dinâmica). O `<html>` sai sempre com `DEFAULT_THEME_CLASS` (`'light'`, o mesmo de quem não tem cookie, #208) e `suppressHydrationWarning`; o `<head>` leva um `<script>` inline (`THEME_INIT_SCRIPT`, `src/lib/theme-script.ts`) que lê `document.cookie` e troca a classe antes da primeira pintura. O cookie continua sendo a fonte da verdade, com o mesmo nome e o mesmo formato.
  - O script é `applyThemeFromCookie.toString()`: autossuficiente (nada importado), com o parse de cookie do Next (`parseCookie` de @edge-runtime/cookies: `; *`, par sem `=` vale "true", `decodeURIComponent`, o último par vence) e a regra de `resolveThemeClass`. Qualquer erro deixa o claro.
  - **Só no servidor:** `applyThemeFromCookie` e `THEME_INIT_SCRIPT` vivem em `src/lib/theme-script.ts`, importado só pelo layout (e testes). `src/lib/theme.ts` guarda o que o client usa (`THEME_COOKIE`, `THEMES`/`Theme`, `DEFAULT_THEME_CLASS`, `resolveThemeClass`); antes o toggle importava o módulo que monta o `toString()` no carregamento, e a função ia no bundle do client. O repo não tem o pacote `server-only`.
  - **ThemeToggle** (`src/components/theme-toggle.tsx`; um só, no footer ao lado do seletor de idioma, desde o #162) não recebe mais `initialTheme`: lê o tema da classe do `<html>` com `useSyncExternalStore` (snapshot de servidor = o default; `MutationObserver` para trocas). O clique grava o cookie exatamente como antes (`theme=<x>; path=/; max-age=31536000; samesite=lax`) e alterna a classe. O ícone é escolhido por CSS (`dark:hidden` na lua, `hidden dark:block` no sol), então já sai certo na primeira pintura para quem guardou 'dark'; o rótulo (aria-label/title) acerta logo depois da hidratação.
  - O caminho "segue o SO" do toggle (`initialTheme = null` + `matchMedia`) saiu: desde o #208 o layout sempre mandava `'light'` ou `'dark'`, então ele era inalcançável no app.
- **Leituras do layout no Data Cache com tag** (`src/server/layout-data.ts`, `unstable_cache`, `revalidate` de 1 h como rede):
  - `loadLayoutCozinhaVocab(db)` → tag `refogando:vocab:cozinha`. Lê o banco direto (`selectVocabulary`, extraída de `loadVocabulary`), sem o cache de 30 s por instância.
  - `loadLayoutAppConfig(db)` → tag `refogando:app-config`. Guarda só o que o layout usa: `variantEnabled` e os links sociais ligados. O resto da config segue ao vivo (`loadAppConfig`, com o dedupe do `React.cache`).
  - Leituras em paralelo (`Promise.all`), cada uma com a sua degradação.
  - **Registro único de tags + um helper** (`src/server/cache-tags.ts`): as três tags do app (`refogando:app-config`, `refogando:vocab:cozinha`, `refogando:receita-da-semana:popularidade`; prefixo porque o Data Cache da Vercel pode ser compartilhado no time), cada uma com o seu perfil de expiração, e `expireCacheTag(tag)`, chamado depois da escrita gravada, que engole a falha com `console.warn` (nunca vira 500).
  - **Perfil `'max'` (stale-while-revalidate) nas tags do layout.** O primeiro request depois do save ainda recebe o HTML antigo e dispara a regeneração: o admin vê a mudança UM request depois. A primeira versão usava `{ expire: 0 }` e isso derrubava as páginas ISR: sem cópia velha, uma falha do banco antes da próxima visita fazia a regeneração bloqueante degradar, o `connection()` abortar ("Page changed from static to dynamic", digest `DYNAMIC_SERVER_USAGE`) e a rota responder **500 em todo request até o banco voltar**. Reproduzido com `next build` + `next start` contra um Postgres local (§5 do relatório): com `{ expire: 0 }`, 500; com `'max'`, 200 com o HTML antigo, e o `unstable_cache` devolve o valor antigo quando o recálculo falha.
  - A tag do vencedor da "Receita da semana" segue `{ expire: 0 }`: só a home a lê, e a home é dinâmica (sem HTML em cache para perder). `'max'` nem serviria ali: o vencedor velho tem `computedAt` recente e passaria pelo corte de idade de `loadRecipeOfTheWeek`.
  - Escritores que expiram:
    - `refogando:vocab:cozinha`: `POST /api/admin/vocabulary` (criar), `PATCH /api/admin/vocabulary` (rótulo, nota de voz, depreciar/reativar; `finally` expira se alguma das duas escritas gravou), `POST /api/curate/cozinhas/[slug]/approve`.
    - `refogando:app-config`: `PUT /api/admin/config` (o único escritor de `app_config`), em todo PUT gravado.
    - Não expiram, de propósito: `merge` e `reject` da curadoria e o "Outra" (`suggestCozinha`, chamado por `POST /api/generations` e `PATCH /api/recipes/[id]`). Os três só gravam ou tombam `suggested`; o escopo `active` não muda.
  - **Degradação fora do cache:** se uma leitura do layout falha, ele degrada como antes (sem cozinhas, "gerar 2" desligado, footer sem links) e chama `connection()`. No pré-render isso aborta: no build sem banco (CI) a rota sai dinâmica; numa regeneração ISR em segundo plano (página vencida por tempo ou por tag com `'max'`) o Next segue servindo o HTML anterior. Na regeneração, a leitura só falha sem entrada nenhuma no Data Cache: com uma entrada vencida, o `unstable_cache` devolve o valor antigo. Medido (§5 do relatório): sem o `connection()`, a página degradada ficou em cache.
- **`/create` e `/cooks` seguem dinâmicas** (`await connection()` na página). `/create` estática cairia no fallback do `<Suspense>` no servidor (o `useSearchParams` do `CreateShellClient`). `/cooks` semeia cozinheiros do banco: como ISR, a semente teria 1 h ou mais de idade (stale-while-revalidate) e a degradação para lista vazia ficaria em cache.
- **Resultado do build** (Postgres local): `/privacidade`, `/seus-direitos`, `/guia`, `/plano`, `/following`, `/forgot-password` e os redirects `/conversation` e `/recipes` viraram ISR de 1 h, nos dois idiomas. `next start`: `x-nextjs-cache: HIT`, `Cache-Control: s-maxage=3600, stale-while-revalidate=…`, o mesmo HTML com ou sem `Cookie: theme=dark`. Tabela completa em `docs/perf/2026-10-13-auditoria.md` §5.
- **Dublê de `next/cache`:** `failRevalidateTag()` faz o `revalidateTag` lançar (prova de que a escrita sobrevive); `revalidateTag(tag, 'max')` deixa a entrada vencida em vez de removê-la (com `serveStaleEntries()` ela é servida, como no Next).
- ADRs 0018, 0020 e 0025 ganharam uma linha de atualização; relatório: A parcial, §5.

## 2. O que ler primeiro

1. `docs/perf/2026-10-13-auditoria.md` §5: o antes/depois do build, por que `/create` e `/cooks` ficaram dinâmicas, o teste da degradação e o `Vary`.
2. `src/lib/theme-script.ts`: `applyThemeFromCookie` e `THEME_INIT_SCRIPT` (o que pode e o que não pode entrar no script; quem pode importar).
3. `src/server/cache-tags.ts` (as tags, o perfil de cada uma e por quê) e `src/server/layout-data.ts`: o bloco de comentário (o que é cacheado, quem expira, quem não expira e por quê).
4. `src/app/[locale]/layout.tsx`: o `connection()` da degradação.
5. `test/ui/theme-toggle.test.tsx`: a paridade do script com o `RequestCookies` do Next; `test/integration/layout-data.test.ts`: cada escritor contra a tag.

## 3. Princípios inegociáveis

- **O root layout não lê nada do request** (`cookies()`, `headers()`, `searchParams`, sessão). Qualquer leitura dessas volta a deixar TODA rota dinâmica. Preferência por viewer vai para o client (como o AuthSlot, ADR-0028) ou para um script pré-pintura.
- **O script do tema é autossuficiente e espelha o servidor antigo.** Nada importado dentro de `applyThemeFromCookie`; mudar a regra do tema é mudar `resolveThemeClass` E o script, e o teste de paridade tem que seguir verde.
- **Toda leitura de banco do layout passa pelo Data Cache com tag, e todo escritor que muda o que ela devolve expira a tag** (depois da escrita, sem lançar). Escritor novo de `vocabulary_term` que mexa no escopo `active`, ou de `app_config`: chama `expireCacheTag(COZINHA_VOCAB_TAG)`/`expireCacheTag(APP_CONFIG_TAG)` e ganha um caso em `layout-data.test.ts`. Tag nova: registrada em `src/server/cache-tags.ts`, nunca um `revalidateTag` solto.
- **Tag lida por página estática/ISR expira com `'max'`, nunca com `{ expire: 0 }`** (o 500 do §1). `{ expire: 0 }` só para tag lida apenas por página dinâmica.
- **`src/lib/theme-script.ts` não entra em componente client** (o `toString()` iria para o bundle).
- **O valor cacheado vem do banco direto**, nunca de outro cache com TTL (senão a recarga logo depois de expirar guarda o valor velho).
- **Degradação nunca vira HTML em cache:** quem degrada num caminho que pode ser pré-renderizado chama `connection()`.
- **Página que vira estática por tabela precisa ter o mesmo HTML que tinha dinâmica.** Ao tirar um bloqueio, compare o HTML de antes e depois (sem os scripts) de cada rota que mudou de ƒ para ●.

## 4. Landmines

- **O build da Vercel lê o banco** (selects do vocabulário e da config) para pré-renderizar as páginas estáticas; em produção, o de produção. O `buildCommand` (`vercel.json`) roda `npm run db:migrate` ANTES do `next build`, então a conexão existe. Só a CI (sem `DATABASE_URL`) gera tudo dinâmico; um preview da Vercel sem branch do Neon falha já no `db:migrate`, antes do build.
- **O pré-render usa `DATABASE_URL`; o `drizzle-kit migrate` prefere `DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING`** (`drizzle.config.ts`). Num preview, a migração pode ir para um banco e o pré-render ler outro. **Conferência do Fernando:** no ambiente Preview da Vercel, `DATABASE_URL` é a do branch do Neon (a mesma base da URL unpooled).
- **Timeout de conexão.** O postgres-js usa o `connect_timeout` padrão (30 s; `makeSql` não define outro). Com um `DATABASE_URL` que some no vazio (host que não responde, em vez de recusar), cada pré-render espera até 30 s antes de degradar, perto do limite de 60 s do `staticPageGenerationTimeout`: o build pode estourar o tempo em vez de sair dinâmico.
- **Escrita fora do app (migração, SQL à mão, script) não expira a tag.** "1 h" não é teto: a revalidação por tempo também é stale-while-revalidate, então o valor novo aparece na primeira regeneração depois de ≥1 h (`LAYOUT_DATA_REVALIDATE_S`; o request que acha a entrada vencida ainda leva a antiga, e com pouco tráfego isso é bem depois de 1 h), ou um request depois de um save no admin que expire a tag. Migração que mexa em `vocabulary_term` ou nos links sociais: conte com isso, ou salve pelo admin depois do deploy.
- **Save no admin com o banco fora na hora da regeneração:** a página regenera com o valor antigo (sem 500) e fica fresca por mais 1 h; o valor novo espera a próxima regeneração por tempo ou outro save.
- **`unstable_cache` serve a entrada vencida e recalcula em segundo plano** (num request dinâmico; numa regeneração ISR recalcula na hora e, se falhar, devolve a vencida). Com o banco fora, a página regenera com o valor antigo (bom); a degradação só acontece sem entrada nenhuma, e aí o `connection()` aborta a regeneração em segundo plano. Uma tag com `{ expire: 0 }` lida por página ISR transforma isso em 500 (§1).
- **Chaves do Data Cache com versão** (`'v1'` no layout, `'v2'` na receita da semana): suba quando o formato guardado ou os defaults mudarem. O Data Cache da Vercel sobrevive ao deploy.
- **`/create` e `/cooks` têm `await connection()`.** Tirar sem resolver o motivo muda o HTML (`/create`) ou o frescor (`/cooks`).
- **Rota que vira estática perde o `loading.tsx`** (não há streaming) e responde do cache. Se uma página nova sob `[locale]` ler dados do banco no servidor sem ler o request, ela vira ISR de 1 h sem ninguém pedir: decida (tag + escritores, ou `connection()`).
- **`suppressHydrationWarning` vale só para os atributos do `<html>`.** Não espalhe; um mismatch nos filhos continua sendo bug.
- **Re-render do `<html>` pelo client volta o tema para o claro.** Se a hidratação falhar na raiz (o React recria o `<html>` a partir do servidor), quem guardou 'dark' fica claro até recarregar: o script só roda no parse.
- **JS desligado + cookie 'dark' agora dá claro** (antes o servidor emitia `dark`): é a única diferença do tema sem JS, inerente a não ler o cookie no servidor.
- **CSP com nonce** (endurecimento deferido em `next.config.ts`) forçaria render dinâmico em toda rota, e com nonce o navegador ignora o `'unsafe-inline'`: o script do tema, sem nonce, seria bloqueado. Está anotado no comentário da CSP.
- **Depois de atualizar Next/SWC, confira o `<script>` do `<head>` no HTML do build** (`.next/server/app/pt-BR/privacidade.html`): o `toString()` sai do código já compilado do servidor, e o teste de paridade roda o código-fonte, não o minificado. Confira também que `.next/static` não tem o script (`grep -rl 'cookie.split' .next/static` vazio).
- **Lista de cozinhas: o layout atualiza um request depois do save, mas a Busca não.** `/api/search` segue com o cache de 30 s por instância de `loadVocabulary`: por até 30 s a faceta do layout e a validação da Busca podem discordar.
- **O `Vary: Accept-Language` do proxy nos caminhos prefixados** é substituído pelo `Vary` do Next no `next start`. Na Vercel não conferi.
- O dublê de `next/cache` continua valendo para a suíte node; a suíte `ui` não o tem (o teste do layout mocka `@/server/layout-data` e `next/server`).
- Postgres local: cluster `17/perf` na 5433 (`postgres:postgres`), `TEST_DATABASE_URL`/`DATABASE_URL` inline por comando, nunca exportados; um vitest por vez no cluster. Para medir o build: `DATABASE_URL=… BETTER_AUTH_SECRET=<dummy> npx next build` contra um banco local migrado (`drizzle-kit migrate` com a mesma URL inline); para `next start`, também `APP_URL` (a home exige).

## 5. Próximos passos (ordem aprovada em 2026-10-13)

1. **A, segundo passo — ISR do detalhe público** (`/[locale]/recipes/[id]`). Bloqueios hoje:
   - sem `generateStaticParams`, o segmento `[id]` é renderizado sob demanda (precisa de `generateStaticParams` devolvendo `[]` ou os slugs, e `dynamicParams`);
   - o ramo do dono lê `searchParams` (`?original`) e `headers()` (sessão) na mesma página: num slug que cai nesse ramo a renderização estática quebra. Separar o ramo do dono (rota própria ou leitura no client) antes de ligar o ISR;
   - frescor: avaliações, semelhantes, aviso de catálogo e a própria receita (edição, moderação, tradução, imagem) precisam de tag por receita expirada nos escritores, ou de um `revalidate` curto aceito pelo dono;
   - a home segue dinâmica por ler `searchParams` no `generateMetadata` (gate de índice); `/cooks` e `/create` por decisão (§1).
2. **Migração 1 — C (ingrediente) + E:** coluna de config/`tsvector` gerado + GIN em `recipe_ingredient` e as colunas normalizadas da Despensa (`raw_text_norm`, `nome_norm`).
3. **Migração 2 — I:** derivados WebP da capa (~1280 px e ~400 px), original guardado, `srcset`, backfill.
4. **G:** gaveta "Criar" lazy (pré-carga, fallback para `/create`) + largura 512 px (`sm:max-w-lg`).
5. **Em espera:** B (HNSW) e H passo 2 (paginação das listas), até o catálogo crescer.

**Para o Fernando decidir:** (a) `/cooks` como ISR (semente com 1 h ou mais de idade, ou tag nos escritores de seguir/receitas); (b) tirar o `Vary: Accept-Language` dos caminhos prefixados no proxy, depois de olhar os headers de `/pt-BR/privacidade` em produção; (c) conferir que o `DATABASE_URL` do ambiente Preview da Vercel é o do branch do Neon (§4).

## 6. Critério de saída

PR mergeado com painel de revisão limpo e "checks" verde; depois do deploy, `curl -sI https://<prod>/pt-BR/privacidade` com `x-vercel-cache: HIT` na segunda chamada.
