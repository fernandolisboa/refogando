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
- Comentários no `loading.tsx` e no topo de `recipes/[id]/page.tsx` explicam a regra; nota de implementação no ADR-0020 decisão 4; a proposta do A passo 2 registra a correção.
- **Teste novo** `test/unit/recipe-route-status.test.ts`: trava a estrutura (nenhum `loading.*` em `app/`, `[locale]/`, `recipes/` ou `recipes/[id]/`; o esqueleto segue no grupo, que não tem `recipes/`). O status em si só aparece num build de produção (§3).
- Imports de teste que apontavam para rotas movidas (`home-feed`, `following-page`, `verify-email-page`, `admin-routes-gate`) passaram a usar `@/app/[locale]/(com-carregamento)/…`.

## 3. Evidência

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
- `npx tsc --noEmit` limpo; `npx eslint .` limpo; os testes de integração e UI das rotas movidas passam (`TEST_DATABASE_URL` inline no Postgres local).

## 4. O que muda para quem vê

- **Navegação no cliente para uma receita** (clicar num card): antes, o esqueleto aparecia na hora e a receita entrava depois. Agora a página anterior fica na tela até a receita chegar, sem esqueleto. Foi a troca aceita pelo dono.
- **Carga dura da receita**: o HTML não traz mais o esqueleto antes da receita; vem a receita inteira (ou o 404, ou o 308).
- **Banco fora na página da receita**: 500 em vez de 200, com a mesma tela de erro.
- Nada muda nas outras rotas: seguem embaixo do mesmo `loading.tsx`, no mesmo ponto da árvore (o grupo não tem `layout.tsx`).

## 5. Princípios inegociáveis

- Nada de `loading.tsx` ou `<Suspense>` acima das chamadas de `permanentRedirect`/`notFound` da página da receita: o status volta a ser 200 sem nenhum teste falhar além do estrutural.
- Rota nova em `[locale]` vai para dentro de `(com-carregamento)/` (para ter o esqueleto), salvo se precisar de status HTTP real, como `recipes/`.
- O redirect e o gate continuam no Server Component (ADR-0020), não no proxy.

## 6. Landmines

- **`/u/[handle]` (perfil) segue com soft 404** (200 com "não encontrado" para handle inexistente), pelo mesmo motivo. Ficou fora do pedido (que era a página da receita). Corrigir é mover `u/` para fora do grupo, com a mesma troca visual.
- `docs/legal/pacote-consulta-juridica.md` cita `src/app/[locale]/seus-direitos/page.tsx`, que agora mora em `(com-carregamento)/seus-direitos/`. Não mexi porque mudanças em `docs/legal` passam pelo dono; a URL pública não mudou.
- O `git mv` preserva o histórico, mas `git log` de um arquivo movido precisa de `--follow`.

## 7. Critério de saída

Em produção, depois do deploy: `curl -sI https://<domínio>/pt-BR/recipes/<uuid de receita pública>` responde 308 com `location` no slug; `curl -sI .../pt-BR/recipes/nao-existe-xyz` responde 404; uma receita pública responde 200.
