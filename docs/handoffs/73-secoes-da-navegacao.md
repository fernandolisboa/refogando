# Handoff 73 — Header em 3 seções com subabas

**Sessão:** 2026-10-15. **Branch:** `claude/project-thread-g6j5n0` (sobre a main em `3be8597`, depois do #579). **Migração:** nenhuma. Origem: o dono pediu sugestões para o header ("outros menus? alguma forma de agrupá-los?") e aprovou a proposta de 3 seções com subabas. Decisões no ADR-0043; termo **Seções da navegação** no `CONTEXT.md`.

## 1. O que mudou

- **Header:** Explorar · Minhas receitas · Planejar (o Visitante vê só Explorar), no lugar de 6 links. "Criar", sino e conta seguem no cluster direito.
- **`SectionTabs`** (`src/components/nav/section-tabs.tsx`), montada no `[locale]/layout.tsx` logo depois do `SiteHeader`, fora do header sticky: Descobrir/Seguindo/Cozinheiros, Criações/Salvos, Cardápio/Listas de compras/Despensa. Segue a largura do header (e o `xl:max-w-wide` da home com 3 colunas). Fora das seções, não renderiza.
- **Kernel puro** `src/domain/nav-sections.ts`: `NAV_SECTIONS`, `activeNav`, `matchesHref`, `sectionsFor`/`tabsFor`, `sectionEntryHref`, `parseLastTabs`. Rótulos em `src/components/nav/nav-labels.ts`.
- **Última aba lembrada** (`src/components/nav/last-tab-store.ts`, `localStorage` `refogando:nav:ultima-aba:v1`): o link de Minhas receitas/Planejar abre a última aba visitada; o valor só vira href se for aba da própria seção.
- **Drawer mobile** agrupado por seção (`role="group"` rotulado), depois "Criar" e a conta.
- **Menu da conta** sem "Listas de compras" (agora aba de Planejar).
- **Tour guiado:** passos `minhasReceitas` e `planejar` (âncoras `nav-minhas-receitas`, `nav-planejar`) no lugar de `salvos`/`cardapio`/`despensa`; 7 passos logado, 5 Visitante. Chave do tour segue `v1`.
- **Guia "Como usar"** (pt-BR e en-US) diz onde cada coisa fica ("em Planejar, na aba Cardápio"); textos do tour e do menu da conta sem as listas.
- Testes: `test/domain/nav-sections.test.ts`, `test/ui/section-tabs.test.tsx`, `test/ui/site-header-secoes.test.tsx` (substitui os testes por link `site-header-{salvos,cardapio,despensa}`); ajustes em shell, mobile, auth-slot, tour e âncoras.

## 2. Evidência

`npm run typecheck`, `npm run lint` (só os 4 avisos de `<img>` que já existiam) e a suíte `ui` inteira verdes; os testes de domínio novos e o do tour rodados à parte (a suíte `node` precisa de Postgres). Conferido na tela com `next dev` contra um Postgres local: desktop 1280 px (home logado e Visitante, Cardápio, Listas, Salvos, Cozinheiros no tema escuro), 820 px (Despensa: o header cabe numa linha) e 390 px (tira rolável e drawer agrupado). Depois de visitar a Despensa, o link "Planejar" passou a apontar para `/me/pantry`.

## 3. Landmines

- Feature nova numa seção vira **aba em `NAV_SECTIONS`**, não link no header. Rota nova que pertence a uma seção precisa estar lá para a tira e o estado ativo aparecerem.
- A tira vive no layout e lê `usePathname`: não movê-la para dentro das páginas (pularia de lugar entre páginas `reading` e `page`).
- Teste que monta o `[locale]/layout.tsx` com `next/navigation` mockado sem `usePathname` precisa mockar a `SectionTabs`, como o `locale-layout.test.tsx` já faz com ela e com o header.

## 4. Critério de saída

"checks" verde, painel de revisão limpo, PR mergeado. Em produção: header com 3 seções, tira nas 8 páginas das seções e nenhuma fora delas.

## 5. O que resta

Nada pendente desta mudança. Ideia registrada e não feita (ADR-0043, alternativas): barra de abas fixa no rodapé do celular.
