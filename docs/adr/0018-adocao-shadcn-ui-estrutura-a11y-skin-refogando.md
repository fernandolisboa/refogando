# ADR-0018 — Adoção do shadcn/ui (estrutura + a11y) com skin 100% Refogando

Status: aceito

A #54 (ADR-0015) fixou a **fundação de design** (Tailwind v4 CSS-first, tokens OKLCH AA no `@theme`, seam de teste jsdom). As telas que vieram depois (#55–#63, #126–#134) foram construídas com **componentes feitos à mão** e um vocabulário de `className` canônico em `src/components/button.ts` (`btnPrimary`, `btnSecondary`, `fieldClassName`). Isso entregou as telas, mas sem uma camada de **primitivas acessíveis reutilizáveis**: `Select`, `Checkbox`, `ToggleGroup` e afins foram reimplementados ad-hoc, sem semântica ARIA/teclado de referência, e o estilo de botão/campo vive como string solta que cada call-site recopia.

Este ADR adota **shadcn/ui** como essa camada — **estrutura + acessibilidade**, não pele. É a evolução natural de ADR-0015, não uma troca de fundação: os tokens da #54 continuam a **fonte única de verdade**.

## Decisão

**shadcn/ui entra como esqueleto (Radix UI + CVA + `cn()`); a pele é 100% Refogando.**

- **Primitivas** em `src/components/ui/*` (Button, Input, Textarea, Label, Checkbox, Select, Badge, Alert, ToggleGroup, Avatar, Card). Cada uma é a estrutura padrão do shadcn (Radix para comportamento/ARIA, `class-variance-authority` para variantes, `cn()` para merge de classes) **pintada com os tokens quentes** da #54 — nunca com o slate padrão do shadcn.
- **Dependências** (verificadas instaláveis neste ambiente, corte de registry respeitado — ADR-0010/0015): `radix-ui@1.6.0` (monopacote unificado), `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.6.0`, `lucide-react@1.21.0`, `tw-animate-css@1.4.0`. Ícones: **Lucide**, traço fino, usados com parcimônia (chevron do Select, sol/lua do tema, ações) — o produto não tinha icon set; Lucide é um pareamento escolhido, coerente com o default do shadcn.
- **`src/components/button.ts` é deprecado** em favor de `<Button>`/`<Input>`/`<Textarea>`. Mantido enquanto os call-sites migram; removido quando o último sair.

## Arquitetura de tokens: camada de alias shadcn, **aditiva** (sem regressão)

O sistema de design importado (reverse-engineering do `globals.css`) já mapeia os nomes do shadcn (`--background`, `--primary`, `--muted`, `--accent`, `--destructive`, …). Trazê-los para o `globals.css` esbarra em **duas colisões reais** com o vocabulário existente, que o codebase usa em massa:

- **`muted`** — no codebase `--color-muted` é **texto secundário** (café), gerando `text-muted` (≈119 usos). No shadcn `muted` é uma **superfície** e o texto secundário é `muted-foreground`.
- **`accent`** — no codebase `--color-accent` é **verde de erva, reservado ao selo do Catálogo** (`origin=catalog`, invariante de ADR-0015). No shadcn `accent` é a superfície neutra de hover/realce (item de Select, hover de ghost).

**Decisão: camada de alias aditiva, não substitutiva.** Mantemos **todos** os utilitários `--color-*` existentes (zero regressão nos componentes provados em AA) e adicionamos um segundo bloco `@theme inline` com os nomes do shadcn que **não colidem**, apontando para os mesmos tokens quentes:

```
--color-background          → var(--color-bg)
--color-foreground          → var(--color-fg)
--color-card / -foreground  → var(--color-surface) / var(--color-fg)
--color-popover / -fg       → var(--color-surface) / var(--color-fg)
--color-primary / -fg       → var(--color-brand-strong) / var(--color-on-brand)
--color-secondary / -fg     → var(--color-surface) / var(--color-fg)
--color-muted-foreground    → var(--color-muted)        (= mesmo café do text-muted atual)
--color-destructive / -fg   → var(--color-aviso-fg) / var(--color-on-brand)   (âmbar, nunca vermelho)
--color-input               → var(--color-border)
```

As duas colisões ficam **deliberadamente fora do alias**: `--color-muted` segue = texto, `--color-accent` segue = erva. As primitivas **não usam `bg-muted` nem `bg-accent` nus** — onde o shadcn padrão usaria `bg-accent` para realce (hover de ghost, item de Select), usamos a **lavagem de páprica** `bg-brand/10` (o readme do design system pede exatamente isso para ghost), preservando a erva exclusiva do selo de confiança. O `@theme inline` resolve os utilitários direto nas vars base (sobrescritas no dark), então `bg-primary`/`text-muted-foreground`/`bg-destructive` herdam o dark mode automaticamente, sem `dark:`.

O `@theme` base ganha só dois tokens novos (`--font-mono`, `--shadow-lg`). A escala de tipo (`text-xs…5xl`) e de espaço (4px) **já são default do Tailwind v4 com os mesmos valores** do design system — não duplicamos.

## Dark mode: classe `.dark`/`.light` + a query OS (toggle manual real)

A #54 só tinha `@media (prefers-color-scheme: dark)` — escuro acompanhava o SO, sem controle do usuário. Adicionamos um **toggle**:

- `globals.css`: além da `@media`, classes `.dark` e `.light` (mesmos valores), e `@custom-variant dark` (classe) para `dark:` pontual. Ordem de fonte garante a precedência correta: cookie ausente → SO decide (`@media`); cookie explícito → `.dark`/`.light` vencem (mesma especificidade, vêm depois), inclusive `.light` derrota a `@media` quando o usuário força claro sob um SO escuro.
- `layout.tsx` (server) lê o cookie `theme` e emite `<html class="dark|light|">` — **SSR sem flash**, consistente com o render do cliente (mesmo padrão do locale, #4).
- `ThemeToggle` (client, no header, ao lado do seletor de idioma) grava o cookie e alterna a classe no `documentElement`. Sol/lua em Lucide.

## Teste

As primitivas têm teste de componente no seam jsdom `test/ui/**` (ADR-0015): render + variantes + a11y básica (role/aria, foco/teclado nas que usam Radix). O seam **node** (domínio/integração, Postgres) não é tocado. Localmente roda-se o seam ui + typecheck + lint + `next build`; a suíte node completa fica para o CI (Postgres descartável flaka em concorrência — nota de ambiente).

## Consequências

- Telas novas e refatoradas compõem `<Button>/<Input>/<Select>/<Badge>/<Alert>/<ToggleGroup>/<Avatar>/<Card>` em vez de strings de `className` — uma fonte por primitiva, a11y de referência (Radix), variantes tipadas (CVA).
- **Invariantes de ADR-0015 preservados:** erva só no selo `origin=catalog`; âmbar (não vermelho) no aviso; brand-strong=fundo / brand-ink=texto de marca; foco visível; nomes de componente de **domínio** continuam por Receita (o primitivo genérico `ui/card.tsx` existe, mas `recipe-result-item` **compõe** `Card` sem virar "RecipeCard").
- **Reversível como ADR-0010 pede:** a camada de alias é aditiva; remover o shadcn é apagar `ui/*` e o bloco `@theme inline` — os tokens e o vocabulário `--color-*` originais ficam intactos.
