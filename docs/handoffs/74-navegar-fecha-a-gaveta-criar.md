# Handoff 74 — Navegar fecha a gaveta "Criar"

**Sessão:** 2026-10-15. **Branch:** `claude/fix-criar-drawer-close-on-navigate-spvmxa` (sobre a main em `3be8597`, depois do #579; o 73 é o das seções da navegação, #580). **Migração:** nenhuma. Origem: relato do dono: depois de gerar uma receita na gaveta "Criar", "Ver receita" carregava a página da receita por trás, mas a gaveta e o fundo borrado ficavam na tela.

## 1. Causa

A gaveta mora no `SiteHeader` (via `LazyCreateDrawer`, handoff 70), e o header persiste entre rotas do App Router. Nada fechava a gaveta numa navegação; o próprio comentário do `LazyCreateDrawer` registrava que "com a gaveta já aberta, nada muda". Não é regressão do #578/#579: antes do handoff 70 o header montava a `CreateDrawer` direto, e ela já atravessava a navegação.

## 2. O que mudou

- **`useFecharAoNavegar`** em `src/components/recipe/create-drawer.tsx`, usado pela `CreateDrawer` (vale para o header e para o shell da `/create`):
  - o `pathname` mudou com a gaveta aberta → `onOpenChange(false)`. O `usePathname` só muda quando a navegação é montada: na receita (sem `loading.tsx` desde o handoff 71), o painel fecha junto com a chegada da página, sem mostrar a antiga no meio; nas rotas de `(com-carregamento)`, fecha quando o esqueleto aparece;
  - com a geração em voo (`generating`), não fecha (ADR-0021 dec. 5: desmontar orfanaria o `POST /api/generations`);
  - clique simples num link interno para a **própria página** (o `pathname` não mudaria) fecha na hora. Link sem locale (`/me/meal-plan`, `/sign-in`) é comparado sem o prefixo, porque o proxy o prefixa com o locale atual; link com locale é comparado inteiro. Caso real: "Pôr no cardápio" → "Ver cardápio" com a gaveta aberta sobre o próprio Cardápio. Ficam de fora a `/create` (lá `/create?mode=conversa` re-semeia a gaveta), âncoras `#`, nova aba, download e cliques com modificador.
- Comentário do `LazyCreateDrawer` atualizado; ADR-0021 ganhou a atualização de 2026-10-15.
- Testes: `test/ui/create-drawer.test.tsx` (N1–N5: "Ver receita" fecha na troca de rota, voltar/avançar fecha, geração em voo não fecha, link para a própria página fecha no clique com ou sem locale, link para outro locale ou com Ctrl não fecha no clique, link da `/create` na `/create` não fecha) e `test/ui/create-drawer-lazy.test.tsx` (gaveta aberta no header fecha ao navegar e reabre na hora). N1, N2, N4, N4b e o do header falham sem a correção. O "abrir o menu mobile pré-carrega" (handoff 70) falhava às vezes com as duas suítes em paralelo (1 em 8 na main, metade das vezes com os testes novos): o `import()` da gaveta real do teste anterior ("o foco pelo teclado") ainda estava em voo, atravessava o `resetModules`, e o teste seguinte recebia a mesma promessa sem passar pelo próprio `doMock`. O teste anterior agora espera o módulo chegar (12 em 12 verdes depois).

## 3. Links da gaveta cobertos

"Ver receita" (Prompt aberto, Estruturado e Conversa), "Ver cardápio" depois do "Pôr no cardápio", o autor (`/u/<handle>`) no resultado e "Entrar" (visitante). Ficam de fora, de propósito: "Nova conversa" (só aparece na `/create`, com a retomada que falhou, e lá re-semeia a gaveta) e a fonte de receita importada (externa, abre em nova aba).

## 4. Landmines

- O teste de `create-drawer.test.tsx` mocka `usePathname` com `null` por padrão (como sem AppRouter): o `returnTo` do "Entrar" depende disso nos testes antigos.
- Hoje nenhum fluxo da gaveta troca a URL, só links. Se um passar a trocar o `pathname` de propósito, vai fechar a gaveta.
- Fechar ao navegar descarta o que estava na gaveta sem geração em voo (prompt digitado, passo do wizard, conversa na tela; a conversa segue retomável). Casos: voltar/avançar (ou o gesto de voltar do iOS) com a gaveta aberta, e abrir o "Criar" enquanto uma navegação lenta anterior ainda não chegou. É o comportamento comum de um modal; se incomodar, o conserto é fechar só em navegações iniciadas depois de abrir.
- O header e a `/create` abrem a gaveta sem `DialogTrigger`, então ao fechar por navegação o Radix não devolve o foco ao "Criar": ele fica na página nova.

## 5. Critério de saída

"checks" verde, painel de revisão limpo; em produção, gerar uma receita na gaveta e clicar em "Ver receita" deixa só a receita na tela.
