# Handoff 71 — Status HTTP de verdade na página da receita (308 e 404)

**Sessão:** 2026-10-14. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `d0cc6f6`, depois do #577). **Migração:** nenhuma. Origem: o achado de passagem da proposta do 2º passo do A (`docs/perf/2026-10-14-a-passo2-isr-detalhe-proposta.md` §1). O dono escolheu "corrigir já", aceitando que a página da receita perca o esqueleto de carregamento.

## 1. O problema

O `src/app/[locale]/loading.tsx` abria um Suspense acima de TODA rota de `[locale]`. O Next manda o HTML (status 200) assim que o shell fica pronto, antes de a página terminar. Na página da receita, o `permanentRedirect` do link antigo e o `notFound()` aconteciam depois disso, então:

- o link legado `/{locale}/recipes/<uuid>` respondia **200** e o redirect para o slug acontecia no cliente (`NEXT_REDIRECT;replace;…;308` só no payload), contra o 301/308 permanente do ADR-0020 decisão 4;
- o slug privado (para quem não é dono), o slug inexistente e o UUID não público respondiam **200** com a tela de "não encontrado" (soft 404), inclusive para o Googlebot;
- o `/{locale}/recipes` (que redireciona para a home) idem: 200 com redirect no cliente.

## 2. O que mudou

