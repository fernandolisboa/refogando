# Handoff 32 — Overhaul de UX criar/editar **COMPLETO** + SEO #187 **destravado**

**Fase concluída:** overhaul de UX criar/editar receita (grill → ADR → PRD → issues → dev em ondas). **Próxima fase:** SEO + descoberta bilíngue (#187), agora destravada.

## Estado (tudo na `main` — `2f61e06`)

- **Épico #190 100% CONCLUÍDO e FECHADO.** As 6 vertical slices mergeadas:
  - **#191** (PR #198) — Drawer "Nova receita": shell + Prompt aberto (`free_text`) ponta-a-ponta. `/create` virou **shell de deep-link** que abre o drawer semeado por `?q`/`?resume`/`?mode=conversa`; botão "Criar" do nav abre o drawer sem navegar; `maxDuration=60` nas rotas de geração; seam de **1-h1/foco nos componentes internos** (F1 cancelado, preservado).
  - **#192** (PR #197) — Modal de edição **in-place** (conteúdo) + página de detalhe **só-leitura**.
  - **#193** (PR #200) — Wizard Formulário estruturado de 3 passos. Extraiu o motor compartilhado `src/hooks/use-recipe-generation.ts` + `src/components/recipe/generation-result-region.tsx`.
  - **#194** (PR #201) — Caminho Conversa (stream NDJSON via `useConversationChat`; a Receita aparece no **terminal de cada turno**, não por botão).
  - **#195** (PR #199) — Visibilidade no modal (toggle **rascunho**, comita **só no Salvar** via `publish`/`unpublish` separado; fronteira `owner-edit` preservada; `web_imported`/`playful` escondem o toggle; falha parcial; **chip de status** não-clicável no detalhe).
  - **#196** (PR #202) — "Criar minha versão" (derivar não-própria) abre o **mesmo modal** em `mode=derive` (origin `user_edited`, base nunca mutada; Visibilidade/Apagar escondidos no derive).
- **Fundação (PR #189):** ADR-0021 (`docs/adr/0021-overhaul-ux-criar-editar-modal-drawer.md`) + glossário `CONTEXT.md` (Proveniência ganhou `ai_free_text`; Sessão de criação = `conversation|structured|free_text`; novo termo **Modo prompt aberto**; contraste "edição própria é in-place" na Receita derivada).

## O que ficou de follow-up (NÃO nesta entrega)

- **#188** — "Tempo de preparo" como atributo invariante da Receita (protótipo mostrava o campo, não existe no schema). `needs-triage`; precisa grill → ADR de schema → migração.
- **#203** — Bug **pré-existente** do `useConversationChat`: "Retomar" após queda de stream com texto parcial do Assistente → 400 (`ultima_fala_nao_usuario`). Afeta `ConversaFocusedView` + o drawer.
- **#204** — Refactor: migrar `CreateStructuredExperience` (a `/create`) pra consumir `use-recipe-generation.ts` + `GenerationResultRegion`, eliminando a cópia duplicada do motor (sem mudança de comportamento).
- **DesignSync remoto (#180, HUMANO/não-AFK):** o espelho LOCAL (`docs/design-prototype/screens/`) tem o modal/drawer; o push pro design-system remoto (`b03ee466`) via `write_files` pede gate humano. Agora que modal+drawer são reais no app, vale sincronizar.

## Próxima fase: SEO + descoberta bilíngue (#187) — DESTRAVADA

A iniciativa SEO estava com as **issues de implementação retidas de propósito** esperando ESTE rework landar (a espinha `[locale]` + detalhe-por-slug colidia com o route tree que o rework mexeu). **A condição agora é satisfeita.**

**Leia primeiro (na ordem):**
1. `docs/handoffs/31-seo-descoberta-bilingue-prd187-gated-rework-criar-editar.md` — **handoff completo da SEO, untracked DE PROPÓSITO (pedido do dono — não commitar)**, com o plano de 10 fatias, dependências, princípios inegociáveis e o **kickoff pronto** no fim.
2. PRD na issue **#187** (`gh issue view 187 --comments`).
3. ADR-0020 (`docs/adr/0020-url-bilingue-locale-no-caminho-slug-indexacao-default-open.md`) + os termos novos do `CONTEXT.md` (Descoberta/Feed, Slug, Convenção de URL).

**Ação:** re-rodar **`/to-issues` a partir do #187**, ciente do **route tree FINAL** pós-rework:
- `/create` é um **shell de deep-link** (não tela cheia) que abre o drawer — a espinha `[locale]` embrulha rotas estáveis.
- A página de detalhe é **só-leitura** com a edição num modal; a **view de leitura foi mantida separável dos dados/controles do dono** — exatamente pra facilitar o seam **`loadPublicRecipeBySlug`** (leitura anônima/cacheável, fatia 2b do #187). A fatia de links internos mira os componentes do drawer/modal pós-rework, não os antigos.

**Princípios inegociáveis da SEO (do handoff #31 — NÃO re-litigar):** indexação **DEFAULT-OPEN sem gate humano** (o dono reverteu gate de curadoria 2×); **OG/social card SEM selo de IA**; slug congelado; locale no caminho prefix-all + raiz 302 + x-default; seed do catálogo com nosso-AI+curadoria (nunca copiar web); JSON-LD sem `aggregateRating`. Publicar as fatias com `ready-for-agent` (exceto a fatia 10/seed = HITL).

## Padrão de pipeline desta sessão (reusar na SEO)

Por **onda**: Workflow `parallel` de agentes `isolation:'worktree'` (implementam com TDD → PR) → Workflow de **review adversarial** (3 lentes: correção / ADR-invariantes / testes-a11y-i18n → síntese por PR) → Workflow de **fix** (must/should-fix com regression tests) → **poll de CI em background** → squash-merge sequencial + cleanup de worktrees. **Ondas cruzadas** pra evitar conflito (agrupar issues por arquivos disjuntos). O review adversarial **pegou bugs reais que o auto-review não viu** (perda-de-dados no ESC, orfanar geração, destilar quebrado, perda silenciosa no derive) — vale o custo.

## Gotchas de ambiente

- Commits **via branch + squash PR** (nunca main direto). Merge **quando CI verde** (sem gate de preview; AFK = sem gate humano).
- Worktree isolado **off `origin/main`** + **hardlink** node_modules (`cp -al`, nunca symlink — symlink quebra Next/Turbopack).
- Testar só o projeto vitest **`"ui"`** local (jsdom, sem DB — evita o flake do Neon); confiar na CI pra suíte node/integração. `next build` local dá **env-blocked** (`BETTER_AUTH_SECRET`/DB ausente) — não é código.
- **`.env.local` É PROD** — NUNCA `db:migrate`/`db:push` local; só gerar migração e confiar no migrate-on-deploy.
- **Next.js 16:** `middleware` → **`proxy`** (`proxy.ts`, runtime nodejs) — relevante pra espinha `[locale]` da SEO.

## Critério de saída desta fase

Atingido: ADR/CONTEXT mergeados; PRD #190 publicado e fechado; 6 issues fatiadas, implementadas, revisadas e mergeadas; follow-ups arquivados; este handoff escrito.

---

## Prompt de kickoff (copiar e colar numa sessão nova)

```
Retomando o refogando. O overhaul de UX criar/editar receita foi CONCLUÍDO (épico #190 fechado, 6 fatias #191-#196 mergeadas na main 2f61e06; ver docs/handoffs/32-criar-editar-overhaul-completo-seo-destravado.md). Isso DESTRAVOU a iniciativa SEO + descoberta bilíngue, cujas issues estavam retidas esperando o rework landar. Leia primeiro docs/handoffs/31-seo-descoberta-bilingue-prd187-gated-rework-criar-editar.md (handoff completo da SEO, untracked de propósito — NÃO commitar), depois o PRD na issue #187 (gh issue view 187 --comments) e o ADR docs/adr/0020-url-bilingue-locale-no-caminho-slug-indexacao-default-open.md + os termos novos do CONTEXT.md. A condição de desbloqueio ("rework de Criar/Editar landou na main") agora é TRUE — confirme com git log e siga. Rode /to-issues a partir do #187 pra fatiar a iniciativa nas vertical slices da seção "O plano (10 fatias)" do handoff #31, AGORA cientes do route tree final: /create é shell de deep-link que abre o drawer; a página de detalhe é só-leitura com edição em modal e a view de leitura foi mantida separável dos controles do dono (facilita o seam loadPublicRecipeBySlug, fatia 2b). A fatia de links internos mira os componentes do drawer/modal pós-rework. Respeite os princípios inegociáveis com destaque para: indexação DEFAULT-OPEN sem gate humano (o dono já reverteu gate de curadoria 2×) e OG/social card SEM selo de IA. Publique as issues com ready-for-agent (exceto a fatia 10/seed = HITL). Depois, dev em ondas via Workflow em worktrees isolados (TDD + review adversarial multi-lente + fix + squash-merge quando CI verde), o mesmo pipeline da onda de criar/editar. Gotchas: branch off origin/main, hardlink node_modules (cp -al), testar só o projeto vitest "ui" local, .env.local É prod (nunca db:migrate local), Next 16 middleware→proxy.
```
