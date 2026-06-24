# Handoff 36 — 8 novas requisições GRELHADAS (ADR-0024 + ADR-0019 + 17 issues) e Tempo de preparo DEV completo; próxima ordem: #265 (avulsas) → épicos → seed #238

**Estado:** duas entregas nesta sessão, ambas na `main`:
1. **Grill de 8 novas requisições do dono** → `CONTEXT.md` + **ADR-0024 (camada social)** novo + **ADR-0019 emendado** (postura legal da importação web) + **17 issues #263–#279** (2 épicos + 15 fatias). PR #280, `main 5467bd7`.
2. **Tempo de preparo DEV 100% concluído e fechado** — #188/#261/#262, PR #281, `main 45456b5`. Pipeline completo (explorar → plano → review-do-plano → TDD → code-review adversarial 3-lentes → fix → merge). **Não re-fazer.**

Memória de contexto: `novas-requisicoes-social-web-import.md` (decisões + issues + ordem). **Leia-a primeiro.**

## O que esta sessão produziu (referência — NÃO re-fazer)

### Grill (domínio + issues)
- **ADR-0024** `docs/adr/0024-camada-social-*.md` — seguir **assimétrico público** (modelo Instagram, `user_follow`), **feed "Seguindo" separado** (só-logado, não-indexável; home/Descoberta **indexável intacta** = Modelo B, protege o ADR-0020), trilho de recomendados (popularidade v1, cascata B→A→editorial deferida), **Busca abrange Cozinheiros** (cluster por força-de-match, sem toggle). **Cozinheiro = lente social, NÃO papel** (`ROLES` intacto).
- **ADR-0019** ganhou blockquote **"Atualização (postura legal)"** — pesquisa citada (US/EU/BR): **allowlist = risco baixo** vs web aberta; o risco é **o que se copia** (receita = fato; **foto + `description`/headnote = protegidos**); **atribuição obrigatória** (direito moral, Lei 9.610); guard-rails (robots/UA/rate-limit/LGPD/takedown); **provedor Brave** (Bing morto, Google CSE fechado); caveat de **sign-off jurídico** antes do go-live.
- **Glossário** (`CONTEXT.md`): termos novos **Cozinheiro**, **Seguir / Seguidores**, **Feed Seguindo**; **Busca** estendida a Cozinheiros.
- **17 issues** `gh issue list` (#263–#279). Os corpos têm AC + blocked-by + parents; os épicos #263/#264 têm checklist de filhas.

### Tempo de preparo (#188/#261/#262 — ver PR #281, ADR-0023)
Atributo invariante `tempo_ativo_min`/`tempo_total_min`. Detalhes técnicos no diff/PR #281 e no ADR-0023 — **não duplico aqui**. Pontos que um próximo dev precisa saber:
- **Migração 0029** (2 colunas + `recipe_tempo_consistency_chk`) aplica on-deploy, **sem backfill** (linhas existentes ficam NULL).
- **Decisão de borda revisada no review:** clamp **UNIFORME** (geração + edição) via `conciliarTempoPreparo` (`src/domain/tempo.ts`) sobre o estado mesclado — NÃO a assimetria reject-vs-clamp do rascunho. É a leitura fiel do ADR-0023 dec.3 e robusta a patch parcial.
- **Lição do code-review (vale pra futuros campos invariantes):** TODO caminho de INSERT de `recipe` precisa tratar o novo campo. O fork (`derive.ts`) **não herdava** o tempo — pego pelo review adversarial do diff, corrigido (herda da base como porcoes/dificuldade). Import/catálogo nascem sem tempo (NULL) de propósito.
- Filtro por tempo na **Busca** = follow-up futuro **NÃO criado** (ADR-0023 dec.5 deferiu).

## Próxima ordem de trabalho (do dono)
1. **Avulsas rápidas primeiro — comece pelo #265** (`gh issue view 265`): o modal "Gerar com IA" **auto-gera ao abrir** (`recipe-image-manager.tsx`, `onOpenModal`→`onGenerate`), **queimando a cota de imagem** do dono toda vez. Fix: abrir na galeria, gerar só no clique. Depois #266 (form catálogo→drawer), #267 (menu avatar), #268 (nav admin), #269 (busca de usuários — **constrói o seam reusado pela busca social #279**).
2. **Épicos** (ordem livre; SEO já protegido pelo Modelo B):
   - **#263 Descoberta-web:** o motor de importação + allowlist + re-filtro **JÁ EXISTEM** (ADR-0019). Falta: **#271** ligar o provedor **Brave** atrás do `WebSearchProvider` seam (lê `WEB_SEARCH_API_KEY`, query `site:`-restrita ao allowlist) · **#272** importação segura (parar de copiar foto + `description`/headnote; receita importada nasce **sem imagem**, dono completa via Galeria; + guard-rails) · #273 (admin sugestões+probe) · #275 (2º gatilho) · **#276 sign-off jurídico HITL** antes do go-live.
   - **#264 Social:** ADR-0024 tem TODAS as decisões. **#274** grafo (`user_follow`, spine) → #277 (feed Seguindo + abas Explorar/Seguindo) / #278 (trilho recomendados) / #279 (busca mesclada, blocked-by #269).
3. **#270 logo** (HITL, paralelo) e **#238 seed catálogo** (HITL, por último, com curadoria do dono — último filho aberto do PRD #187).

## Landmines / gotchas
- **`git add -A` varre edições do dono no working tree.** Esta sessão pegou o `BRAVE_SEARCH_API_KEY` que o dono pôs no `.env.example` — saiu do commit do tempo. **Sempre confira o `git diff --stat` antes de commitar e desstageie o que não é da fatia.**
- **Env var da busca-web = `WEB_SEARCH_API_KEY`** (provider-agnóstica, lida em `web-search-provider.ts:57`), **NÃO** `BRAVE_SEARCH_API_KEY`. O `.env.example` já documenta isso (Brave é o provedor v1 atrás do seam). Ausente ⇒ busca-web desligada (stub → []).
- **Suíte node completa flaka local no Neon** (db descartável some sob concorrência) → rode **focado** por arquivo + confie na CI. Testes UI (jsdom) e domain (puros) rodam local sem dor.
- **Repo NÃO tem auto-merge** → mergear no **foreground** quando a CI ficar verde (`gh pr checks <n> --watch` em background, depois `gh pr merge --squash --delete-branch`). O check pesado ("checks") leva ~5–6 min.
- **Branch off `origin/main`** (local drifta); migrações sequenciais geram off a main atualizada (`npm run db:generate` é offline/seguro; **NUNCA `db:migrate` local** — `.env.local` É PROD).

## Pipeline de dev (reusar — provado nesta sessão)
Por fatia: **explorar** (Workflow N exploradores paralelos, schema estruturado) → **plano** (doc no scratchpad) → **review adversarial do PLANO** (Workflow 3-lentes — pegou a assimetria de design errada do tempo) → **implementar TDD** na branch off origin/main → **code-review adversarial do DIFF** (Workflow 3-lentes: missed-surfaces / correção / aderência-ADR — pegou o derive não-herdando) → **fix** → typecheck+lint+i18n-parity + testes focados → commit → PR → CI verde no foreground → squash-merge → fechar issue(s). O review adversarial paga o aluguel.

## Suggested skills (próxima sessão)
- Nenhuma skill especial para as avulsas/épicos — o **fluxo de 8 passos do CLAUDE.md** (com `tdd`/`review`/`diagnose` auto-selecionadas por passo) cobre tudo. Apenas pegue a issue (`gh issue view <n>`) e rode o pipeline acima.
- **#238 (seed)** é HITL — depende do dono (curadoria); não é AFK.
- Se o dono quiser re-grelhar algo antes de codar (ex.: detalhe de UX de um épico), `/grill-with-docs`.

## Critério de saída desta perna
Tempo de preparo entregue e fechado (#188/#261/#262, `main 45456b5`). 17 issues no tracker prontas para dev. Backlog aberto: #187/#238 (SEO leftover) + #263–#279 (novas). Próximo passo concreto: **dev do #265**.
