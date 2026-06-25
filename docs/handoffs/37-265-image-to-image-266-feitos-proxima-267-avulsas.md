# Handoff 37 — #265 + image-to-image + #266 ENTREGUES; próxima: avulsas #267→#268→#269, depois épicos #263/#264, seed #238

**Estado:** três entregas nesta sessão, todas na `main` (tip `dc19cc7`). Tudo pelo pipeline de 8 passos do `CLAUDE.md` (explorar → plano → review-do-plano → TDD → code-review adversarial → fix → verde → merge). **Não re-fazer.**

Memória de contexto (leia primeiro): `novas-requisicoes-social-web-import.md` (decisões + issues + ordem) e os outros índices em `MEMORY.md`.

## O que esta sessão produziu (referência — NÃO re-fazer)

1. **#265 — modal "Gerar com IA" não gera ao abrir** (`main feae544`, PR #283). Bug: `onOpenModal`→`onGenerate` queimava cota só de abrir. Fix **client-only** (rota/ledger/`review_required` intocados): abre na **galeria (repouso)**, gera só no clique de "Gerar". Extraiu `<RecipeImageGallery>` (fonte única; a página esconde a cópia com o modal aberto via `!modalOpen`), estado `generating`≠`busy`, chave i18n `imagemGerarAgora`, `onOpenModal` limpa `galleryError`. Detalhe: diff do PR #283.

