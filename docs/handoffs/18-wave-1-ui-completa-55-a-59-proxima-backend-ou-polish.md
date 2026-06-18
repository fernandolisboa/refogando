# Handoff 18 — Wave 1 de UI **COMPLETA** (#55→#59 numa sessão) · próxima: **fork de direção** (backend p/ destravar Wave 2, ou polish/validação da Wave 1)

**Sessão anterior:** implementou e mergeou a **Wave 1 inteira da camada de UI** — #56, #57, #55, #58, #59 — pelos 8 passos do `CLAUDE.md`, **cada passo num subagente fresco** via `Workflow`. Cinco PRs squash-mergeados, cinco issues fechadas, **épico #53 com #54–#59 todos ✓**. O loop principal só orquestrou e integrou (green-gate + Playwright onde possível + commit/PR/merge).

| Fatia | PR | Squash | Componentes-chave (a fonte de verdade é o diff) |
|---|---|---|---|
| #56 Busca/home | #71 | `20be52f` | `src/components/recipe/{search-experience,search-section,recipe-result-item,provenance-badge,facet-fieldset}.tsx`; `src/app/page.tsx` (Busca É a home) |
| #57 Ver receita | #72 | `16c8eb7` | `src/app/recipes/[id]/page.tsx`; `recipe-detail-view.tsx`, `restriction-warning.tsx`, `stale-notice-banner.tsx`; `src/server/http/{base-url,handle-response,page-locale}.ts` |
| #55 Auth | #73 | `dc2deac` | `src/app/{sign-in,sign-up}/page.tsx`; `src/components/auth/auth-form.tsx`; `auth-slot.tsx` (sessão real); `src/lib/auth-client.ts`; `src/server/auth/google.ts` |
| #58 Criar (Briefing) | #74 | `88b1b8a` | `src/app/create/page.tsx`; `create-structured-experience.tsx` |
| #59 Salvar+publicar | #75 | `e6587e1` | `recipe-visibility-controls.tsx`; `RecipeView.canManage/visibility/resultKind` (leak-safe) em `src/domain/recipe-read.ts` + `src/app/api/recipes/[id]/route.ts` |

**Leia o diff de cada PR pra detalhe** (`gh pr diff <N>`). Não duplicado aqui. Estado final em `main`: `e6587e1`, working tree limpo, full suite **576/576**.

## 🚨 PRIORIDADE #0 — PRODUÇÃO QUEBRADA: Google sign-in 500 (migrations nunca aplicadas em prod)

**Descoberto ao fim desta sessão** (ver memória `dev-db-not-migrated-real-app-validation-boundary`, atualizada com a causa-raiz). **O `.env.local` aponta para o DB de PRODUÇÃO** (Neon main branch único — local e prod compartilham o MESMO DB; não há branch de dev separado; endpoint `ep-gentle-morning-acsn0tzz`, sa-east-1). Esse DB está **NÃO-MIGRADO**: `relation "recipe"/"verification" does not exist`. Consequência REAL em produção: **o login com Google dá 500** porque o Better Auth faz `INSERT INTO "verification"` e bate `42P01` — as tabelas `verification`/`users`/`session`/`account` vivem em `drizzle/0002_breezy_dark_phoenix.sql` e **nunca foram aplicadas em prod**.

- **Causa-raiz do gap:** **nada no deploy aplica migrations** — `vercel.json` não tem `buildCommand`; o CI nunca migra um DB real. (Não é código de UI; predata a Wave 1.)
- **Fix imediato (restaura o auth):** `npm run db:migrate` contra prod. É **idempotente** (journal `__drizzle_migrations`) e self-contained (0000 cria `unaccent`/`vector` com `IF NOT EXISTS`). Usa o endpoint DIRETO/unpooled (`drizzle.config.ts` já prioriza `DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING`). **PORÉM:** `db:migrate` é **gated pelo classificador** (mutação em DB gerenciado de produção) → **exige autorização explícita do usuário**. NÃO rodar sozinho.
- **Fix durável (decisão de política do usuário):** garantir que toda deploy migre — ex. `buildCommand: "npm run db:migrate && npm run build"` em `vercel.json` (conferir antes se o build da Vercel tem o endpoint unpooled no env; ver também o comentário em `.github/workflows/cleanup-neon-preview-branch.yml` sobre um Build Command de dashboard que pode já tentar — e falhar silenciosamente — migrar). Como o `cleanup-neon-preview-branch` cria branches de PREVIEW efêmeras, vale revisar se preview e prod divergem em migração.

