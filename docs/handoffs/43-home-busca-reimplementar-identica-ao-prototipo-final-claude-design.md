# Handoff 43 — Re-implementar a home/Busca IDÊNTICA ao protótipo FINAL do Claude Design (`refogando-final.dc.html`)

## TL;DR / Escopo

O dono **REPROVOU o layout do PR #338** (mergeado na `main` `ca3d3ad`). O *comportamento* está certo, mas a **estrutura do shell está errada** — não bate com o protótipo. O dono atualizou o projeto no Claude Design e quer o app real **EXATAMENTE igual** ao novo arquivo **`refogando-final.dc.html`**.

A nova sessão deve: **importar/sincronizar o Claude Design** → **plano** → **plan-review multi-lente** → **ajustes** → **implementação (TDD em worktree)** → **code-review multi-lente** → **ajustes do review** → **validação final + merge**. O dono pediu CADA passo de propósito: são checkpoints pra garantir que os subagentes trabalham certo e o resultado fica idêntico ao protótipo. **Não pular passos.**

Fonte de verdade do layout: **`refogando-final.dc.html`** (importar pelo MCP — prompt no fim deste doc). Os 3 estados (feed/repouso · busca · vazio) estão nos screenshots que o dono colou na sessão de origem.

## O que está ERRADO no PR #338 (o dono apontou, com base nos 3 screenshots)

1. **Header UNIFICADO numa linha só.** O protótipo tem `[Refogando (wordmark serif terracota)] [busca PILL larga e centrada] [Criar (pílula com borda)] [Você]` TUDO no mesmo header, com borda inferior. No PR #338 a busca ficou **solta no corpo** (abaixo do `SiteHeader` global) e o `SiteHeader` **não tem busca**. → *"a posição do search box tá errada"*.
2. **Trilha de filtros ABAIXO do header, sob a wordmark.** O layout é `[header full-width] / [trilha à esquerda | conteúdo à direita]`. No PR #338 a trilha entra num grid 2-col mas **sem** o header unificado em cima dela. → *"os filtros laterais ficam embaixo do link da brand Refogando"*.
3. **Estado VAZIO com DOIS cards.** O protótipo mostra **"Gerar receita com IA"** (botão `Gerar`, terracota cheio) **E** **"Buscar na web"** (botão `Buscar`, contornado). O PR #338 **omitiu** o card "Buscar na web" (pela guarda C2b — ver tensão abaixo). O protótipo FINAL quer **os dois**.
4. **Tudo dentro de um CARD/moldura** creme bordado (cantos arredondados, borda sutil, fundo levemente off-white) — o "frame do app".

## O que do PR #338 PODE/DEVE ser reaproveitado (NÃO jogar fora — é trabalho de paridade, não reescrita)

