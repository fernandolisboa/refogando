# ADR-0015 — Fundação de design (Tailwind v4 + tokens) e seam de teste de frontend

Status: aceito

Até a issue #54 o app não tinha camada de apresentação: só a casca de i18n (#4) com HTML cru e **zero CSS**. Todo o trabalho anterior parou na seam de route handler/server action (ADR-0010), e a UI ficou abaixo da linha testada. Este ADR fixa as decisões de **estilo** e de **teste de frontend** que destravam as telas (#55–#63). É **stack-reversível** (ADR-0010): o sistema de tokens e o seam de teste podem trocar sem mexer no domínio.

## Estilo: Tailwind v4 (CSS-first), tokens no `@theme`

**Escolha: Tailwind v4 CSS-first**, sem `tailwind.config.js`. A config vive no CSS:

- `@import "tailwindcss"` + plugin `@tailwindcss/postcss` em `postcss.config.mjs` (Next 16 detecta sozinho; nenhuma mudança em `next.config.ts`).
- **`src/app/globals.css` é a fonte ÚNICA de verdade dos tokens**, num bloco `@theme` — que gera ao mesmo tempo as custom properties (`--color-*`, `--radius-*`, …) **e** as utilities Tailwind correspondentes (`bg-brand-strong`, `text-fg`, `max-w-page`, …). Sem segunda fonte que possa divergir.
- Importado uma vez no `src/app/layout.tsx`.

**Versões fixadas:** `tailwindcss@4.3.1` + `@tailwindcss/postcss@4.3.1` (devDeps — Tailwind é build-time). Alinha com "última estável disponível" (ADR-0010): foram **verificadas instaláveis neste ambiente** (o registry tem corte de pacotes novos; aqui instalaram hoje). Se um patch futuro 404/403, pinar o patch instalável mais novo.

**Identidade:** quente e apetitosa (refogado = base aromática) — terracota de páprica (`--color-brand`) + verde de erva (`--color-accent`, reservado ao **selo do Catálogo curado**, distinguindo confiança de Comunidade), sobre creme/massa morno. Explicitamente **não** o cinza-azulado genérico de IA.

**Acessibilidade é constraint de token.** Todos os pares fg/bg miram **WCAG AA** (≥4.5:1 corpo, ≥3:1 grande/UI) e foram **verificados por cálculo OKLCH→sRGB→contraste** antes de fixados (ex.: branco sobre `--color-brand-strong` = 6.05:1; texto secundário no creme = 5.67:1). O botão primário usa **branco sobre brand-strong escuro nos dois modos** (texto escuro sobre brand claro reprovava). **Papéis de cor de marca são separados** pra não reprovar no dark: `--color-brand-strong` é **FUNDO** de botão; `--color-brand-ink` é **TEXTO** de marca (wordmark/links) — terracota escura no claro (5.79:1), terracota clara no escuro (8.61:1). A seleção (`::selection`) usa o fundo fixo brand-strong + branco (6.05:1 nos dois modos). Foco visível via `:focus-visible` com `--color-ring`.

**Dark mode** sobrescreve as custom properties num `@media (prefers-color-scheme: dark) { :root { … } }` **fora do `@theme`** — porque o `@theme` do Tailwind v4 emite os tokens como `:root` **estáticos**; pôr os valores dark dentro dele não alterna. Overriding a custom property cascateia pras utilities (`bg-bg` etc.). Pares dark re-verificados em AA.

**Aviso de restrição** ganhou token âmbar (`--color-aviso-*`), **nunca** vermelho-bloqueio nem verde-verificado (coerente com ADR-0004: o aviso é leve, declarado-não-verificado).

## Teste de frontend: seam jsdom via Vitest `projects` (não Playwright no CI)

A #54 pedia "teste E2E (Playwright) que carrega a app, troca de locale, vê a chrome acompanhar, rodando no CI". **Desvio consciente:** o seam de CI é um **teste de componente em jsdom**, não Playwright. Motivos (aterrados): o CI atual (`ci.yml`) não roda `next build` nem sobe a app; Playwright não está no projeto; o download de browser pode bater no corte de pacotes do ambiente. O seam jsdom exercita a chrome real (LocaleProvider + LocaleSwitcher + shell) e prova "carrega → troca locale → chrome acompanha" **acima da seam de servidor**, sem Docker/Postgres/browser, em ~0,7s.

Implementação: `vitest.config.ts` vira **dois projetos** rodados juntos por `npm test`:

- **`node`** — a config original verbatim (environment node, Postgres real/descartável, serial). Só passou a **excluir `test/ui/**`**.
- **`ui`** — `environment: 'jsdom'` + `@vitejs/plugin-react` + Testing Library, **sem** globalSetup/DB; escopo `test/ui/**`.

`resolve.tsconfigPaths` fica no **topo E dentro de cada projeto** (subprojetos não herdam a config de topo no Vitest 4; a cadeia do global-setup → `@/db/schema` → `@/domain/*` só resolve `@/*` assim). Primeiro teste: `test/ui/shell.test.tsx` (renderiza o `SiteHeader` no provider, troca o seletor pt-BR→en-US, afirma que nav/auth/seletor acompanham). `next/link` é mockado pra `<a>` (sem AppRouterContext no jsdom).

Playwright fica **deferido** como opção local/não-gating: quando o CI ganhar um job que faz `next build` + `next start`, dá pra adicionar um E2E de browser de verdade.

## Notas de ambiente

- **`next build` exige `BETTER_AUTH_SECRET`** (≥32 chars): em produção o `src/lib/auth.ts` lança sem ele durante "Collecting page data". O CI/local deve prefixar a build com um secret. (O `npm test` não precisa — o seam ui não toca auth; o seam node usa `TEST_DATABASE_URL`.)
- Componentes do shell são **client** (`useLocale` + troca em runtime); o `layout.tsx` continua **server** (resolve locale no cookie/Accept-Language, emite `<html lang>` real, monta o provider) — **sem regressão de #4**. Nenhum componente da chrome chama endpoint de Receita nem `/api/me/locale` (#4.AC4 — isolamento preservado).
- Um único landmark `<main>` por documento: o `layout` envolve `children` num `<div>` flex, e cada página rende o seu `<main>`.

## Consequências

- As telas #55–#63 herdam um sistema de tokens AA, um shell responsivo e um seam de teste de UI — e devem ser construídas com `/impeccable`.
- Convenções pra downstream: superfícies de UI (painel/cartão visual) usam `--color-surface` + `--radius-lg` + `--shadow-sm` — componentes de **domínio** não se chamam Card/RecipeCard (usar nomes de Receita, CONTEXT.md). O **selo de proveniência** colore por **Proveniência**: `--color-accent`/`--color-accent-surface` só para `origin=catalog` (curado/editorial) vs neutro para `ai_*`/`user_edited`; **popularidade/Comunidade é eixo separado (Visibilidade) e NUNCA colore o selo de confiança**. Elevação tem dois passos (`--shadow-sm` chips/cards, `--shadow-md` popovers/menus). Estados vazios/erro usam tom morno, não alarmante.
- Reversível: trocar Tailwind ou o seam de teste não toca domínio/seam de servidor.
