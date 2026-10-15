# Handoff 72 — 404 de verdade no perfil público

**Sessão:** 2026-10-15. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `938ae31`, depois do #578). **Migração:** nenhuma. Origem: a landmine do handoff 71 (§7): `/{locale}/u/<handle>` respondia 200 com a tela de "não encontrado" para handle inexistente ou conta desativada. O dono pediu para "corrigir na mesma linha".

## 1. O que mudou

- **`u/` saiu do grupo `(com-carregamento)`** (`git mv` para `src/app/[locale]/u/`), pelo mesmo motivo de `recipes/` no handoff 71: o `loading.tsx` do grupo abre um Suspense que manda o HTML com 200 antes de o `notFound()` da página rodar. Fora do grupo, o render decide antes do primeiro byte. URLs não mudam; a tabela de rotas do `next build` é a mesma (`ƒ /[locale]/u/[handle]`).
- **`<Suspense>` sem fallback** em volta do conteúdo do perfil, abaixo do `notFound()`, como fronteira de hidratação (o mesmo papel do `DetailChrome` da receita). Nada ali suspende, então o perfil sai inteiro no HTML.
- Comentários do `loading.tsx` do grupo, do `[locale]/layout.tsx` e do topo de `u/[handle]/page.tsx` dizem que ficam fora do grupo `recipes/` e `u/`.
- `test/unit/recipe-route-status.test.ts` passou a travar também `u/` e `u/[handle]/` (nenhum `loading.*` neles; o grupo não tem `u/`).

## 2. Evidência

`next build` + `next start` local contra o Postgres da 5433 (banco `repro_detail`):

| Request | Antes | Depois |
|---|---|---|
| `/pt-BR/u/pessoa-owner` | 200 | 200 |
| `/en-US/u/pessoa-other` | 200 | 200 |
| `/pt-BR/u/nao-existe` | 200, "não encontrado" (soft 404) | **404**, mesma tela |

As rotas da receita seguem como no handoff 71 (308 no UUID legado, 404 no privado e no inexistente, 200 no público), e as do grupo seguem 200 com o esqueleto. Com o cookie `theme=dark`, perfil e 404 ficam escuros e sem erro de página (Playwright, 3 rodadas cada).

## 3. O que muda para quem vê

O mesmo trade-off da receita: numa navegação no client para um perfil, o esqueleto de carregamento não aparece mais; a página anterior fica na tela até o perfil chegar (o perfil faz uma leitura só, `loadPublicProfile`).

## 4. Landmines

- Não pôr `loading.tsx` nem `<Suspense>` acima do `notFound()` de `u/[handle]` ou de `recipes/[id]`, nem no `[locale]/layout.tsx`: o status volta a ser 200. O teste estrutural pega isso; o status em si só aparece em build de produção (`next start`), nunca no dev.
- Rota nova vai para dentro de `(com-carregamento)/`. Só fica fora a rota que precisa de 404/308 de verdade.

## 5. Critério de saída

"checks" verde, painel de revisão limpo, e em produção `/pt-BR/u/<handle inexistente>` responde 404 enquanto um perfil existente responde 200.

## 6. O que resta

Nenhum `notFound()` dentro do grupo: o perfil era o último soft 404. Os `redirect()` que seguem no grupo (`admin/`, `conversation/` legado, `verify-email/`) continuam sendo resolvidos no cliente com 200; são páginas privadas ou de fluxo, sem efeito em busca, e ficaram como estão. A proposta do 2º passo do A (`docs/perf/2026-10-14-a-passo2-isr-detalhe-proposta.md`) segue esperando as decisões do dono.