**Esta é a primeira coisa a tratar na próxima sessão (ou já nesta, se o usuário autorizar).** Sem isso, o auth de produção segue caído e qualquer validação real de auth/criar/salvar/publicar é impossível (o boundary abaixo é a MESMA causa).

## O processo que FUNCIONOU (reuse na próxima sessão)

Existe um **workflow reutilizável e parametrizado** que roda os 8 passos (explore ∥4 → plan → plan-review ∥4 adversarial → fix-plan → implement → code-review ∥5 incl. frontend `/impeccable` → fix mutação-verificado), cada passo em subagente fresco, escrevendo o código real na branch e devolvendo um **relatório de integração estruturado**:

`/home/ferna/.claude/projects/-home-ferna-projects-refogando/0673a830-e78f-459e-bb9f-e8da4a1b1267/workflows/scripts/implement-ui-slice-wf_082836b0-e42.js`

Invoque com `Workflow({scriptPath, args})`. `args` é um objeto: `{issue, title, branch, planSlug, routeFiles[], consumes, acceptance, sliceGuidance, deps}`. **Gotcha resolvido:** `args` chega como **string JSON** no script → o guard `const A = typeof args==='string'?JSON.parse(args):args` já está no topo. Cada run leva ~25–60 min e ~1.0–1.2M tokens de subagente.

**Aprendizado crítico de integração:** o `filesChanged`/`i18nKeysAdded` do relatório é a visão PARCIAL do agente de fix — **SEMPRE verifique contra a árvore real** (`git status`/`git diff --stat origin/main`) antes de confiar. Várias vezes o relatório listou 2–3 arquivos quando o real eram 6–10 (e dizia `i18nKeysAdded: []` com strings de fato adicionadas).

## Decisões transversais que a Wave 1 fixou (a próxima sessão herda)

