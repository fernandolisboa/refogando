# Feed Editorial (Direção C) — `refogando-final.dc.html`

Source of truth: Claude Design project **`00bb42be-e223-4edb-b106-e59799b80ca9`**, file
**`refogando-final.dc.html`** (imported via the `claude_design` MCP, 2026-06-28). The bundled
`Refogando - Direção C.dc.html` in this folder is the **intermediate** export; the **final**
is identical to it **except the header**, documented below. The prototype was authored against
the app's exact token palette (`--color-bg`=`oklch(0.985 0.008 85)`, `--color-surface`=
`oklch(0.965 0.012 85)`, `--color-border`=`oklch(0.9 0.012 85)`, `--color-brand-ink`=
`oklch(0.515 0.155 38)`) — this is reverse-engineered parity (ADR-0018), so the mapping to
Tailwind semantic classes (`bg-bg`, `bg-surface`, `border-border`, `text-brand-ink`…) is 1:1.

## The delta: a TWO-ROW header (nav row + full-width search row)

The intermediate had a single-row header (`[Refogando] [inline search pill] [Criar] [Você]`,
no nav links). The **final** stacks two rows inside one bordered header region, and **restores
the nav links** (Explorar/Seguindo/Minhas criações) — which maps cleanly onto the real global
`SiteHeader` (row 1) + a new full-width search row beneath it. Single `border-bottom` at the
base of the header (under the search row); no divider between the rows (`gap:12px`).

Exact final `<header>` (desktop · repouso state shown; search pill differs per state):

```html
<header style="display:flex; flex-direction:column; gap:12px; padding:13px 22px; border-bottom:1px solid oklch(0.9 0.012 85); background:oklch(0.985 0.008 85);">
  <div style="display:flex; align-items:center; gap:22px;">
    <span style="font-family:serif; font-size:21px; font-weight:600; color:oklch(0.515 0.155 38);">Refogando</span>
    <nav style="display:flex; align-items:center; gap:20px;">
      <span style="font:600 13px; color:oklch(0.26 0.02 55);">Explorar</span>   <!-- active -->
      <span style="font:500 13px; color:oklch(0.505 0.025 55);">Seguindo</span>
      <span style="font:500 13px; color:oklch(0.505 0.025 55);">Minhas criações</span>
    </nav>
    <div style="margin-left:auto; display:flex; align-items:center; gap:14px;">
      <span style="font:500 13px; color:oklch(0.515 0.155 38); border:1px solid oklch(0.62 0.17 40 / 0.5); padding:5px 12px; border-radius:8px;">Criar</span>
      <span style="font:500 13px; color:oklch(0.505 0.025 55);">Você</span>
    </div>
  </div>
  <!-- ROW 2: full-width search pill. Rest state: neutral border (border). Query state: terracotta border + × clear. -->
  <div style="display:flex; align-items:center; gap:8px; width:100%; padding:10px 16px; background:oklch(0.99 0.006 85); border:1px solid oklch(0.9 0.012 85); border-radius:9999px; color:oklch(0.505 0.025 55); font:14px;">
    <svg><!-- magnifier --></svg>
    <span>Buscar pratos, ingredientes, estilos…</span>
  </div>
</header>
```

Search pill, query state (busca/vazio): `border:1px solid oklch(0.62 0.17 40 / 0.55)` (terracotta),
text `oklch(0.26 0.02 55)`, trailing `×` (`margin-left:auto`). Mobile: nav collapses to an avatar
chip; the filter trail becomes a "Filtros" button; rows go single-column compact.

## The three states (body, below the header — unchanged from intermediate)

- **Repouso · feed**: 2-col `[trilha de filtros 188px | coluna principal]`. Trail = checkbox
  rows (Cozinha/Categoria/Restrição). Main = "Em alta na comunidade" (RecipeRow editorial rows) +
  "Do catálogo" + *"Você chegou ao fim."* (italic serif).
- **Busca · resultados**: toolbar `Resultados para "X"` + `Ordenar: Relevância | Popularidade`.
  Sections "Da comunidade" / "Talvez você queira" / "Da web" (web = compact rows with a `web` chip).
- **Vazio · sem resultados**: an inner card (`border-radius:16px; bg:surface`) holding kicker
  `SEM RESULTADOS` + serif headline + body, then **TWO sub-cards**: **"Gerar receita com IA"**
  (`Gerar`, terracotta-filled, terracotta-tinted bg `oklch(0.965 0.03 45)`) **AND** **"Buscar na
  web"** (`Buscar`, outlined, neutral bg). This is the key fix vs PR #338 (which omitted card 2).

> Note: the prototype's desktop "card" (8px-radius border + shadow on a gray canvas) and the
> mobile "phone bezel" (`#1c1714; border-radius:38px`) are PARALLEL **canvas device-frames**, not
> deliverables — the phone bezel is obviously not shipped, so by symmetry neither is the desktop
> card. Reproduce the screen CONTENT on the app's existing full-bleed shell.
