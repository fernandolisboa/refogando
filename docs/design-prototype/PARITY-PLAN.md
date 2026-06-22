# Plano: paridade App ↔ Protótipo (Claude Design)

**Branch:** `feat/app-prototype-parity` · **Data:** 2026-06-21 · **Autor:** agente (sessão AFK)

## Contexto e diagnóstico

O protótipo no Claude Design ("Refogando Design System" `b03ee466` + "protótipo navegável" `a660ed26`) foi **engenharia-reversa do app real** — os tokens vieram de `src/app/globals.css` (#54), e o protótipo lista os componentes que já existem (`search-experience`, `recipe-detail-view`, etc.). Por isso o app já está **perto** em toda parte: a migração shadcn (ADR-0018, PR #154) trocou as primitivas por baixo mantendo "pele 100% Refogando", então **pouca coisa mudou visualmente** — exatamente o que o usuário relatou.

A exploração (8 agentes, relatório em `/tmp/.../w9hm556ex.output`) mediu o **drift concreto** entre protótipo e app, com refs `arquivo:linha`. Este plano fecha esse drift para paridade exata, **preservando todo o comportamento real** (dados, lógica, i18n, features extras) e **respeitando as carve-outs do ADR-0018**.

### Mito derrubado (verificado)
A "migração de botões inacabada (30 arquivos com `btnPrimary/btnSecondary`)" **não existe**: `btnPrimary/btnSecondary` foram removidos no ADR-0018. Os 7 arquivos que importam `@/components/button` usam só `fieldClassName` em `<select>` nativo — **carve-out intencional**. Nenhuma migração de botão a fazer.

## Escopo

**Dentro:** as 5 telas do protótipo (Home=Busca, Detalhe da Receita, Criar, Perfil público `/u/<handle>`) + o **Header** global + a fundação/componentes compartilhados que elas usam.

**Fora (não estão no protótipo):** admin/console, moderação, curadoria, edição do próprio perfil `/me/profile`, controles de versão/lineage. Essas telas **herdam** a mudança global (serifa nos headings) mas **não** são redesenhadas. `/me/recipes` (Minhas criações) herda as melhorias dos componentes compartilhados (card/grid), sem redesenho.

## Decisões (usuário AFK — decididas por mim, todas reversíveis salvo indicação)

1. **Serifa global nos headings** (maior ganho): `h1..h4 { font-family: var(--font-display) }` no `@layer base`, como no protótipo (`base.css:23`). É o principal motivo do "parece o layout antigo" — hoje a serifa só aparece onde o componente põe `font-display` à mão.
2. **Coluna de leitura 52rem** para Detalhe/Criar/Perfil (protótipo usa 52rem nessas telas editoriais; Busca/Feed seguem 72rem por serem grades). Via novo token `--container-reading: 52rem` + prop `size` no `Container`.
3. **Facetas como pill chips** (Busca + Restrições do Criar): `FacetFieldset` compartilhado vira chip arredondado que tinge de páprica quando marcado (protótipo `Checkbox.jsx`). Mantém o Radix Checkbox (a11y).
4. **Locale switcher volta pro header** (protótipo o põe no cluster direito), removido do footer. Rótulos compactos PT-BR/EN-US (são *códigos*, não copy traduzível).
5. **Avatar fica neutro (não-herb)** — DESVIO CONSCIENTE do protótipo. O `Avatar.jsx` do protótipo usa verde-erva, mas ADR-0015/README dizem que **erva é exclusiva do selo do Catálogo**. A invariante vence. Fácil de reverter se você preferir o herb.
6. **@handle mantido** sob o nome no perfil (afordância real útil; protótipo não tem). Aditivo, discreto.
7. **Selects nativos ficam nativos** (carve-out) — sem chevron custom do protótipo (low-pri, evita mexer em admin). **Avatar de domínio fica à mão** (carve-out, sem Radix swap).
8. **Remover emoji `✨`** dos selos de imagem IA (`imagemSeloIa`, `imagemGerar`) — viola a regra "no emoji" do README. Atualiza 2 locales + 2 testes. Reversível; sinalizado.

## Mudanças por área

### A. Fundação — `src/app/globals.css`
- A1. `@layer base`: add `h1,h2,h3,h4 { font-family: var(--font-display); color: var(--color-fg); }` (serifa global). [alto]
- A2. `@layer base`: add `a { color: var(--color-brand-ink); }` (links em páprica; utilities `text-*` continuam sobrescrevendo pois base < utilities). [médio]
- A3. `@layer base`: add `p { text-wrap: pretty; }`. [baixo]
- A4. `@theme`: add `--container-reading: 52rem;` (gera `max-w-reading`). [médio]
- (Sem mexer em motion/spacing: Tailwind v4 já cobre via `ease-out`/`duration-150` e escala default. Sem renomear tokens — alias é aditivo.)

### B. Header — `site-header.tsx`, `auth-slot.tsx`, `site-footer.tsx`, `locale-switcher.tsx`
- B1. ~~Mover `<LocaleSwitcher/>` pro cluster direito do header `[ThemeToggle, LocaleSwitcher, AuthSlot]`; remover do footer.~~ **SUPERSEDIDO por #162:** o `<LocaleSwitcher/>` voltou pro FOOTER (ao lado do `ThemeToggle`); o header fica `[wordmark, nav, AuthSlot]`. O espelho (`screens/Header.jsx` + novo `screens/Footer.jsx`) reflete isso. Rótulos compactos PT-BR/EN-US (computados do código de locale). [alto]
- B2. Active-route: `usePathname()` marca o link atual com `text-fg` + `aria-current="page"` (inativos `text-muted`). [médio]
- B3. AuthSlot: `Entrar` → `variant="secondary"`; `Sair` → `variant="ghost"` (mantém avatar+nome). Hierarquia silenciosa (única ação destacada = pill "Criar"). [médio]
- B4. `backdrop-blur-sm` → `backdrop-blur` (8px) pra bater com o protótipo. [baixo]

### C. Componentes compartilhados
- C1. `recipe/facet-fieldset.tsx`: pill chips (rounded-full, border, px-3 py-1.5; marcado → `bg-brand/10 border-brand text-brand-ink`). Mantém Checkbox + wiring `onToggle/selected`. [alto]
- C2. `ui/button.tsx`: size `lg` ganha `text-base` (cn/tailwind-merge resolve sobre o `text-sm` base). [médio]
- C3. `recipe/search-section.tsx`: h2 `+font-semibold`; wrapper `gap-3→gap-4`; grade `sm:grid-cols-2 lg:grid-cols-3 gap-3` → `gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]`. [médio]

### D. Busca — `recipe/search-experience.tsx`
- D1. H1 `text-3xl ... sm:text-4xl` → `text-4xl` (flat, como o protótipo). [baixo]
- (Facetas já corrigidas por C1; copy já vem do i18n e bate.)

### E. Detalhe da Receita — `app/recipes/[id]/page.tsx`, `recipe/recipe-detail-view.tsx`, `recipe/restriction-warning.tsx`
- E1. Link de volta "← Voltar à busca" como 1º filho (Link → `/`). Nova chave `detalhe.voltarBusca`. [alto]
- E2. `restriction-warning.tsx`: renderizar `<AlertTitle>` VISÍVEL (`m.detalhe.avisoTitulo`) + `<AlertDescription>`; manter `role="note"`. [alto]
- E3. Página em coluna de leitura: `Container size="reading"` (52rem); blocos do dono (imagem/visibilidade/ações) seguem na mesma coluna; prose por seção mantém `max-w-[68ch]`. [médio]
- (Ações do dono permanecem — não estripar features; agrupamento literal em 1 linha é low-pri.)

### F. Criar — `recipe/create-page-client.tsx`, `recipe/create-structured-experience.tsx`, `recipe/conversa-focused-view.tsx`, `app/create/page.tsx`
- F1. H1 persistente "Criar receita" (`m.criar.titulo`) ACIMA do toggle, em `create-page-client`, **quando não há resultado**; remover/demover os títulos internos (conversa deixa de exibir "Conversar com a IA" como heading da tela). Quando um resultado é exibido, o nome da receita é o `<h1>` (invariante 1-h1). [alto]
- F2. `Container size="reading"` no create. [médio]
- F3. "Gerar receita" → `size="lg"`; "+ Adicionar ingrediente" → `variant="ghost" size="sm"` com "+ " literal. [médio]
- (Restrições já viram chips por C1. Selects nativos mantidos. Features extras #88/#112/Força preservadas.)

### G. Perfil público — `profile/public-profile-view.tsx`, `app/u/[handle]/page.tsx`, `profile/avatar.tsx`
- G1. Grade de receitas: reusar `RecipeResultItem` (se o DTO de `GET /api/u/[handle]` tiver os campos) — senão, card inline passa a compor `<Card>` + `ProvenanceBadge` + título serif, casando com o protótipo (radius-lg, shadow-sm→md). [alto]
- G2. Link de volta "← Voltar" (nova chave `perfilPublico.voltar`, → `/`). [médio]
- G3. Links sociais: "Tipo · valor", `text-brand-ink`, sem underline. [médio]
- G4. Bio dentro da coluna do header, `max-w-[52ch]`; mantém @handle. [baixo]
- G5. `Container size="reading"` + grade auto-fill (igual C3). [baixo]
- G6. Avatar: manter neutro (decisão 5). Sem mudança de cor.

### H. i18n / testes
- H1. Add `detalhe.voltarBusca` e `perfilPublico.voltar` em `pt-BR.ts` + `en-US.ts` (paridade). 
- H2. Remover `✨ ` de `imagemSeloIa`/`imagemGerar` nos 2 locales; atualizar `test/ui/recipe-result-item.test.tsx` e `test/ui/recipe-detail.test.tsx`.
- H3. Conferir paridade de chaves novas en-US.

## Carve-outs respeitadas (NÃO mexer)
- `<select>` nativo + `fieldClassName` (testes usam `getByRole('combobox')/selectOptions`).
- Avatar de domínio à mão (sem Radix swap — flash de fallback + atrito jsdom).
- ToggleGroup `type=single` = `role=radio` (não `aria-pressed`); wrapper descarta `''`.
- Não renomear tokens `--color-*`; `muted`/`accent` ficam fora do alias.
- Nenhum botão `variant="destructive"`; âmbar só no Alert de restrição; erva só no selo do Catálogo.
- Manter features extras: Categoria facet, ResolvedQueryEcho, thumbnails/selo IA, Sugestões, smart-entry #112, toggle interno #88, Força, imagem/visibilidade/diff/regenerate, link "Painel", ThemeToggle, "Apagar conversa".

## Riscos & mitigação
- Serifa global pode mudar admin/outras telas — aceitável (é o design); conferir build/visual.
- Mover locale switcher muda a chrome — conferir wrap no mobile.
- Coluna 52rem pode apertar blocos do dono / image manager — conferir no detalhe.
- Remoção de emoji toca 2 testes + 2 locales — editar com cuidado.
- Reuso de card no perfil depende dos campos do DTO — verificar antes; fallback = card com `<Card>`.
- H1 `text-4xl` flat no mobile — conferir overflow (text-wrap:balance ajuda).

## Verificação (ordem)
1. `npm run typecheck` + `npm run lint`.
2. Suíte UI (jsdom seam) `test/ui/**` — a que cobre as telas tocadas.
3. `npm run build`.
4. Rodar o app + Playwright: screenshots das 5 telas vs protótipo (o usuário quer VER batendo).
5. Suíte node completa: confiar na CI (flaka local no Neon — memória).

## Ajustes pós-revisão (revisão adversarial, 4 lentes)

A revisão pegou 1 **blocker** e várias correções de precisão. Ajustes finais:

- **F1 CANCELADO (blocker).** NÃO hoistar um `<h1>` "Criar receita" pro `create-page-client`: o pai não conhece o estado de resultado dos filhos, os filhos têm um *seam* de foco (`headingRef`/`tabIndex`) e ~8 testes travam a máquina atual de 1-h1 (`create-structured.test`, `conversation.test`; a conversa idle propositalmente NÃO tem h1, asseverado em `conversation.test:388-389`). Mantém-se a arquitetura de heading do create como está. **Desvio consciente** do protótipo (título dentro do modo, abaixo do toggle, em vez de acima) — pelos motivos acima. As correções visíveis do create (chips, botão lg, coluna 52rem, gap-6) continuam.
- **A-novo: `container.tsx` ganha prop `size?: 'page'|'reading'`** que **seleciona condicionalmente UMA** classe (`const maxW = size==='reading' ? 'max-w-reading' : 'max-w-page'`) — NÃO confiar em `cn`/tailwind-merge (verificado: NÃO deduplica `max-w-page`/`max-w-reading`, emitiria as duas, frágil por ordem). Páginas mantêm `as="main"` **e** adicionam `size="reading"`. `--container-reading: 52rem` vai no PRIMEIRO bloco `@theme` (perto da :80), não no `@theme inline`.
- **E2 ajustado:** ao tornar `avisoTitulo` um `<AlertTitle>` visível, **remover o `aria-label={title}`** do Alert (evita nome acessível duplicado). Mantém `role="note"`.
- **H2 corrigido:** só `test/ui/recipe-result-item.test.tsx` tem o literal `✨ gerada por IA` (prop+assert, auto-contido). `recipe-detail.test`/`recipe-image-manager.test` leem do catálogo dinamicamente → não quebram. Editar: 2 catálogos + esse 1 teste.
- **C3 estendido:** add `font-semibold` ao h2 do perfil (`public-profile-view.tsx:79`) também — a serifa global (A1) só põe `font-family`, não peso.
- **G1 confirmado viável:** reusar `RecipeResultItem` no perfil sem mudar DTO (passar `autoTranslationSignal={false}`, `isOwn={false}`, sem author/image; `badgeLabels`/`busca.*` já em escopo). Remove o card inline divergente.
- **F-novo:** wrapper do create `gap-8 → gap-6` (protótipo `CreateScreen.jsx:98` usa space-6).
- **A2 (link global brand-ink):** mantido (é o intento do `base.css`/README), mas registrado como **mudança global** (recolore ~27 `<Link>` sem classe de cor; utilities `text-*` continuam vencendo). Conferir no check visual; escopar se algo destoar.
- **Nota bare-vars:** o plano NÃO porta JSX/CSS do protótipo (edita arquivos existentes que já usam utilities `--color-*`); portanto o gap "aliases shadcn como `--color-*` e não `var(--ring)` cru" fica fora de escopo. NÃO copiar JSX do protótipo que referencie `var(--ring|--input|--border|--radius)` cru.
- **shell.test.tsx:** atualizar o comentário "seletor no footer" após mover o switcher; garantir um único `combobox`.

## Critério de saída
Typecheck/lint/build verdes; testes UI verdes; as 5 telas + header batendo visualmente com `docs/design-prototype/screens/*`; features reais preservadas; handoff escrito.