- **Linhas editoriais** (`src/components/recipe/recipe-result-item.tsx`): kicker de proveniência + título serif grande à esquerda + imagem paisagem 3:2 à direita + selo "gerada por IA" em pílula branca. **Batem o mock.** ✓
- **Seções de resultado** (`search-section.tsx`: Da comunidade / Talvez você queira / Da web), **feed de repouso** (`discovery-feed.tsx`: heading serif + linhas + "Você chegou ao fim" italic), **estado vazio honesto** (kicker + manchete serif + corpo). Conteúdo certo; só o posicionamento do shell muda.
- **Chaves i18n** já criadas no bloco `busca`/`feed` (pt-BR + en-US): `titulo`="Descobrir receitas", `buscarLabel`, `placeholder`, `resultadosPara`, `vazioKicker`, `vazioTitulo`, `semResultado` (reproposto pra copy do mock), `vazioGerarTitulo`, `vazioGerarTexto`, `filtros`="Filtros", `filtrosContagem`="Filtros · {count}", `feed.titulo`, `limparBusca`. **Reusar**; o card "Buscar na web" do vazio vai precisar de chaves novas (ex.: `vazioWebTitulo`/`vazioWebTexto`/`vazioWebBotao`).
- **`FacetFieldset` = linhas de checkbox** (o dono ESCOLHEU isso sobre chips-pílula nesta iniciativa — manter).
- **ADR-0019 emendado** (Gerar rebaixado pro vazio) — ainda vale.
- **TODA a lógica** de `SearchExperience` (`doSearch`, `discoverWeb`, `handleWebManual`, `discoverCooks`, `cooksStatus`, debounce 300ms, AbortControllers, reflexão da URL, gating web #164/#275, ilhas Cozinheiros) — **PRESERVAR**. O redesign é de **shell/layout**, não de comportamento.

## ⚠️ A DECISÃO ARQUITETURAL CENTRAL (resolver no plano + validar no plan-review)

O protótipo põe a busca **DENTRO do header**. No app real isso colide com a chrome existente:

- `src/components/site-header.tsx` = header GLOBAL de todas as páginas: `[wordmark] [nav: Explorar/Seguindo/Minhas criações/Criar] [AuthSlot]`. **NÃO tem busca.** É um client component (`useLocale`/`useSession`/`usePathname`). **JÁ TEM MUDANÇAS NÃO-COMMITADAS DO DONO** (trabalho de marca #270 — ver landmines).
- `src/app/[locale]/page.tsx` → renderiza `SearchExperience` (client), dono do estado de busca + filtros + resultados + provê o ÚNICO `<main>`.
- No mock, o `Você` = o `AuthSlot`; o `Criar` = o botão que abre o `CreateDrawer` (ambos já no `SiteHeader`).

**Como casar o header unificado do mock com esse split?** Opções (o plan-review decide; não deixar subagente escolher sozinho):
- **(a)** Levar a busca pro `SiteHeader`, SÓ na home, com estado compartilhado (context/lift). Caveat: o estado de busca é o coração do `SearchExperience` — lift exige um seam (Context Provider) entre header e página.
- **(b)** A home renderiza seu PRÓPRIO header bar (não usa o `SiteHeader` global). Duplica chrome, quebra consistência cross-página.
- **(c)** Outra (ex.: o `SiteHeader` aceita um `slot` opcional de busca que a home preenche via portal/context).

**Sub-questão a GRELHAR o dono se ambíguo** (long-form em chat, nunca modal): o header do mock mostra **só `[Refogando] [busca] [Criar] [Você]`** — **sem** os links "Explorar / Seguindo / Minhas criações" que o `SiteHeader` atual tem no desktop. O protótipo final **removeu** esses links da home, ou é só o recorte do frame? Se removeu, pra onde vão (menu da conta? somem?)? Isso muda o `SiteHeader` e **toca o trabalho de marca não-commitado do dono** — coordenar ANTES.

## ⚠️ TENSÃO: estado vazio com card "Buscar na web" × guarda C2b

O protótipo final põe um card **"Buscar na web"** (gatilho manual) no estado vazio. O teste **C2b** (`test/ui/search-experience-web.test.tsx`) guarda contra um CTA-web **flashando no caminho raso** enquanto a web automática (#164) está em voo. Hoje a web **auto-dispara** quando `localCount < 3` (que inclui o vazio). Reconciliar (decisão do plan-review / talvez grelhar o dono):
- **Opção 1:** parar de auto-disparar a web no acervo raso/vazio e transformar isso no botão explícito "Buscar na web" do card (alinha com "a Busca nunca cria" / fetch-só-por-ação; muda o #164).
- **Opção 2:** manter o auto-disparo e mostrar o card só depois que a web automática assentar vazia (sem flash).
- Em qualquer caso, **atualizar o teste C2b** pra refletir a decisão (sem apagar a cobertura da intenção).

## Invariantes a NÃO regredir (PR #338 + ADR-0019/0020)

1. ADR-0019 **"a Busca nunca cria"**: "Gerar" linka `/create?q=`, nunca auto-gera; descoberta web é ponte.
2. Gating web (#164 auto / #275 manual) — mas **revisar à luz do card "Buscar na web" do vazio** (acima).
3. Ilhas: `CookSearchCluster` flutua acima dos resultados; `CooksToFollowRail` só `home && repouso`; ambas `null` no SSR/anon (Modelo B).
4. `DiscoveryFeed` = conteúdo de repouso SSR-seeded, INDEXÁVEL; precisa de heading VISÍVEL (o `<h1>` é sr-only).
5. Paridade i18n pt-BR + en-US (`Messages = typeof ptBR`, type-enforced — toda chave nova nos DOIS).
6. Marca: serifa (font-display), terracota/páprica, fundo creme, chips/linhas de checkbox, copy pt-BR, sem emoji NOVO (✦/✨ do selo IA já existem).
7. live region (`aria-live=polite`) embrulha os estados EFÊMEROS de busca (loading/vazio/erro/resultados/web), com o feed de repouso FORA dela.
8. h1/SEO/a11y: `busca.titulo` é `<h1>` (sr-only) **E** `<title>` de SEO (`page.tsx generateMetadata`); o input tem label próprio (`buscarLabel`); manter heading hierarchy sem skips.

## Onde mora o código real (ler PRIMEIRO, antes de planejar)

- `src/components/recipe/search-experience.tsx` — o cérebro client (estado + fetch + layout). **JÁ está no formato "Direção C v1"** — é a base a EVOLUIR pro shell do mock final.
- `src/components/site-header.tsx` — header global. **Provável alvo de mudança** (busca no header) + **tem trabalho não-commitado do dono**.
- `src/app/[locale]/page.tsx` — home server component (SSR do feed + `generateMetadata`).
- `src/components/recipe/{facet-fieldset,recipe-result-item,discovery-feed,search-section,sort-toggle,cook-search-cluster,cooks-to-follow-rail}.tsx`.
- `src/components/container.tsx` (larguras `page`/`reading`), `src/app/globals.css` (tokens `--container-*`, cores).
- `src/i18n/messages/{pt-BR,en-US}.ts` — blocos `busca` + `feed`.
- `docs/adr/0019-*.md` (com a emenda #5), `docs/adr/0020-*.md`, `CONTEXT.md`.
- Testes (todos passam hoje; atualizar pro shell novo SEM perder cobertura): `test/ui/{search,search-experience-filtros,search-experience-web,search-gerar-ia-cta,search-experience-cooks,discovery-home,discovery-feed,cozinha-vocab}.test.tsx`.
- Diff completo do que mudou no PR #338: `git show ca3d3ad` (ou `gh pr view 338`).

## Processo OBRIGATÓRIO (o dono pediu CADA passo explicitamente)

1. **Import/sync Claude Design** (MCP) — importar `refogando-final.dc.html` + **seguir os imports** (componentes/CSS/scripts compartilhados) pra entender o todo. Espelhar o relevante (o repo tem `docs/design-prototype/` como espelho read-only de protótipos anteriores).
2. **Plano** de implementação aterrado no código real (resolver a decisão do header + a tensão do vazio-web).
3. **Plan-review multi-lente** (Workflow, adversarial): lentes = paridade-com-o-mock, arquitetura-do-header, invariantes/ADR, a11y/SEO, cobertura-de-testes/jsdom. Verificar achados.
4. **Ajustes do plano.**
5. **Implementação via TDD em worktree** (preservar comportamento + atualizar testes pro shell novo).
6. **Code-review multi-lente** (Workflow + verificação adversarial dos achados): bugs/correção, paridade, invariantes/ADR, a11y, i18n.
7. **Ajustes do code-review.**
8. **Validação final** (projeto `ui` focado local + a CI roda node+ui) → **squash-merge quando verde**. (Não há issue GH — "#5" é informal; **não** usar `Closes #5`.)

## Landmines / gotchas de ambiente

- **WORKTREE ISOLATION obrigatória** ([[use-worktree-isolation-parallel-sessions]]): rodar tudo num worktree dedicado off `origin/main`. **`Edit`/`Write` usam path ABSOLUTO** — editar SEMPRE o path do worktree, nunca autopilotar o path do main (`/home/ferna/projects/refogando/src/...`); senão as edições caem no `main` e os testes do worktree passam **sem mudança** (o tell-tale). `node_modules`: **hardlink** (`cp -al .../node_modules ./node_modules`), nunca symlink (quebra Turbopack). Testes DB: endpoint DIRETO (strip `-pooler`).
- **TRABALHO DE MARCA NÃO-COMMITADO DO DONO no `main`** (#270): o working tree do repo principal tem mudanças não-commitadas do dono em `src/app/[locale]/layout.tsx`, **`src/components/site-header.tsx`**, `src/components/brand-mark.tsx`, `public/opengraph-image.png`, `public/icon-*.png`, `public/favicon.ico`, `public/manifest.webmanifest`, `docs/brand/aroma-curl/`. **NÃO MEXER.** ⚠️ Como esta tarefa provavelmente toca o `SiteHeader` (busca no header), há **COLISÃO REAL** com o trabalho de marca dele — **coordenar/grelhar o dono ANTES de tocar o `site-header.tsx`** (talvez a busca-no-header seja parte do trabalho de marca dele; ou pegar a versão dele primeiro). NUNCA `git checkout .`/`stash` no main; scopar só aos próprios arquivos.
- **"#5" é shorthand INFORMAL** do dono — a issue GH #5 é uma antiga de auth, **fechada desde 2026-06-15**. `Closes #5` = no-op (não usar). Não há tracker GH pra esta peça.
- **Testes focados**: `npx vitest run --project ui <files>` (jsdom, sem DB, rápido). A CI roda node+ui (~6min). `next build` é **env-blocked** (não dá pra rodar o app real localmente; confiar na seam jsdom + CI). jsdom **não carrega stylesheet** → classes Tailwind são strings inertes (CSS-hidden segue consultável; fixar contratos de visibilidade por classe/aria).
- **Merge**: `gh pr merge <n> --squash --delete-branch` **FALHA no git LOCAL** (`'main' is already used by worktree`) mas o **merge REMOTO acontece** — confirmar `gh pr view <n> --json state` (=MERGED) e **deletar a branch remota à mão** (`gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`). "Closes #N" PT não auto-fecha (usar inglês — mas aqui não há issue).

## Critério de saída

App real **idêntico** ao `refogando-final.dc.html`: header unificado `[Refogando][busca][Criar][Você]`, trilha de filtros sob a wordmark, vazio com os DOIS cards (Gerar + Buscar na web), frame/moldura. Comportamento 100% preservado (busca/web/cooks/feed). Testes verdes (ui focado + CI node), code-review satisfeito, paridade conferida contra o mock, h1/SEO/a11y intactos. Merge.

## Suggested skills (a próxima sessão)

- **DesignSync** (MCP `claude_design`, skill `/design-sync`) — importar o projeto e o `refogando-final.dc.html`; auth já costuma ter `user:design:read/write` (senão `/design-login`).
- **`grill-with-docs`** ou **`grill-me`** — se a arquitetura do header / o destino dos links de nav / a tensão do card "Buscar na web" no vazio ficarem ambíguos. (Decisões reversíveis: decidir; forks irreversíveis ou de identidade visual: grelhar.)
- **`tdd`** — implementação test-first.
- **`code-review`** / **`review`** — revisões multi-lente (ou Workflow custom, como nas sessões #5/#279).
- **`impeccable`** / **`frontend-design`** — refino visual fiel ao mock.
- **`handoff`** — ao fim, pro próximo elo.

---

## Prompt de kickoff (copiar e colar numa sessão nova)

Vou re-implementar a home/Busca do Refogando pra ficar EXATAMENTE igual ao protótipo FINAL atualizado do Claude Design. O layout que está no ar hoje (PR #338, mergeado na main ca3d3ad) foi REPROVADO por mim: a estrutura do shell está errada — a busca tem que ficar DENTRO do header (na mesma linha do "Refogando", "Criar" e "Você"), a trilha de filtros tem que ficar ABAIXO desse header (sob a wordmark), e o estado vazio tem que ter os DOIS cards ("Gerar receita com IA" e "Buscar na web"). O comportamento (busca, descoberta web, cozinheiros, feed) está correto e deve ser preservado — isto é trabalho de PARIDADE com o protótipo, não reescrita. Leia primeiro o handoff auto-suficiente em docs/handoffs/43-home-busca-reimplementar-identica-ao-prototipo-final-claude-design.md, que aterra tudo no código real (onde estão os arquivos, o que reaproveitar do PR #338, a decisão arquitetural central do header, a tensão do card "Buscar na web" vs o teste C2b, as invariantes a não regredir, e os landmines — em especial o trabalho de marca NÃO-COMMITADO do dono no site-header.tsx do main, que pode colidir com mexer no header). Siga o fluxo COMPLETO de 8 passos, sem pular nenhum, porque eu quero garantir que os subagentes trabalhem corretamente e o app real fique idêntico ao protótipo: (1) importar e sincronizar o projeto do Claude Design; (2) fazer um plano de implementação aterrado no código real; (3) revisar o plano com subagentes especializados multi-lente (paridade, arquitetura do header, invariantes/ADR, a11y, cobertura de testes), de forma adversarial; (4) corrigir o plano; (5) implementar via TDD num git worktree isolado, preservando o comportamento e a cobertura de testes; (6) code-review multi-lente com verificação adversarial dos achados; (7) aplicar os ajustes do code-review; (8) validar (projeto ui focado local + CI node+ui) e mergear quando o CI fechar verde. Use o claude_design MCP (https://api.anthropic.com/v1/design/mcp, auth via /design-login) to import this project: https://claude.ai/design/p/00bb42be-e223-4edb-b106-e59799b80ca9?file=refogando-final.dc.html — Implement: refogando-final.dc.html
