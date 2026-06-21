# Handoff 29 — Paridade App ↔ Protótipo (Claude Design)

**Data:** 2026-06-21 · **Branch:** `feat/app-prototype-parity` · **Base:** `origin/main` `e36b3b8` (ADR-0018 shadcn)

## O pedido

Você importou um protótipo do Claude Design via MCP, mas "quase tudo no app continuava com o layout antigo — pouca coisa mudou". Você queria ver no app real **exatamente** as mesmas telas/componentes do protótipo, seguindo o fluxo de sempre (exploração → plano → revisão do plano → ajustes → implementação → revisão da implementação → correções), com decisões tomadas por mim (você estava AFK) e tudo documentado.

## O diagnóstico (a parte que explica o "pouca coisa mudou")

O protótipo no Claude Design **foi engenharia-reversa do próprio app** (o `readme.md` do design system diz isso; os tokens vieram de `src/app/globals.css` #54). A migração shadcn (ADR-0018, PR #154) trocou as primitivas por baixo mantendo "pele 100% Refogando" — então **visualmente quase nada mudou de propósito**. O app já estava perto do protótipo em toda parte; o trabalho real era **fechar o drift** tela a tela até a paridade exata, preservando todo o comportamento real e respeitando as carve-outs do ADR-0018.

**Mito derrubado (verificado):** NÃO havia "migração de botões inacabada com `btnPrimary/btnSecondary`". Esses exports foram removidos no ADR-0018; os 7 arquivos que importam `@/components/button` usam só `fieldClassName` em `<select>` nativo (carve-out intencional). Zero migração de botão a fazer.

## O que foi feito (merge nesta branch)

Espelho local do protótipo em **`docs/design-prototype/`** (tokens, 12 componentes, 6 telas + `data.js`, `README.md`, `PARITY-PLAN.md`) — a fonte da verdade que o app precisa bater. Screenshots do app real em `docs/design-prototype/screenshots/` (claro + escuro).

Mudanças no app (24 arquivos `src/`/`test/`/config):

**Fundação** (`globals.css`): serifa de display **global** em `h1..h4` (antes só onde o componente punha `font-display` à mão — esse era o maior motivo do "parece o layout antigo"); `p { text-wrap: pretty }`; novo token `--container-reading: 52rem` (→ utility `max-w-reading`). **NÃO** há `a { color }` global (ver Decisões/Regressão).

**Container** (`container.tsx`): nova prop `size?: 'page'|'reading'` que **seleciona UMA** classe de max-width (não confia em tailwind-merge, que não deduplica `max-w-page`/`max-w-reading`).

**Header** (`site-header.tsx`, `auth-slot.tsx`, `site-footer.tsx`, `locale-switcher.tsx`): seletor de idioma **movido do footer pro header** (cluster direito `[tema, idioma, auth]`, rótulos compactos PT-BR/EN-US); link de nav **ativo** via `usePathname` (rota atual = `text-fg` + `aria-current`); `backdrop-blur` (8px); `Entrar` → secondary, `Sair` → ghost (header silencioso, única ação destacada = pill "Criar"); `<nav>` ganhou `flex-wrap` (não estourar no mobile).

**Componentes compartilhados**: facetas viram **pill chips** que tingem de páprica quando marcadas (`facet-fieldset.tsx` — afeta Busca **e** Restrições do Criar); `search-section.tsx` h2 semibold + grade `auto-fill minmax(240px,1fr)` gap-4; `ui/button.tsx` size `lg` ganha `text-base`.

**Busca** (`search-experience.tsx`): h1 `text-4xl` flat.

**Detalhe** (`recipes/[id]/page.tsx`, `recipe-detail-view.tsx`, `restriction-warning.tsx`): link **"← Voltar à busca"** (novo `detalhe.voltarBusca`); Alert de restrição com **título âmbar visível** (`AlertTitle`); coluna de leitura 52rem; h1 `text-4xl` flat.

**Criar** (`create/page.tsx`, `create-page-client.tsx`, `create-structured-experience.tsx`): coluna 52rem; wrapper `gap-6`; "Gerar receita" size `lg`; "+ Adicionar ingrediente" ghost sm.

**Perfil** (`u/[handle]/page.tsx`, `public-profile-view.tsx`): link **"← Voltar"** (novo `perfilPublico.voltar`); bio + links movidos pra coluna do header (bio 52ch); links sociais **"Tipo · valor"** em tinta de marca, sem sublinhado; h2 semibold; grade auto-fill; coluna 52rem.

**i18n**: novos `detalhe.voltarBusca` e `perfilPublico.voltar` (pt-BR + en-US); **emoji `✨` removido** de `imagemSeloIa`/`imagemGerar` (regra "no emoji" do README) nos 2 locales + teste literal atualizado.

## Decisões que tomei por você (todas reversíveis)

1. **Serifa global** nos headings — maior ganho visual, igual ao `base.css` do protótipo.
2. **Coluna de leitura 52rem** em Detalhe/Criar/Perfil (telas editoriais); Busca/Feed seguem 72rem (grades).
3. **Idioma no header** (o protótipo o põe lá; o app o tinha no footer). Removido do footer.
4. **Avatar fica NEUTRO** (não verde-erva) — **DESVIO CONSCIENTE**: o `Avatar.jsx` do protótipo usa erva, mas ADR-0015/README reservam erva **exclusivamente** pro selo do Catálogo. A invariante venceu. Se preferir o herb no avatar, é um toque pra reverter.
5. **`@handle` mantido** sob o nome no perfil (útil; protótipo não tem). Aditivo.
6. **Emoji `✨` removido** dos selos de imagem IA (viola "no emoji"). Reversível se quiser mantê-lo.
7. **Selects nativos ficam nativos** e **avatar de domínio fica à mão** (carve-outs ADR-0018 — não mexi).

## Desvios conscientes do protótipo (documentados, NÃO são bugs)

- **Título do Criar fica DENTRO do modo, abaixo do toggle** (protótipo: "Criar receita" acima do toggle). A revisão adversarial vetou hoistar o h1 pro pai: quebraria o seam de foco (`headingRef`) e ~8 testes que travam a máquina de 1-`<h1>`. Mantive a arquitetura atual.
- **Botões `ghost` usam `text-foreground`** (não a tinta de marca do protótipo) — escolha do ADR-0018; mudar globalmente afetaria o ThemeToggle. Afeta "+ Adicionar" e "Sair" (ficam discretos).
- **Avatar neutro** e **`@handle`** (decisões 4 e 5).
- **Alert de restrição** usa título VISÍVEL em vez de `aria-label` (lê mais limpo; sem nome duplicado).

## Regressão pega na revisão (e corrigida)

A revisão adversarial de 4 lentes pegou um **HIGH**: eu tinha adicionado `a { color: brand-ink }` global. Uma regra `a {color}` direta **vence a herança**, então os links de nav inativos e os bylines (que herdavam `text-muted` do pai) viravam páprica — matando o contraste ativo/inativo. **Corrigido removendo a regra global** (o preflight do Tailwind volta a dar `a { color: inherit }`; nav/byline herdam muted; os links que devem ser páprica põem `text-brand-ink` explícito). Confirmado nos screenshots (nav "Home/Recipes" muted; byline "by Fernando Lisboa" muted).

## Verificação

- `npm run typecheck` ✓ · `npm run lint` ✓ · `npx vitest run test/ui` ✓ **353/353** · `npm run build` ✓.
- **Visual** (Playwright no dev server, claro + escuro): Home/Busca, Criar, Detalhe da Receita, Perfil — batem com o protótipo. Screenshots em `docs/design-prototype/screenshots/`.
- Suíte node completa: confiei na CI (flaka local no Neon — gotcha conhecido).

## Landmines / gotchas para a próxima sessão

- **Bug PRÉ-EXISTENTE (fora desta mudança):** o `/recipes/[id]` loga um **hydration mismatch** vindo de `RecipeDetailActions` (a seção anônima "Sign in to do this" / `aria-labelledby="convite-titulo"`). É render dependente de sessão (server ≠ client), em arquivo que **NÃO** toquei. Vale um fix separado (ex.: render só client da seção de convite, ou suppressHydrationWarning pontual). Não é regressão desta branch.
- `usePathname()` é **null** fora do contexto de router (seam jsdom) — o `navLink` já é null-safe; mantenha isso em novos usos.
- A prop `size` do `Container` deve **selecionar uma classe** (ternário), nunca passar `max-w-*` por `className` confiando no merge.
- `--container-reading` vai no **primeiro** `@theme` (não no `@theme inline`, que é só `--color-*`).
- Não copie JSX/CSS do protótipo que referencie `var(--ring|--input|--border|--radius)` cru — no app os aliases shadcn são chaves `--color-*` do `@theme inline`, não vars `:root` cruas.

## Follow-ups NÃO feitos (candidatos)

- Corrigir o hydration mismatch do `RecipeDetailActions` (pré-existente).
- Se quiser paridade total do `ghost`: mudar a variante pra `text-brand-ink` (avaliar impacto no ThemeToggle).
- Disclosure/menu de nav no mobile (o comentário do header já antecipa "quando a nav crescer"; hoje resolvido com `flex-wrap`).
- Menu de criação com "Criar receita" como h1 acima do toggle exigiria elevar o estado de resultado dos filhos pro pai (refator + reescrever testes) — só se a posição do título importar.

## Rodada 2 — feedback "tem que aparecer EXATAMENTE igual"

O usuário cobrou exatidão e não consegue abrir previews (sempre dá erro). Fechei mais deltas e fui honesto sobre os que conflitam com regras do próprio codebase:

**Fechados (exatos agora):**
- **ThemeToggle saiu do header pro footer** → o cluster direito do header ficou `[idioma, conta]`, igual ao protótipo (`Header.jsx`). `initialTheme` agora é threadado pro `SiteFooter` (layout.tsx). Dark mode continua (toggle no footer + @media do SO).
- **Botões `ghost` agora usam `text-brand-ink`** (páprica), como o protótipo (`Button.jsx`). Afeta "+ Adicionar", "Sair" e o ícone do ThemeToggle. Test-safe (ui-button.test não fixava a cor do texto do ghost).

**NÃO fechados — conflitam com regras testadas do codebase (decisão do usuário pra mudar):**
- **Avatar verde (herb):** o mock do Claude Design usa iniciais verdes, MAS o codebase tem invariante TESTADA (`test/ui/ui-avatar.test.tsx`: "NUNCA bg-accent") de que o verde-erva é EXCLUSIVO do selo do Catálogo (ADR-0015/0018). Mantive o avatar NEUTRO (honra a regra testada). Pra ter avatar verde: mudar `ui/avatar.tsx` + `profile/avatar.tsx` + reescrever a asserção do teste + nota no ADR. **Aguarda OK do usuário** (raramente visível — quem tem foto não cai no fallback).
- **Título do "Criar" acima do toggle:** o protótipo tem `[título][toggle][corpo]`. No app o título fica `[toggle][título][corpo]`. Pôr o título acima exige ou (a) elevar o título pro pai (quebra o seam de foco `headingRef` dos filhos + ~10 asserções de teste que renderizam os filhos isolados) ou (b) mover o toggle pra dentro dos filhos (quebra a persistência de foco do toggle ao trocar de modo). **Ambos são regressões reais de a11y de teclado** que o mock simplificado não tinha. Mantido `[toggle][título]`. A tela Criar carrega TODA a linguagem visual (serifa, chips, coluna 52rem, botão lg, ghost "+").

**Diferenças que sobram = features REAIS que o mock simplificado não tem** (não são "layout antigo"): no header logado, avatar+nome+"Sair" (o mock tem só um "Você" ghost — mas precisamos de sign-out e do avatar #126); thumbnails/selo-IA + faceta Categoria + seção Sugestões na Busca; hero de imagem + tags + notas + controles do dono no Detalhe; smart-entry + força + toggle interno no Criar; link "Painel" (curador). Removê-las = apagar funcionalidade real.

Screenshots atualizados (claro, com o header novo) em `docs/design-prototype/screenshots/` (home/recipe-detail/create/profile).

## Como fechar

Branch `feat/app-prototype-parity` → PR. Squash-merge quando a CI ficar verde (padrão solo, sem gate de preview). Não há issue de tracker associada (é follow-up do ADR-0018, a partir do seu relato).
