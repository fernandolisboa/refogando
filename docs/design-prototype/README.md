# Refogando — Design System

**Refogando** is a bilingual (pt-BR / en-US) AI recipe app. Tagline: **"Cozinhe qualquer ideia"** ("Cook up any idea"). _Refogar_ is the aromatic base — onion, garlic, oil — that gives a dish its flavor; the brand borrows that warmth. The vibe is **home-cooked, warm, appetizing, editorial** — never the cold blue-gray of generic AI/SaaS.

Three ways to get a recipe:
1. **Search** recipes that already exist (the search _is_ the home).
2. **Create by chatting** with the AI (multi-turn conversation).
3. **Create structured** — fill fields → the AI generates.

Every recipe carries an always-visible **PROVENANCE** seal — from the curated catalog, AI-generated, or derived from a user edit. Recipes can be published to the community, voted, favorited, and have authorship with a public profile.

---

## Sources

This system was reverse-engineered from the live product, which is the single source of truth for every token, color, copy string, and component behavior. The reader is encouraged to explore these to build higher-fidelity designs:

- **Codebase** (attached, read-only): `refogando/` — a Next.js 16 + React 19 + Tailwind v4 (CSS-first `@theme`) + Drizzle/Postgres app. Key files:
  - `src/app/globals.css` — the design foundation (issue #54), origin of all tokens.
  - `src/components/recipe/` — recipe UI: `provenance-badge.tsx`, `restriction-warning.tsx`, `recipe-result-item.tsx`, `recipe-detail-view.tsx`, `search-experience.tsx`, `conversa-focused-view.tsx`, `sort-toggle.tsx`, `facet-fieldset.tsx`, `recipe-engagement-controls.tsx`.
  - `src/components/button.ts` — canonical button/field className vocabulary.
  - `src/i18n/messages/pt-BR.ts` + `en-US.ts` — all UI copy (primary pt-BR).
  - `docs/adr/` — architecture decisions; ADR-0015 governs the design foundation.
- **GitHub**: https://github.com/fernandolisboa/refogando — explore for the full app, schema, and ADRs.

> The codebase ships **no logo image and no icon set** — the brand mark is a text wordmark in a display serif, and the product UI is entirely text-driven. See ICONOGRAPHY below for how this system handles icons.

---

## CONTENT FUNDAMENTALS

**Language.** Primary copy is **pt-BR**, with en-US parity (every key exists in both locales). Recipe titles show the **original name primary, the translation in parentheses**; machine translations carry a discreet "tradução automática" mark.

**Voice.** Warm, plain-spoken, second-person ("**você**"), like a friend who cooks. Encouraging and concrete, never corporate. Examples:
- _"Comece digitando um prato, ingrediente ou estilo que você curte — ou use os filtros."_
- _"Converse para chegar na receita. Quando quiser, peça para destilar tudo numa receita pronta."_
- _"Você chegou ao fim."_

**Casing.** Sentence case everywhere — headings, buttons, labels. No ALL-CAPS, no Title Case On Buttons. Buttons are short verbs: _Buscar, Criar, Gerar receita, Votar, Favoritar, Publicar_.

**Tone of warnings.** A light touch that **informs, never blocks**. The restriction warning reads _"declarado, não verificado"_ ("declared, not verified") — it never gates reading. Errors are neutral and recoverable: _"Algo deu errado." → "Tentar de novo."_

**Provenance is sacred.** The copy is precise about where a recipe came from: _"Do catálogo" / "Da comunidade" / "Sua receita"_. Author credit is always _"por <nome>"_, linking the public profile.

**Empty/loading/error states are first-class.** Each surface has an initial-neutral hint, a loading line, an empty line, and an error + retry — all written, never blank.

**Emoji.** Avoid emoji as decoration — warmth comes from the palette and the serif. The one sanctioned exception is the ✨ sparkle on **AI affordances** (the "Gerar com IA" button and the "gerada por IA" badge), where ✨ is an established product convention for "this is AI" (revisited in #215; superseded the earlier blanket "no emoji" rule from #207).

---

## VISUAL FOUNDATIONS

**Color.** Warm cream/dough canvas + paprika terracotta + herb green, defined in **OKLCH** for perceptual uniformity. Accessibility is a token constraint — every fg/bg pair targets **WCAG AA** (≥4.5:1 body, ≥3:1 large/UI), verified by OKLCH→sRGB math.
- **Canvas** is cream `oklch(0.985 0.008 85)`; **surfaces/cards** are warm "dough" `oklch(0.965 0.012 85)`; **text** is coffee `oklch(0.26 0.02 55)`.
- **Brand** = paprika terracotta. `--color-brand` (0.62 0.17 40) is decorative/large-text; `--color-brand-strong` (0.515 0.155 38) is the **button fill** (white on top passes AA); `--color-brand-ink` is brand text (wordmark, links).
- **Accent** = herb green, **reserved for the catalog seal** (`origin=catalog`) — never used for community.
- **Warning** = **amber** `oklch(0.47 0.1 72)`, **never red**. Amber is exclusive to the restriction Alert.
- **Dark mode** is mandatory and carries the same DNA with re-verified AA.

**Type.** **System stacks only — zero network fonts** (hard product constraint). A **display serif** (Palatino / Iowan Old Style family) carries the editorial moments — the wordmark and recipe titles, set at 600 weight with -0.02em tracking. A **system sans** carries all body and UI. Headings use balanced wrap; prose caps at ~68ch.

**Backgrounds.** Flat warm color — **no gradients, no glassmorphism, no stock-photo heroes, no hand-drawn SVG illustrations, no repeating textures.** The header is the one translucent surface (95% bg + subtle blur).

**Corners & cards.** Soft, home-cooking rounding: 6 / 10 / 16 / 24px, plus full-round for restriction chips and avatars. A card is a dough surface with a hairline border, ~10–16px radius, and a low **warm-brown-tinted** shadow (`rgb(56 40 24 / 0.08)`).

**Motion.** Short and gentle. The workhorse transition is **150ms** with a soft ease-out `cubic-bezier(0.22, 1, 0.36, 1)`. Gated behind `prefers-reduced-motion`.

**Hover / press.** Filled buttons **drop opacity to ~0.9** on hover; secondary/outline buttons gain a **paprika border**; ghost buttons get a faint paprika wash. Card hover lifts shadow `sm → md`. No scale/shrink press effects.

**Focus.** A visible **2px paprika ring** with 2px offset via `:focus-visible` (keyboard, not click).

---

## ICONOGRAPHY

The Refogando codebase uses **no icons at all** — no icon font, no SVG sprite, no PNG icons, no emoji. The UI is entirely text + the serif wordmark. The product targets shadcn/ui, whose default icon pairing is **Lucide**; use icons **sparingly** (a chevron on the select, a back arrow). The only inline icon shipped is the chevron baked into `Select` (a Lucide-style caret as a data-URI). The **brand mark** is the text wordmark "Refogando" in the display serif, paprika `--color-brand-ink`. There is no logomark/symbol; do not invent one.

---

## shadcn/ui mapping (skeleton, not skin)

shadcn enters as **structure + accessibility** (Radix + Tailwind v4 + CVA); the **skin is 100% Refogando**. The shadcn token names live in `tokens/colors.css` filled with the warm palette — `--background`/`--foreground`/`--card`/`--primary`/`--secondary`/`--muted`/`--accent`/`--border`/`--input`/`--ring`/`--radius`, all OKLCH, Tailwind-v4 CSS-first. `--destructive` maps to the **amber aviso** (Refogando never uses red).

---

## This folder

This is a **local, read-only mirror** of the Claude Design project "Refogando Design System" (`b03ee466`) + the navigable prototype (`a660ed26`), pulled via the `claude_design` MCP on 2026-06-21. It is the spec the real app must match exactly.

- `tokens/` — the CSS custom properties (foundation). The app's `src/app/globals.css` is the source of truth these were derived from.
- `components/` — the 12 design-system primitives as standalone React/JSX (the exact visual spec). Each maps 1:1 to a shadcn/ui primitive in `src/components/ui/`.
- `screens/` — the navigable prototype: `Header.jsx`, `Footer.jsx`, `HomeSearch.jsx`, `RecipeDetail.jsx`, `CreateScreen.jsx`, `Profile.jsx`, `App.jsx` over `data.js`. **These are the screen layouts the app must match.** Note (#162): the language switcher lives in `Footer.jsx` (next to the theme toggle), not in the header — the header is `[wordmark, nav, account]`.
