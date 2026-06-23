# Handoff 30 — Overhaul de UX criar/editar receita (fase de DOMÍNIO)

**Próxima fase:** `grill-with-docs` → `to-prd` → `to-issues` → dev em ondas.
**Escopo:** trazer pro APP o modal de **editar** + o drawer-wizard de **criar** que já foram prototipados no Claude Design e **espelhados** no repo. Hoje só existe a referência (`docs/design-prototype/`); **nada disso está no app.**

## Ler primeiro (não duplico aqui — está tudo nos artefatos)
- `docs/design-prototype/PARITY-PLAN.md` → 2 seções finais "Atualização — sync…" (modal + drawer): a referência mais completa.
- `docs/design-prototype/screens/RecipeFormModal.jsx` (editar, modal central) e `screens/CreateDrawer.jsx` (criar, drawer-wizard) — porte fiel do protótipo, é a referência visual/comportamental.
- Memória `criar-editar-ux-overhaul.md` (decisões + o que respeitar + nós em aberto) e `descoberta-federada-initiative.md`.
- Surfaces atuais do app a refatorar: `src/components/recipe/recipe-edit-form.tsx` (form inline ~1000–1500px = a "tela longa"), `recipe-detail-actions.tsx`, `recipe-visibility-controls.tsx`, `recipe-image-manager.tsx`; criação em `src/app/create/*` + `create-structured-experience.tsx` / `conversa-focused-view.tsx`; backend `POST /api/generations` e `PATCH /api/recipes/[id]` (`server/recipe/owner-edit.ts`).

## Estado atual (tudo na `main`, repo limpo — `40bae1e`)
- **Descoberta federada CONCLUÍDA:** PRD #158 fechado; issues #160–#169 + #181 mergeadas (PRs #170–#179, #182); migrações 0020/0021/0022; ADR-0019 + `CONTEXT.md`. #180 fechado.
- **Sync do protótipo FEITO:** PR #183 (modal) e #184 (drawer) na main.

## Direção JÁ DECIDIDA com o usuário (não re-grilar isto)
- **Editar = modal centralizado** (tarefa focada); **Criar = drawer da direita + wizard** (tarefa exploratória). Dois containers, **mesma pele**. Validado.
- **Criar = opção (1): reorganizar a GERAÇÃO POR IA.** Os 3 caminhos do drawer mapeiam aos modos que JÁ existem: Formulário estruturado→`ai_structured`, Prompt aberto→`ai_free_text`, Conversa→`ai_chat`. **Não é autoria manual.** Autoria-do-zero-sem-IA (`user_authored` + ADR) foi **DESCARTADA por ora** → sem migração de schema nesta fatia.
- **Editar a própria receita é in-place** (`PATCH`, nunca forka); o detalhe vira só-leitura (já estilo Instagram, #161).

## Nós em ABERTO — resolver no grill antes de fatiar
1. A `/create` **deixa de existir como rota** (drawer único) ou fica como **fallback/deep-link**?
2. Além do form de edição, **o que mais migra pro modal** (visibilidade? gerenciador de foto? ambos)? O que fica inline no detalhe?
3. UX de **espera/erro** do drawer com o backend **bloqueante (~8–15s, sem streaming)** + o **cap #167** (mensagem amigável ao estourar).

## Princípios inegociáveis / o que respeitar
- Drawer **substitui a UX** da `/create` mas **REUSA o backend** (`/api/generations` structured/free_text + stream da conversa). Não reescrever geração.
- **Cap de geração #167** continua valendo.
- Edição de `web_imported` **esconde "publicar"** (#168 / ADR-0019); público só p/ criadas/geradas. Foto é **invariante** (ADR-0016) + selo IA + cap.
- **Landmine:** a `/create` tem um **seam de foco/heading + ~8 testes** na máquina de "um-h1-só" (ver `PARITY-PLAN.md` → "F1 cancelado"). Mover pra drawer **mexe nessa arquitetura** — planejar heading/foco-ao-abrir/ESC/scrim do drawer e ajustar os testes com cuidado.
- `Sheet`/Dialog já existe em `src/components/ui/sheet.tsx` (Radix, com `SheetDescription` p/ a11y — ver #181) → base pronta p/ modal e drawer.

## Gotchas de ambiente
- Commits **via branch + squash PR** (nunca main direto). Merge **quando CI verde**.
- Agentes paralelos: **worktree isolado** + **hardlink** de `node_modules` (`cp -al`, nunca symlink).
- **`.env.local` É PROD** — NUNCA `db:migrate`/`db:push` local; só gerar migração e confiar no migrate-on-deploy.
- Suíte **node completa flaka** no Neon → rodar **focado** + confiar na CI. Testes UI em jsdom (projeto vitest **"ui"**, polyfills Radix em `test/ui/setup.ts`).

## Critério de saída da fase
`CONTEXT.md`/ADR atualizados se algum termo/decisão nova surgir no grill; PRD publicado; issues fatiadas (tracer-bullet) com dependências; handoff da próxima fase.

## Pendência humana (não-AFK, opcional)
Empurrar Footer/Header pro design-system remoto `b03ee466` via DesignSync `write` (gate humano) — fora da paridade do produto.

## Suggested skills
- `grill-with-docs` — abrir a fase de domínio resolvendo os 3 nós acima.
- depois: `to-prd` → `to-issues` → (dev) `tdd`/`review`/`verify`; ondas via Workflow em worktree, como na descoberta federada.
