# Handoff 33 — Duas pernas PLANEJADAS e prontas pro dev: Estúdio de imagem (#221) + SEO bilíngue (#187)

**Estado:** ambas as iniciativas estão com **domínio + ADR + PRD + issues** prontos; **dev não começado** nas duas. Esta é a ponte pro dev. Escolha uma perna por sessão — **não rode os dois devs concorrentes** (ver Contenção).

## Perna A — Estúdio de imagem por IA (épico #221)

- **Domínio:** ADR-0022 (`docs/adr/0022-estudio-imagem-ia-galeria-preview-prompt-ancorado.md`, na main) + glossário `CONTEXT.md` (Galeria de imagens; Imagem da receita evoluída; Restrição do autor). Memória `image-studio-initiative.md`.
- **Stopgap de segurança JÁ na main (#214):** o abuso "prompt do usuário substitui a receita" (anime do Goku num bife) está **bloqueado** — `composeImagePrompt` ancora sempre. Esta perna **endurece** isso (template estruturado) + adiciona galeria/preview/review/custo por cima.
- **6 fatias:** **#222** spine (galeria + preview + selecionar/apagar, migração) → **#223** refino-ancorado (←222), **#224** cost-tracking (←222, migração), **#225** moderação×galeria (←222), **#226** restrição-de-conta (←222, migração), **#227** review_required + fila-Curador (←223, migração).
- **Gotcha:** #222/#224/#226/#227 têm **migração** → merges **sequenciais** (cada migração gera off a main atualizada); paralelizar só sem colidir em `schema.ts`/`image.ts`.

## Perna B — SEO + descoberta bilíngue (épico #187) — DESTRAVADA

- **Domínio:** ADR-0020 (na main) + handoff **`docs/handoffs/31-*.md`** (**untracked DE PROPÓSITO — pedido do dono, NÃO commitar**), com princípios/landmines. Memória `seo-bilingual-discovery-initiative.md`. O bloqueio (rework criar/editar) **landou** (épico #190).
- **11 fatias:** **#228** locale-no-caminho · **#229** slug (data-pure) · **#230** detalhe-por-slug + `loadPublicRecipeBySlug` (←228,229) · **#231** links-internos (←229,230) · **#232** OG (←228,230) · **#233** canônico+hreflang+robots (←230,232) · **#234** JSON-LD (←230) · **#235** sitemap (←228,229) · **#236** feed-home (←228,229) · **#237** disclosure-config (←228) · **#238** seed (**HITL/ready-for-human**, ←237).
- **Princípios inegociáveis (NÃO re-litigar):** indexação **DEFAULT-OPEN sem gate humano** (o dono reverteu gate de curadoria **2×**); **OG card SEM selo de IA**; slug congelado; locale prefix-all + raiz 302 + x-default; JSON-LD sem `aggregateRating`; seed nunca copia web. **Landmines:** Next 16 `middleware`→`proxy` (nodejs); `loadPublicRecipeBySlug` (leitura anônima/cacheável separada do dono); slug en-US do título da MT inicial; grep o `.sql` (DDL fantasma do Drizzle).

## Contenção de dev (resolver antes de paralelizar)

As duas pernas competem pela **página de detalhe** (`recipes/[id]/page.tsx`) + componentes + **ordem das migrações**. **NÃO rodar os dois devs concorrentes.** Sequenciar: uma perna mergeia inteira, a outra ramifica daí (rebase). O overhaul de criar/editar **já facilitou** (deixou a view de leitura **separável** dos controles do dono), então as `/api/*` de imagem vs as rotas-de-página `[locale]` são bem disjuntas — o atrito real é só o arquivo de detalhe + migrações. **Recomendação: SEO primeiro** (estratégico — mercado EUA, friends-test — e reestrutura o route tree; o estúdio é UI só-do-dono que encaixa nas rotas locale-izadas depois). Ordem inversa também funciona.

## Pipeline de dev (reusar — provado nas iniciativas anteriores)

Por **onda**: Workflow `parallel` de agentes `isolation:'worktree'` (implementam com TDD → PR) → Workflow de **review adversarial** (3 lentes: correção / ADR-invariantes / testes-a11y-i18n → síntese) → Workflow de **fix** (must/should-fix + regression tests) → poll de CI → **squash-merge sequencial** + cleanup de worktrees. Ondas **cruzadas** por arquivos disjuntos; **migrações sequenciais**. O review adversarial **pega bugs reais que o auto-review não vê** — vale o custo.

## Gotchas de ambiente

- Commits **via branch + squash PR**; merge **quando CI verde** (sem gate de preview; AFK = subagentes revisam).
- Worktree off `origin/main` + **hardlink** node_modules (`cp -al`, nunca symlink).
- Testar só o projeto vitest **`"ui"`** local (jsdom, sem DB — Neon flaka concorrente); integração/node → **confiar na CI**. `next build` local dá **env-blocked** (BETTER_AUTH_SECRET/DB) — não é código.
- **`.env.local` É PROD** — NUNCA `db:migrate`/`db:push` local; **só gerar** a migração + migrate-on-deploy.
- Poll de CI: o `gh` em **shell detached** (`run_in_background`) às vezes volta vazio em loops com 3+ PRs → preferir checar/mergear no foreground (`gh pr view <pr> --json mergeStateStatus`).

---

## Prompt de kickoff — SEO (recomendado primeiro)

```
Retomando o refogando: DEV da iniciativa SEO + descoberta bilíngue (épico #187), que está destravada e fatiada. Leia docs/handoffs/33-dev-phase-image-studio-e-seo-planejados.md e docs/handoffs/31-seo-descoberta-bilingue-prd187-gated-rework-criar-editar.md (untracked, NÃO commitar) + o ADR docs/adr/0020-*.md + os termos do CONTEXT.md (Descoberta/Feed, Slug, Convenção de URL). As 11 issues já existem (#228-#238); confira com gh issue list. Implemente em ondas via Workflow em worktrees isolados (TDD + review adversarial multi-lente + fix + squash-merge quando CI verde), começando pela espinha #228 (locale no caminho) e #229 (slug, data-pure) em paralelo, depois #230 (detalhe-por-slug + loadPublicRecipeBySlug), e seguindo o grafo de dependências. Migrações têm merge sequencial (cada uma gera off a main atualizada). Respeite os princípios inegociáveis: indexação DEFAULT-OPEN sem gate humano (NÃO reintroduzir curadoria/revisão antes de indexar — o dono reverteu 2×), OG card SEM selo de IA, slug congelado, JSON-LD sem aggregateRating. Landmines: Next 16 middleware→proxy (nodejs); a leitura indexável precisa do seam loadPublicRecipeBySlug (anônimo/cacheável, separado do caminho do dono). Gotchas: branch off origin/main, hardlink node_modules (cp -al), testar só o projeto vitest "ui" local, .env.local É prod (migração só gerada). NÃO comece o dev do estúdio de imagem (#221) em paralelo — as duas pernas competem pela página de detalhe + migrações.
```

## Prompt de kickoff — Estúdio de imagem (alternativa)

```
Retomando o refogando: DEV do Estúdio de imagem por IA (épico #221), domínio pronto (ADR-0022) e fatiado. Leia docs/handoffs/33-dev-phase-image-studio-e-seo-planejados.md + o ADR docs/adr/0022-*.md + os termos do CONTEXT.md (Galeria de imagens, Imagem da receita, Restrição do autor) + a memória image-studio-initiative. As 6 issues já existem (#222-#227); confira com gh issue list. O stopgap de segurança #214 já está na main (o abuso do prompt está bloqueado). Implemente em ondas via Workflow em worktrees isolados (TDD + review adversarial multi-lente + fix + squash-merge quando CI verde), começando pela spine #222 (galeria + preview + selecionar/apagar), depois os refinamentos (#223 refino-ancorado, #224 cost-tracking, #225 moderação×galeria, #226 restrição-de-conta, #227 review_required). Atenção: #222/#224/#226/#227 carregam migração → merges sequenciais. Respeite ADR-0016/0017, cap #167, moderação #133, e reuse o backend de geração (não reescreva). Gotchas: branch off origin/main, hardlink node_modules (cp -al), testar só o projeto vitest "ui" local, .env.local É prod (migração só gerada). NÃO comece o dev do SEO (#187) em paralelo — competem pela página de detalhe + migrações.
```