- **Grupo de rotas `src/app/[locale]/(com-carregamento)/`.** Recebeu o `loading.tsx` e TODAS as rotas de `[locale]` menos `recipes/` (`git mv`, sem mudar conteúdo). Os parênteses não entram na URL: nenhuma URL mudou, e a tabela de rotas do `next build` é idêntica (mesmos `ƒ`/`●`/`○`). Ficaram na raiz de `[locale]`: `layout.tsx`, `error.tsx`, `not-found.tsx` e `recipes/`.
- **`recipes/` sem `loading.tsx` acima.** O render decide o desfecho antes de mandar qualquer byte: 308 com `Location`, 404 de verdade, ou 200.
- **`<Suspense>` sem fallback dentro do `DetailChrome`** (`recipes/[id]/page.tsx`), abaixo da decisão de status. Nada ali dentro suspende, então o conteúdo sai inteiro no HTML. Ele só serve de fronteira de hidratação: o `loading.tsx` fazia esse papel sem querer. Sem fronteira nenhuma, um erro de hidratação na receita fazia o React refazer o documento inteiro no client, o que recriava o `<html>` com o tema claro (achado bloqueante do painel: quem usa tema escuro via a receita clara).
- **`useSession` com correção de hidratação** (`src/lib/auth-client.ts`). Essa era a causa do erro de hidratação (React #418) que a página da receita já tinha antes deste PR, só no build de produção e de forma intermitente. O hook do Better Auth usa `useSyncExternalStore(subscribe, get, get)`, ou seja, o snapshot de servidor é o valor atual do atom no navegador. Quando o get-session respondia antes de a árvore da receita hidratar, os botões do topo (Cardápio, Lista, Salvar) renderizavam "anônimo" ou "logado" onde o servidor tinha renderizado "carregando". O wrapper devolve o estado do servidor (pendente) durante a hidratação e o valor real logo depois; um componente montado depois (navegação no client) recebe o valor real direto. Vale para os ~30 usos de `useSession`.
- **`ThemeCookieSync`** (`src/components/theme-cookie-sync.tsx`, montado no `[locale]/layout.tsx`): reaplica a classe do cookie `theme` num `useLayoutEffect`. No caminho normal não faz nada. Ele cobre o 404 e o 500 da receita: como o `notFound()` agora lança antes de qualquer HTML, o Next manda um shell vazio (`<html id="__next_error__">`) e o client monta o documento, sem o script do `<head>` rodar. A função do script saiu para `src/lib/theme-apply.ts`, que o client pode importar; `theme-script.ts` a reexporta e segue só do servidor.
- Comentários no `loading.tsx` e no topo de `recipes/[id]/page.tsx` explicam a regra; nota de implementação no ADR-0020 decisão 4; a proposta do A passo 2 registra a correção.
- **Teste novo** `test/unit/recipe-route-status.test.ts`: trava a estrutura (nenhum `loading.*` em `app/`, `[locale]/`, `recipes/` ou `recipes/[id]/`; o layout de `[locale]` sem `<Suspense>`; o esqueleto segue no grupo, que não tem `recipes/`). O status em si só aparece num build de produção (§4).
- Imports de teste que apontavam para rotas movidas (`home-feed`, `following-page`, `verify-email-page`, `admin-routes-gate`) passaram a usar `@/app/[locale]/(com-carregamento)/…`.

## 3. O que ler primeiro

1. O comentário do topo de `src/app/[locale]/recipes/[id]/page.tsx` (o bloco "Status HTTP").
2. `src/app/[locale]/(com-carregamento)/loading.tsx` (por que o grupo existe).
3. `test/unit/recipe-route-status.test.ts`.
4. ADR-0020 decisão 4 e a nota de implementação dela.

## 4. Evidência

`next build` + `next start` local contra o Postgres da 5433 (banco `repro_detail`, migrado até a 0077, com receita pública, privada e de catálogo), antes (`d0cc6f6`) e depois:

| Request | Antes | Depois |
|---|---|---|
| `/pt-BR/recipes/bolo-de-cenoura` (público) | 200 | 200 |
| `/en-US/recipes/carrot-cake` (público) | 200 | 200 |
| `/pt-BR/recipes/<uuid público>` | 200, redirect no cliente | **308**, `location: /pt-BR/recipes/bolo-de-cenoura` |
| `/en-US/recipes/<uuid público>` | 200, redirect no cliente | **308**, `location: /en-US/recipes/carrot-cake` |
| `/pt-BR/recipes/segredo-da-casa` (privado, anônimo) | 200, soft 404 | **404** (`noindex`, mesma tela "Não encontrado.") |
| `/pt-BR/recipes/nao-existe` | 200, soft 404 | **404** |
| `/pt-BR/recipes/<uuid privado>` e `<uuid inexistente>` | 200, soft 404 | **404** |
| `/pt-BR/recipes` | 200, redirect no cliente | **308**, `location: /pt-BR` |
| privado, com a sessão do dono (slug e uuid) | 200 | 200, a receita privada |
| `/pt-BR`, `/pt-BR/privacidade`, `/pt-BR/create` | 200 | 200, com o esqueleto como antes |

- **Navegação no cliente** (Chromium headless, `router.push` a partir de `/pt-BR/privacidade`, sem carga dura): o UUID legado termina em `/pt-BR/recipes/bolo-de-cenoura` com o título da receita; `nao-existe` mostra "Não encontrado."; o slug público abre a receita; `/pt-BR/recipes` termina na home.
- **Banco fora**: a página da receita responde **500** (antes 200), e o navegador mostra a mesma tela do `error.tsx` ("Algo deu errado. Tentar de novo"), com header e footer. As rotas ISR (`/privacidade`, `/guia`) seguem 200.
- **Tema escuro e hidratação** (Chromium headless, cookie `theme=dark`, 6 cargas por URL, build de produção): na receita pública (com e sem imagem), no 404 da receita, na home, em `/cooks` e em `/guia`, a classe termina `dark` em todas e não houve nenhum erro #418. Antes da correção do `useSession`, o #418 aparecia de forma intermitente na receita, também na `main` (`d0cc6f6`). Com só o Suspense, aparecia em toda carga, contido na receita. Vista logada do dono (cookie de sessão) e anônima conferidas depois da hidratação: botões do topo, header e receita privada como antes, sem erro.
- `npx tsc --noEmit` limpo; `npx eslint .` limpo; os testes de integração e UI das rotas movidas passam (`TEST_DATABASE_URL` inline no Postgres local).

## 5. O que muda para quem vê

- **Navegação no cliente para uma receita** (clicar num card): antes, o esqueleto aparecia na hora e a receita entrava depois. Agora a página anterior fica na tela até a receita chegar, sem esqueleto. Foi a troca aceita pelo dono.
- **Carga dura da receita**: o HTML não traz mais o esqueleto antes da receita; vem a receita inteira (ou o 404, ou o 308).
- **Banco fora na página da receita**: 500 em vez de 200, com a mesma tela de erro.
- **404 e 500 da receita**: o HTML chega vazio e a tela (header, "Não encontrado.", footer) é montada pelo JavaScript; o tema do cookie é aplicado antes da pintura (`ThemeCookieSync`).
- Nada muda nas outras rotas: o boundary do `loading.tsx` ficou um segmento abaixo (o grupo), mas sem `layout.tsx` no meio, então o esqueleto cobre a mesma área.

## 6. Princípios inegociáveis

- Nada de `loading.tsx` ou `<Suspense>` ACIMA das chamadas de `permanentRedirect`/`notFound` da página da receita: o status volta a ser 200. Um Suspense dentro do JSX que a página devolve (como o do `DetailChrome`) é seguro, porque a decisão já foi tomada. Um `loading.*` em `app/`, `[locale]/`, `recipes/` ou `recipes/[id]/`, ou um `<Suspense>` no `layout.tsx` de `[locale]`, quebra o teste estrutural; um `<Suspense>` na página acima dessas chamadas não quebra teste nenhum, e só o `curl` do §8 mostra.
- Componente client que renderiza diferente conforme a sessão usa o `useSession` de `@/lib/auth-client` (o wrapper), nunca o `authClient.useSession` direto.
- Rota nova em `[locale]` vai para dentro de `(com-carregamento)/` (para ter o esqueleto), salvo se precisar de status HTTP real, como `recipes/`.
- O redirect e o gate continuam no Server Component (ADR-0020), não no proxy.

## 7. Landmines

- **`/u/[handle]` (perfil) segue com soft 404** (200 com "não encontrado" para handle inexistente), pelo mesmo motivo. Ficou fora do pedido (que era a página da receita). Corrigir é mover `u/` para fora do grupo, com a mesma troca visual.
- `docs/legal/pacote-consulta-juridica.md` cita `src/app/[locale]/seus-direitos/page.tsx`, que agora mora em `(com-carregamento)/seus-direitos/`. Não mexi porque mudanças em `docs/legal` passam pelo dono; a URL pública não mudou.
- **Tempo de resposta do 404 (anterior a este PR).** Um slug privado faz mais consultas que um inexistente (`resolveRecipeIdBySlug` acha a linha e o `loadRecipeDetailView` roda o gate e a sessão) antes de cair no mesmo 404: ~2 ms a mais medidos em localhost. Status, headers e corpo são idênticos. Antes do PR o 1º byte (o esqueleto) saía em tempo constante, mas o tempo total já diferia do mesmo jeito, então a exposição não é nova. Atalho avaliado e não feito: `notFound()` direto quando o request não tem cookie de sessão. Ele não fecha a diferença, porque quem sonda manda um cookie qualquer e cai no caminho lento. Fechar de verdade pediria igualar o trabalho dos dois caminhos.
- Os `redirect()` que ficaram dentro do grupo seguem saindo como 200 com redirect no cliente (as rotas legadas de `conversation/`, o `admin` mandando para `/sign-in`). Já era assim antes do PR e não pesa em SEO.
- O `git mv` preserva o histórico, mas `git log` de um arquivo movido precisa de `--follow`.

## 8. Critério de saída

Em produção, depois do deploy: `curl -sI https://<domínio>/pt-BR/recipes/<uuid de receita pública>` responde 308 com `location` no slug; `curl -sI .../pt-BR/recipes/nao-existe-xyz` responde 404; uma receita pública responde 200.

## 9. Gotchas de ambiente

- Postgres local na 5433 (cluster 17/perf, `postgres:postgres`). `DATABASE_URL`/`TEST_DATABASE_URL` só inline por comando, nunca exportadas (CLAUDE.md). Um `vitest` por vez contra o mesmo Postgres.
- O status só aparece com `next build` + `next start`: no `next dev` e nos testes de componente não há resposta HTTP de verdade.

## 10. O que resta

A proposta do 2º passo do A (`docs/perf/2026-10-14-a-passo2-isr-detalhe-proposta.md`) segue esperando as decisões do dono; a recomendação continua "não fazer agora". O soft 404 do perfil (`/u/[handle]`, §7) é o candidato natural se ele quiser o mesmo tratamento.