2. **image-to-image — "editar imagem a partir de outra"** (grill do dono → docs PR #284 `main 7ea3b58` → impl #285 PR #286 `main a24ca8c`; issue #285 fechada).
   - **Domínio:** `docs/adr/0022-*.md` seção **"Atualização (image-to-image)"** + glossário (`CONTEXT.md`: termos **Imagem editada por IA**, **Imagem-base**). Decisões: edição **ANCORADA na receita** (anti-abuso da dec.2 mantido via `composeEditImagePrompt`); parentesco `source_image_id`; selo distinto **"✨ Editada com IA"** (derivado do `source_image_id`) **só no estúdio do Owner** na v1 (público = follow-up no ADR); fonte = qualquer imagem **incl. moderada** (re-entra na revisão); `review_required = refino || edição`.
   - **Código:** migração **0030** (`recipe_image.source_image_id`, auto-FK nullable `ON DELETE SET NULL`); seams novos **`ImageStore.get(url)`** (Real=fetch / Fake=blobs map / Throwing=lança) + **`ImageGenerator.source`** (vira `inlineData` part no Gemini multimodal); rota aceita `sourceImageId`, own-gate pela **linhagem** (404 leak-safe), lê os bytes da base **só após os gates de cota**, TOCTOU do FK 23503→404 via `pgCode`. Detalhe: diff do PR #286.

3. **#266 — form do catálogo abre num drawer lateral direito** (`main dc19cc7`, PR #287, issue fechada). `CatalogRecipeForm` (Curadoria) sai do inline → `Sheet side="right"` (ADR-0021) via gatilho "Nova receita de catálogo". **Sem mudança de domínio** (mesmo `POST /api/curate/recipes`, `origin=catalog`). Novo `CatalogRecipeDrawer` espelha `create-drawer.tsx`: dismiss **bloqueado** no POST (`onOpenChange`+Esc+clique-fora), reset-on-reopen automático (Radix desmonta o conteúdo no close), `onLoadingChange` no form, título/descrição cedidos ao `SheetHeader` (um título só). Chaves i18n `criarReceitaBotao`/`criarReceitaFechar`. Detalhe: diff do PR #287.

## Próxima ordem de trabalho (do dono)

**Avulsas rápidas restantes, nesta ordem:**
1. **#267** — avatar vira **menu dropdown** (`gh issue view 267`).
2. **#268** — reorganiza a **nav do /admin** (renomear "Geração de imagem"→"IA & Descoberta", mover o Aviso do catálogo p/ Curadoria).
3. **#269** — **busca de usuários** nos Papéis (nome/@handle/email/ID) — **constrói o seam reusado pela busca social #279** (fazer com cuidado: é fundação).

Depois, **os 2 épicos** (ordem livre; SEO já protegido pelo Modelo B do ADR-0024):
- **#263 descoberta-web:** o motor de import + allowlist JÁ EXISTEM. Falta **#271** (provedor Brave atrás do `WebSearchProvider` seam, lê `WEB_SEARCH_API_KEY`, query `site:`-restrita) · **#272** (importação segura: parar de copiar foto + `description`/headnote; importada nasce **sem imagem**, dono completa via Galeria) · #273 (admin sugestões+probe) · #275 (2º gatilho, blk #271) · **#276 sign-off jurídico HITL** (blk #271/#272).
- **#264 social:** ADR-0024 tem TODAS as decisões. **#274** grafo `user_follow` (spine) → #277 (feed Seguindo + abas) / #278 (trilho recomendados) / #279 (busca mesclada, **blk #269**).

Por último: **#270 logo** (HITL) e **#238 seed catálogo** (HITL, com a curadoria do dono — fecha o PRD #187).

## Landmines / gotchas (validados nesta sessão)
- **Migração:** só `npm run db:generate` (offline/seguro); **NUNCA `db:migrate` local** (`.env.local` É PROD). Inspecione o `.sql` gerado (sem DDL inesperado). Aplica on-deploy. Auto-FK self-ref no schema exige o padrão `(): AnyPgColumn => tabela.id`.
- **`git add -A` varre edições do dono** no working tree → confira `git diff --stat` e adicione caminhos específicos.
- **Suíte node completa flaka local no Neon** → rode **focado por arquivo** + confie na CI. UI (jsdom) + unit (puros) rodam local sem dor. **Moderar uma `recipe_image` no teste exige os 3 campos `moderated_*` juntos** (chk de consistência — o DB real pegou isso na CI).
- **Repo NÃO tem auto-merge** → `gh pr checks <n> --watch` em background; o job "checks" leva ~5–6 min; depois `gh pr merge --squash --delete-branch` no foreground.
- **Branch off `origin/main`** (a local drifta). Reusar precedentes: drawer = `create-drawer.tsx`; estúdio de imagem = `recipe-image-manager.tsx`.

## Pipeline de dev (reusar — provado nesta e nas sessões anteriores)
Por fatia: **explorar** (Explore agents paralelos, schema estruturado) → **plano** (scratchpad) → **plan-review adversarial** (Workflow N-lentes; pagou MUITO no image-to-image — 11 achados dobrados antes de codar) → **TDD** na branch off origin/main → **diff-review adversarial** (Workflow 3-lentes verify-each-finding) → fix → typecheck+lint+i18n-parity + testes focados → commit (conferir `git diff --stat`) → PR → CI verde foreground → squash-merge → fechar a(s) issue(s). O review adversarial paga o aluguel.

## Suggested skills (próxima sessão)
- Nenhuma skill especial para as avulsas #267/#268: o **fluxo de 8 passos do CLAUDE.md** cobre (Explore → Plan → `tdd` → review). Pegue a issue (`gh issue view 267`) e rode o pipeline.
- **#271** (provedor Brave) pode pedir `mcp__context7` pra confirmar a API do provedor de busca-web.
- **#270 logo** e **#238 seed** são **HITL** (dependem do dono — não AFK).
- Se o dono quiser re-grelhar UX de um épico antes de codar, `/grill-with-docs`.

## Critério de saída desta perna
#265 + image-to-image + #266 entregues e fechados (`main dc19cc7`). Backlog aberto: avulsas **#267/#268/#269/#270**, épicos **#263/#264** (filhas #271–#279), seed **#238** (+ SEO leftover #187). Próximo passo concreto: **dev do #267**.
