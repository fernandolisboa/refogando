# Handoff 73 — Navegar fecha a gaveta "Criar"

**Sessão:** 2026-10-15. **Branch:** `claude/fix-criar-drawer-close-on-navigate-spvmxa` (sobre a main em `3be8597`, depois do #579). **Migração:** nenhuma. Origem: relato do dono: depois de gerar uma receita na gaveta "Criar", "Ver receita" carregava a página da receita por trás, mas a gaveta e o fundo borrado ficavam na tela.

## 1. Causa

A gaveta mora no `SiteHeader` (via `LazyCreateDrawer`, handoff 70), e o header persiste entre rotas do App Router. Nada fechava a gaveta numa navegação; o próprio comentário do `LazyCreateDrawer` registrava que "com a gaveta já aberta, nada muda". Não é regressão do #578/#579: sem o esqueleto de carregamento, só ficou mais visível (a página antiga some e a nova aparece atrás do painel).

## 2. O que mudou

- **`useFecharAoNavegar`** em `src/components/recipe/create-drawer.tsx`, usado pela `CreateDrawer` (vale para o header e para o shell da `/create`):
  - o `pathname` mudou com a gaveta aberta → `onOpenChange(false)`. Como o `usePathname` só muda quando a página nova é montada, o painel fecha junto com a chegada da receita, sem mostrar a página antiga no meio;
  - com a geração em voo (`generating`), não fecha (ADR-0021 dec. 5: desmontar orfanaria o `POST /api/generations`);
  - clique simples num link interno para a **própria página** (caminho igual sem o prefixo de locale; o `pathname` não mudaria) fecha na hora. Caso real: "Pôr no cardápio" → "Ver cardápio" com a gaveta aberta sobre o próprio Cardápio. Ficam de fora a `/create` (lá `/create?mode=conversa` re-semeia a gaveta), âncoras `#`, nova aba, download e cliques com modificador.
- Comentário do `LazyCreateDrawer` atualizado; ADR-0021 ganhou a atualização de 2026-10-15.
- Testes: `test/ui/create-drawer.test.tsx` (N1–N5: "Ver receita" fecha na troca de rota, voltar/avançar fecha, geração em voo não fecha, link para a própria página fecha no clique, link da `/create` na `/create` não fecha) e `test/ui/create-drawer-lazy.test.tsx` (gaveta aberta no header fecha ao navegar e reabre na hora). N1, N2 e N4 falham sem a correção.

## 3. Links da gaveta cobertos

"Ver receita" (Prompt aberto, Estruturado e Conversa), "Ver cardápio" depois do "Pôr no cardápio", o autor (`/u/<handle>`) no resultado, "Entrar" (visitante) e "Nova conversa". A fonte de receita importada é externa e não passa por aqui.

## 4. Landmines

- O teste de `create-drawer.test.tsx` mocka `usePathname` com `null` por padrão (como sem AppRouter): o `returnTo` do "Entrar" depende disso nos testes antigos.
- Se um fluxo da gaveta passar a trocar o `pathname` de propósito (hoje só troca query), ele vai fechar a gaveta.

## 5. Critério de saída

"checks" verde, painel de revisão limpo; em produção, gerar uma receita na gaveta e clicar em "Ver receita" deixa só a receita na tela.
