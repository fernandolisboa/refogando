# Handoff 92 — Navegação rápida: funções em São Paulo, detalhe em duas etapas e cache do roteador

**Data:** 2026-10-23.
**PR:** "Navegação rápida entre receitas: funções em São Paulo, cache do roteador e pré-carregamento".
**Base:** `main` depois do #631.
**Migração:** nenhuma. **ADR:** ADR-0053. **Política:** v3.6 (consentimento das restrições versão `2026-10-23`).

## 1. Escopo

- **Região:** `vercel.json` → `"regions": ["gru1"]`. Antes, `iad1` (EUA) com o banco em `sa-east-1`: ~120 ms por ida
  e volta, duas por consulta no pooler. A receita levava ~1,4 s no servidor em toda navegação (medido com `curl`,
  HTML e `RSC: 1`, 2026-10-23 ~20:30 UTC); a home ~0,6 s.
- **Detalhe da receita:** `loadPublicRecipeRowBySlug` (linha inteira + gate numa query) e `loadRecipeRowsForRow`
  (`src/server/recipe/load.ts`); a página dispara tudo em paralelo depois da linha. `loadRecipeReviews` roda o gate em
  paralelo e descarta fora do pool. O vocabulário de cozinha saiu do `DetailChrome` para o lote paralelo.
- **Navegador:** `export const unstable_dynamicStaleTime = 300` na página do detalhe; `RecipeLink` (pré-carregamento
  completo no hover/toque + barra de navegação pendente) nos cards de lista; `experimental.dynamicOnHover` no
  `next.config.ts`; `.nav-pending-bar` em `globals.css`.
- **Jurídico (mesmo PR, CLAUDE.md "Privacidade"):** política v3.6 (item 5, transferência internacional; Vercel em São
  Paulo na tabela de prestadores), `restricoesPerfil.consentimento` e `avisoMudanca` nos dois idiomas, nova seção em
  `docs/legal/consentimento-restricoes.md`, `RESTRICOES_CONSENTIMENTO_VERSAO = '2026-10-23'`, `DATA_POLITICA_V3_6`,
  linha da Vercel no registro de operações, nota de atualização no §6 do parecer interno. Sem aviso de 15 dias (menos
  transferência, a favor da pessoa). Termos não mudam.
- O controle de crédito na derivada (#610) chama `router.refresh()` depois de salvar.

## 2. O que ler primeiro

1. `docs/adr/0053-navegacao-rapida-regiao-e-cache-do-roteador.md`.
2. `src/app/[locale]/recipes/[id]/page.tsx`: `unstable_dynamicStaleTime`, os `cache()` de duas etapas e o
   `Promise.all` do caminho público.
3. `src/components/recipe/recipe-link.tsx` e onde é usado (`grep -rn RecipeLink src`).
4. `test/ui/recipe-link.test.tsx`, o bloco "duas etapas" de `test/integration/recipe-public-by-slug.test.ts`, o caso
   "ADR-0053" de `test/integration/recipes-reviews.test.ts` e o de `test/ui/privacy-policy.test.tsx`.

## 3. Princípios inegociáveis

- **O cache do roteador é por aba e só no detalhe.** Não ligar `staleTimes.dynamic` global: home, Cardápio, listas e
  admin dependem de buscar a cada navegação. Para outra rota, exportar `unstable_dynamicStaleTime` nela e conferir
  que toda mutação feita ali chama `router.refresh()`.
- **Mutação na página da receita ⇒ `router.refresh()` no sucesso.** É o que limpa o cache de 5 minutos.
- **Nada de `loading.tsx`/Suspense acima do `notFound`/`permanentRedirect` do detalhe** (#578). O retorno visual do
  clique é a barra do `RecipeLink`, não um esqueleto.
- **Gate antes de devolver.** Rodar leituras em paralelo com o gate é aceito só quando o resultado é descartado fora do
  pool antes de sair da função (como em `loadRecipeReviews`).
- **Região e textos legais andam juntos.** Mudar de região muda a política (item 5) e o texto do consentimento das
  restrições (com versão nova e seção nova no registro dos textos; o teste do hash reprova se esquecer).

## 4. Landmines

- `unstable_dynamicStaleTime` e `unstable_dynamicOnHover` são APIs instáveis do Next 16.2: numa atualização, conferir
  os nomes (`node_modules/next/dist/server/app-render/app-render.js`, `getDynamicStaleTime`; `links.js`,
  `onNavigationIntent`). O tipo de `next/link` não tem a prop; o `RecipeLink` faz cast.
- Todo `vi.mock('next/link', …)` em teste de UI precisa exportar `useLinkStatus` (senão "No useLinkStatus export").
- `router.refresh()` no Next 16 invalida o cache de TODAS as rotas e o bfcache: não usar para "revalidar em segundo
  plano" a cada visita.
- Preview e produção rodam em `gru1` a partir do merge; as previews usam o branch Neon do PR, também em `sa-east-1`.
- Testes de integração locais precisam de Postgres 17 com pgvector (no 16 a migração do enum `web_imported` falha).

## 5. Critério de saída / como medir

```bash
B=https://refogando.vercel.app
for i in 1 2 3; do curl -sS -o /dev/null -H 'RSC: 1' -w "ttfb=%{time_starttransfer} total=%{time_total}\n" $B/pt-BR/recipes/ramen-shoyu; done
curl -sS -D - -o /dev/null $B/pt-BR | grep x-vercel-id   # deve começar com gru1:: no trecho da função
```

Antes (iad1): total ~1,4 s na receita, ~0,6 s na home. O resultado depois do merge está no fim da descrição do PR.

## 6. Ficou de fora

- "Voltar" do detalhe como `router.back()` quando a página anterior é do app (hoje é `href="/"`, que recarrega a
  home; o botão voltar do navegador já é instantâneo).
- `prepare:true` no pooler do Neon (cortaria a 2ª ida e volta por consulta); com o banco ao lado, o ganho ficou pequeno.
- ISR do detalhe (A passo 2) continua não recomendado.