- **Convenção de URL em INGLÊS, uma só** (registrada em `CONTEXT.md`): `/recipes/[id]` canônico, `/sign-in`, `/sign-up`, `/create`. `_Avoid_: /receitas`. **A Busca É a home (`/`)** — descoberta-first.
- **Helpers de servidor novos a reusar:** `src/server/http/base-url.ts` (URL absoluta p/ self-fetch de Server Component; **exige `APP_URL`/`VERCEL_URL` em prod, recusa o header `Host` — anti-SSRF**), `handle-response.ts` (404→notFound, !ok→error, puro/testável), `page-locale.ts` (precedência `?locale`→cookie→Accept-Language). `src/server/auth/google.ts` (`isGoogleConfigured`, fonte única lida por `auth.ts` E pelas pages). `src/lib/auth-client.ts` (cliente Better Auth `better-auth/react`: `useSession/signIn/signUp/signOut`).
- **Ownership leak-safe (#59):** `RecipeView` ganhou `canManage`/`visibility`/`resultKind` — os TRÊS só saem quando `viewerId === recipe.ownerId`; anônimo/não-dono/catálogo NÃO veem. Padrão a seguir em qualquer campo dono-only futuro (ex.: #61).
- **i18n:** novos namespaces `busca`, `detalhe` (+`unidadeLabel`), `auth`, `criar`, `visibilidade`, e `nav.create` — todos em pt-BR E en-US (teste de paridade recursivo cobre). `cozinhaLabel`/`categoriaLabel`/`restricaoLabel`/`unidadeLabel` são os rótulos de vocabulário reusáveis.
- **Padrões de UI consolidados:** estados idle-neutro/carregando/vazio/erro+retry; `aria-live` estável; um único `<h1>`/`<main>` por documento (componentes rebaixam pra `<h2>` quando reusam um que emite `<h1>`); erro em token NEUTRO (`text-fg`), **âmbar `bg-aviso-bg/text-aviso-fg` é EXCLUSIVO do Aviso de restrição (ADR-0004)**; selo accent SÓ pra `origin=catalog`.

## ⚠️ Boundary de validação no app real (PENDENTE de decisão do usuário)

Veja a memória `dev-db-not-migrated-real-app-validation-boundary`. Resumo: o **DB de dev (`.env.local`) não está migrado** e `npm run db:migrate` foi **negado pelo classificador de segurança** (mutação em Neon gerenciado fora de tarefa autorizada). Logo, o render dos caminhos **dependentes de dados/auth NÃO foi confirmado no browser**:
- **Validado no browser (sem DB):** #56 busca completa (campo, facetas localizadas, troca de locale ao vivo, erro+retry contra 500 real, e o caminho de sucesso via **stub de `window.fetch`** — atenção: o componente passa um objeto `URL`, detecte por `input instanceof URL ? input.href : …`); #55 `/sign-in` e `/sign-up` (forms, botão Google, locale ao vivo, header fail-open); #58 `/create` gate de auth; #57 smoke (Server Component degrada em `error.tsx`).
- **Coberto por testes, NÃO por browser:** o render de sucesso de #57/#58 com dados reais e os controles de #59 (auth+DB-gated). Cobertura: **jsdom** (componentes reais, fetch/auth-client mockados) + **integração contra Postgres** (rotas, 404 leak-safe, gating de dono, `canManage` N1/N2/N3, transições publish/unpublish incl. rejeição playful) + code-review.

**Pergunta aberta ao usuário (não respondida):** autorizar `npm run db:migrate` + seed do DB de dev (fábricas em `test/helpers/recipes.ts` + um user de teste) destravaria a validação end-to-end real (entrar→criar→salvar→publicar) e permitiria revalidar #56/#57 com dados. Sem isso, seguimos no green-gate + jsdom + integração.

## Itens DEFERIDOS na Wave 1 (candidatos a polish)

- **#56:** passada de design dedicada — grid de cards genérico, empty/idle states sem afeto/centramento (nits estéticos, contraste já passa AA).
- **#57:** cookie-forwarding do self-fetch sem teste automatizado (jsdom não roda Server Component); chamar o loader in-process vs hop HTTP (refactor arquitetural — registrar em ADR-0010 se quiser).
- **#58:** erro de validação é alerta global (sem `aria-invalid`/`aria-describedby` por campo); waterfall POST→GET (não-paralelizável por design).
- Nenhum desses bloqueia nada; são iteração incremental.

## Próxima sessão — **#0 fixar produção, depois FORK DE DIREÇÃO** (o usuário escolhe; em CHAT, não no modal)

**ANTES de qualquer feature: tratar a PRIORIDADE #0 acima** (login de prod caído por falta de migration). Pedir autorização pra `npm run db:migrate` contra prod e decidir o fix durável no deploy. Só então o fork de features abaixo.

**TODA a Wave 2 de UI está BLOQUEADA por backend ainda aberto** (`gh issue view 53`):
- #60 Chat ← **#12, #15** (ambos OPEN)
- #61 Minhas criações ← **#17, #20, #21, #22** (todos OPEN)
- #62 Comunidade (voto/favorito) ← **#16** (OPEN) — *single-blocker, o mais perto de destravar*
- #63 Console admin ← **#18** (OPEN); #19 curadoria já CLOSED

Opções para a próxima sessão:
- **(A) Backend pra destravar Wave 2** — implementar os blockers (o domínio/db já é maduro; é o caminho que libera mais UI). #16 destrava #62 sozinho; #12+#15 destravam #60. Usa `tdd` + testes de integração contra Postgres.
- **(B) Polish/validação da Wave 1** — passada `/impeccable` nos itens deferidos acima + (se o usuário autorizar o DB) validação real end-to-end de entrar→criar→salvar→publicar.
- **(C) Misto** — destravar #62 via #16 (backend) e já fazer a UI #62 na mesma sessão (vertical slice ponta-a-ponta).

**Recomendação:** começar pela **pergunta de direção ao usuário em chat**; default sensato = **(A) #16 → depois #62** (single-blocker, fecha um valor visível de Comunidade ponta-a-ponta). Se o usuário autorizar o DB, encaixar a validação real da Wave 1 antes.

## Landmines / gotchas de ambiente (CONFIRMADOS nesta sessão — herdados do handoff 17, ainda válidos)

- **`next build` EXIGE `BETTER_AUTH_SECRET` (≥32 chars)**: `BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" npm run build`. O CI agora tem o build smoke-check (#68/#70).
- **`npm test` (projeto node) precisa de `TEST_DATABASE_URL`** (setado no env; ~250–300s; Docker não roda → sem Testcontainers). O projeto `ui` (jsdom) sozinho: `npx vitest run --project ui` (rápido, sem DB).
- **Flakiness só sob carga:** rodar `npm test` enquanto 17 subagentes batem no mesmo Neon de teste deu falhas de contenção; **solo é 100% verde**. Rode o green-gate autoritativo SOZINHO (não concorrente com um Workflow).
- **Branch de `origin/main`** (local fica stale); `git push` após cada commit; squash-merge `gh pr merge <N> --squash --delete-branch`; **`Closes #N` em INGLÊS** no corpo do PR (PT não auto-fecha — mas desta vez `Closes #N` fechou todas sozinho). Check do **Vercel** ora passa ora é não-bloqueante; o **gate real é o check `checks`** (GitHub Actions) — `gh pr checks <N> --watch`.
- **`AskUserQuestion` perde texto ao rejeitar** → perguntas (incl. o fork de direção e a autorização de DB) em **chat**.
- **Plano rascunho** vai em `docs/plans/` e é **removido antes do commit** (o workflow às vezes deixa `docs/plans/` untracked — limpe antes de `git add`). Nunca commitar `.playwright-mcp/`, screenshots, nem scripts de probe.

## Ler primeiro (no repo / GitHub — não duplicado aqui)

- **Épico #53** (Waves + blockers), **PRD #1** (`docs/prd/refogando.md`), **`CONTEXT.md`** (termos são lei + a convenção de URL nova), **ADRs** `0010` (route handlers via fetch, NÃO Server Actions), `0011` (gating de leitura), `0013` (playful⇒privada), `0004` (aviso âmbar), `0014`/`0001` (bilíngue), `0015` (design/seam de teste).
- **Diffs das PRs #71–#75** pro que a Wave 1 entregou. **Handoff 17** (`docs/handoffs/17-*.md`) pro detalhe da fundação #54 e do processo — ainda válido.
- **Rotas backend a consumir na Wave 2:** ler os handlers em `src/app/api/` (chat/streaming, voto/favorito, etc.) pros shapes reais quando os blockers fecharem.

## Critério de saída (da próxima fase)

Depende do fork escolhido. Para uma fatia de UV (UI vertical): verde em lint/types/`npm test` (node+ui) + `next build` com secret; jsdom cobrindo as jornadas; review de frontend `/impeccable` satisfeito; validação no app real onde não for DB-gated (ou completa se o DB for autorizado); squash-merge + issue fechada + épico atualizado. Para backend: `tdd` + integração contra Postgres verdes. Ao fim, `/handoff` → `docs/handoffs/19-*.md`.

## Suggested skills

- **Pergunta de direção ao usuário** (em chat) antes de tudo — escolher o fork (A/B/C) e responder a autorização de DB.
- **`/impeccable`** — central em qualquer fatia de UI (implementação E review de frontend); e nas tarefas de polish da Wave 1.
- **`Workflow`** com o `scriptPath` acima — reusar os 8 passos parametrizados por `args` (uma fatia por run); o loop principal só orquestra/integra.
- **`tdd`** + testes de integração contra Postgres — se a direção for backend (os blockers da Wave 2).
- **`verify`/`run` + MCP `playwright`** — dirigir o app real no passo Validar (lembrando o boundary de DB).
- **`triage`** — se abrir/mover issues ao destravar a Wave 2.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. A Wave 1 INTEIRA da camada de UI está FEITA e mergeada no main (issues #55–#59, PRs #71–#75, épico #53 com #54–#59 todos ✓; estado final em main e6587e1, full suite 576/576). Comece lendo o handoff @docs/handoffs/18-wave-1-ui-completa-55-a-59-proxima-backend-ou-polish.md (o que a Wave 1 entregou e onde, as decisões transversais que ela fixou, o workflow reutilizável dos 8 passos, o boundary de validação no app real, os itens deferidos, e o estado dos blockers da Wave 2). PRIORIDADE #0 ANTES DE TUDO: produção está QUEBRADA — o login com Google dá 500 porque o DB de produção (o MESMO Neon de .env.local, branch main único compartilhado dev+prod, endpoint ep-gentle-morning-acsn0tzz) está NÃO-MIGRADO e faltam as tabelas verification/users/session/account (drizzle/0002), e nada no deploy roda migration (vercel.json sem buildCommand); me peça autorização EM CHAT pra rodar npm run db:migrate contra prod (idempotente via __drizzle_migrations, usa o endpoint unpooled do drizzle.config; é gated pelo classificador, não rode sozinho) pra restaurar o auth, e proponha o fix durável (buildCommand npm run db:migrate && npm run build em vercel.json, conferindo o endpoint unpooled no env da Vercel) — só depois disso siga pro fork de features. Contexto essencial: o desenvolvimento segue o pipeline de 8 passos do CLAUDE.md, cada passo num subagente fresco (ferramenta Agent pra um passo, Workflow pra fan-out/pipeline) — o loop principal só orquestra e integra; existe um workflow PARAMETRIZADO pronto em /home/ferna/.claude/projects/-home-ferna-projects-refogando/0673a830-e78f-459e-bb9f-e8da4a1b1267/workflows/scripts/implement-ui-slice-wf_082836b0-e42.js que roda os 8 passos (explore∥4→plan→plan-review∥4 adversarial→fix-plan→implement→code-review∥5 incl. frontend /impeccable→fix mutação-verificado) escrevendo o código real na branch e devolvendo um relatório estruturado — invoque com Workflow({scriptPath, args:{issue,title,branch,planSlug,routeFiles,consumes,acceptance,sliceGuidance,deps}}); SEMPRE verifique o relatório contra a árvore real (git status/diff), pois filesChanged/i18nKeysAdded vêm parciais. A Wave 1 fixou: convenção de URL em inglês (/recipes/[id], /sign-in, /sign-up, /create; Busca é a home /), helpers de servidor reusáveis (src/server/http/{base-url anti-SSRF,handle-response,page-locale}.ts, src/server/auth/google.ts isGoogleConfigured, src/lib/auth-client.ts), o padrão de ownership leak-safe (RecipeView.canManage/visibility/resultKind só pro dono), e os componentes/tokens da #54+Wave1 a reusar (ProvenanceBadge, RecipeDetailView, RestrictionWarning, FacetFieldset, auth-form, etc.); toda string nova em pt-BR E en-US; âmbar é exclusivo do Aviso de restrição (ADR-0004); ADR-0010 a UI consome route handlers via fetch (não Server Actions). PRIMEIRA AÇÃO — me pergunte EM CHAT (não no modal AskUserQuestion, que perde texto ao rejeitar) a DIREÇÃO desta sessão, porque TODA a Wave 2 de UI está bloqueada por backend ainda aberto (#60←#12,#15; #61←#17,#20,#21,#22; #62←#16; #63←#18 [#19 já fechada]): opção A = implementar backend pra destravar a Wave 2 (recomendado começar por #16, single-blocker, que destrava #62, depois fazer a UI #62 na mesma sessão como vertical slice ponta-a-ponta), opção B = polish/validação da Wave 1 (passada /impeccable nos itens deferidos do handoff + validação real end-to-end SE eu autorizar migrar+semear o DB de dev), opção C = misto; e me pergunte também se autorizo o npm run db:migrate + seed do DB de dev de .env.local (hoje não-migrado; a migração foi negada pelo classificador como ação não-autorizada) pra destravar a validação no app real de entrar→criar→salvar→publicar — sem isso a validação de caminhos auth/DB segue só por jsdom + testes de integração contra Postgres. Gotchas: next build exige BETTER_AUTH_SECRET (≥32 chars) senão lança no Collecting page data; npm test (projeto node) precisa de TEST_DATABASE_URL (Docker não roda) e o projeto ui (jsdom) sozinho é npx vitest run --project ui; rode o green-gate autoritativo SOZINHO (rodar npm test concorrente com um Workflow dá flakiness de contenção no Neon de teste — solo é 100% verde); branch de origin/main, git push após cada commit, squash-merge gh pr merge <N> --squash --delete-branch, Closes #N em inglês no corpo do PR, gate real é o check checks do GitHub Actions (Vercel é não-bloqueante), pollar gh pr checks <N> --watch; rascunho de plano em docs/plans/ removido antes do commit e NUNCA commitar .playwright-mcp/, screenshots ou scripts de probe; handoffs/PRs sempre via branch. Princípios: CONTEXT.md (termos são lei, _Avoid_, a convenção de URL nova), ADRs (0010 route handlers via fetch; 0011 gating; 0013 playful⇒privada; 0004 âmbar; 0014/0001 bilíngue; 0015 design/teste), receita é o centro e compliance é toque leve, linguagem simples e direta em pt-BR. Ao fim da fase, rode /handoff gerando docs/handoffs/19-*.md + prompt de kickoff.
