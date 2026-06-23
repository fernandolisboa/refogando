# Handoff 34 — SEO #187 DEV completo; próxima ordem: Estúdio de imagem #221 → tempo-de-preparo #188 → seed #238

**Estado:** o **DEV do épico SEO + descoberta bilíngue (#187) está 100% concluído** e na `main` (`f137d5a`). Todas as fatias agent-doáveis (#228–#237) mergeadas; só resta **#238** (seed do catálogo, HITL/humano) — o épico fica **aberto** só por isso. Esta sessão também rodou o **backfill de slug no prod**. Com o SEO fechado, o **Estúdio de imagem #221 destravou** (não compete mais pela página de detalhe).

**Ordem decidida pelo dono p/ as próximas sessões:** **#221** (estúdio, #222→#227) → **#188** (tempo de preparo, **grill primeiro**) → **#238** (seed, depende do dono). Racional: #221 tem o maior valor + domínio pronto; #238 por último porque aí as receitas-semente já nascem com imagem (#221) e tempo de preparo (#188).

## O que esta sessão entregou (referência, não re-fazer)

SEO #187, tudo na `main` — ver o comentário de status em `gh issue view 187` e os PRs:
- **#245** fix do script de backfill (rodava em CJS quebrado por top-level await) + **backfill RODADO no prod** (9 traduções pt-BR, 0 NULL).
- **#246** (#243) freeze do slug blindado · **#247** (#232/#233/#234, **um PR só** — mesmo `generateMetadata`) OG/canonical/hreflang/robots/JSON-LD · **#248** (#235) sitemap+robots.txt · **#249** (#237) disclosure-config (migração **0024**) · **#250** (#231) links→canônico · **#251** (#236) fusão feed-home.
- Memória `seo-bilingual-discovery-initiative.md` atualizada com as decisões/gotchas (NÃO re-litigar).

**Estado do SEO em prod (p/ o dono):** migração 0024 aplica no deploy; **disclosure nasce DESLIGADO** (liga em `/admin/ai`); **a home virou feed-first** (`/{locale}` é a Descoberta; `/recipes`→308→home) — vale verificação visual no preview. `getBaseUrlFromEnv` exige `APP_URL` ou `VERCEL_URL` (Vercel seta `VERCEL_URL` sozinho).

## Próxima perna A — Estúdio de imagem #221 (começar AQUI)

Plano completo já no **handoff 33** (`docs/handoffs/33-dev-phase-image-studio-e-seo-planejados.md`, seção "Perna A") — **ainda válido**, não duplico. Resumo:
- Domínio: **ADR-0022** + glossário no `CONTEXT.md` + memória `image-studio-initiative.md`. Stopgap #214 já na main (abuso do prompt bloqueado).
- 6 fatias: **#222** spine (galeria + preview + selecionar/apagar) → **#223** refino-ancorado · **#224** cost-tracking · **#225** moderação×galeria · **#226** restrição-de-conta · **#227** review_required.
- **#222/#224/#226/#227 têm migração → merges sequenciais** (cada migração gera off a main atualizada; só paralelizar o que não colide em `schema.ts`/`image.ts`). Reusar o backend de geração, ADR-0016/0017, cap #167, moderação #133 — não reescrever.

## Próxima perna B — Tempo de preparo #188 (NÃO é dev direto: grill→ADR→migração)

É um **campo invariante novo** da Receita → congela schema → **merece grill antes** (já marcado assim). A ideia do dono é **tempo por passo, total = soma**. Furos a resolver no grill (use `/grill-with-docs`):
1. **Passos paralelos/de espera quebram a soma.** "Marinar 8h" + "picar cebola 5 min": somar dá 8h05 de "trabalho", mas só houve 5 min ativos. Somar tudo superestima.
2. **Tempo ATIVO (mão na massa) ≠ TOTAL (relógio na parede).** schema.org separa `prepTime`/`cookTime`/`totalTime`, e o total **não** é sempre a soma (passos se sobrepõem). Decidir: campo "ativo", "total", ou ambos; e se passo-de-espera entra com flag.
3. **Bônus de SEO — fecha o follow-up do #234.** O JSON-LD Recipe (#234, na main) **deixou de fora de propósito** `prepTime`/`cookTime`/`totalTime` (ver review do PR #247). #188 alimenta esses campos → registrar no ADR e plumbar no `buildRecipeJsonLd` (`src/domain/recipe-seo.ts`).
- Saída do grill: ADR + migração + issue(s) refatoradas; só então dev.

## Próxima perna C — Seed do catálogo #238 (HITL/humano, por último)

`ready-for-human`: gerar com **nosso AI + curadoria humana** → `origin=catalog`; **NUNCA copiar texto/foto da web** (ADR-0019). Depende do dono. Por último p/ as sementes já nascerem com imagem (#221) e tempo (#188), deixando o catálogo indexável completo.

## Pipeline de dev (reusar — provado nesta sessão e nas anteriores)

Por **issue/onda**: agente `isolation:'worktree'` implementa com **TDD** → push/PR → **review adversarial 3 lentes** (correção / aderência-ADR+invariantes / qualidade-de-testes) → **fix** dos achados → **poll de CI** → **squash-merge no foreground quando CI verde** (repo NÃO tem auto-merge) → cleanup do worktree. Ondas cruzadas por arquivos disjuntos; **migrações sequenciais**. O review adversarial **pegou bugs reais antes do merge** nesta sessão (build-throw do sitemap, robots `/admin` não casando locale, false-green do wiring SQL→DTO, vazamento de privada na paginação do feed-home) — vale o custo.

## Gotchas de ambiente (atualizados nesta sessão)

- **Rota estática que usa `getBaseUrlFromEnv` precisa `export const dynamic = 'force-dynamic'`.** O smoke-check do CI (`npm run build`, `NODE_ENV=production`) **não tem** `APP_URL`/`VERCEL_URL`, e `getBaseUrlFromEnv` **lança** sem elas; o Next tentava pré-renderizar `sitemap.ts`/`robots.ts` no build e estourava. `force-dynamic` faz renderizar em runtime (na Vercel a env existe). **Valide novas rotas com** `APP_URL= VERCEL_URL= BETTER_AUTH_SECRET=dummy_... npm run build` (a rota deve sair `ƒ`, não estática). O detalhe e a home já são `ƒ` (lêem `headers()`/`searchParams`), então não estouram.
- **Issues fortemente acopladas no MESMO arquivo/função podem virar 1 PR** (fiz #232/#233/#234 juntas — todas no mesmo `generateMetadata`) p/ evitar rebase em cima de si. Mantenha PRs separados quando os arquivos forem disjuntos.
- **`.env.local` É PROD** — NUNCA `db:migrate`/`db:push` local; **só gerar** a migração + migrate-on-deploy. (O backfill via `npm run` é OK e idempotente — mas é prod, rodar consciente.)
- Worktree off `origin/main` + **hardlink** node_modules (`cp -al /home/ferna/projects/refogando/node_modules node_modules`, nunca symlink). Após mergear, `git worktree remove --force` (o branch local fica e dá pra `git branch -D`).
- Testar **focado** (`npx vitest run <arquivos>`), endpoint **direto/unpooled** (strip `-pooler`); a suíte node completa flaka no Neon concorrente → confiar na CI no resto.
- Commits **via branch + squash PR**; merge **quando CI verde** (sem gate de preview; AFK = subagentes revisam). O poll de CI em `gh pr checks <n>` num loop `run_in_background` funcionou bem nesta sessão.

## Critério de saída (perna A — #221)

Todas as #222–#227 mergeadas na main, CI verde, reviews adversariais satisfeitos, migrações aplicadas em ordem. Depois: handoff novo apontando p/ #188 (grill) ou #238 (humano).

## Suggested skills (próxima sessão)

- **`/grill-with-docs`** — ANTES do #188 (decisão que congela schema; resolver ativo-vs-espera, ativo-vs-total, e o tie-in de JSON-LD do #234).
- **`tdd`** — red-green em cada fatia do #221.
- **`review`** / fan-out de subagentes de review — o passo adversarial 3-lentes por PR (correção / ADR-invariantes / testes).
- **`Workflow`** (orquestração multi-agente em worktrees) — se o dono optar por ondas paralelas; senão, agentes individuais sequenciais (como esta sessão) também funcionam.
- **`handoff`** — ao fim da perna A.

---

## Prompt de kickoff — Estúdio de imagem #221 (próximo)

```
Retomando o refogando: DEV do Estúdio de imagem por IA (épico #221). O épico SEO #187 foi concluído na sessão anterior (main f137d5a) — leia docs/handoffs/34-seo-187-dev-completo-proxima-estudio-imagem-221.md e docs/handoffs/33-dev-phase-image-studio-e-seo-planejados.md (seção "Perna A") + o ADR docs/adr/0022-*.md + os termos do CONTEXT.md (Galeria de imagens, Imagem da receita evoluída, Restrição do autor) + a memória image-studio-initiative. As 6 issues já existem (#222-#227); confira com gh issue list. O stopgap de segurança #214 já está na main (o abuso do prompt está bloqueado). Implemente por issue: subagente em worktree isolado com TDD → PR → review adversarial 3-lentes (correção / aderência-ADR+invariantes / qualidade-de-testes) → fix → squash-merge no foreground quando a CI verde (repo NÃO tem auto-merge). Comece pela spine #222 (galeria + preview + selecionar/apagar), depois #223 refino-ancorado, #224 cost-tracking, #225 moderação×galeria, #226 restrição-de-conta, #227 review_required. ATENÇÃO: #222/#224/#226/#227 carregam MIGRAÇÃO → merges sequenciais (cada migração gera off a main atualizada). Reuse o backend de geração + ADR-0016/0017 + cap #167 + moderação #133 — não reescreva. Gotchas: branch off origin/main, hardlink node_modules (cp -al, nunca symlink), testar focado no projeto vitest "ui"/node com endpoint direto (sem -pooler), .env.local É PROD (migração só GERADA, migrate-on-deploy), e qualquer rota nova que use getBaseUrlFromEnv e seja estática precisa de export const dynamic='force-dynamic' (senão o smoke-check do build estoura sem APP_URL). Depois do #221, a ordem é #188 (tempo de preparo — NÃO dev direto: rodar /grill-with-docs primeiro, resolver passo-ativo-vs-espera e tempo-ativo-vs-total, e fechar o follow-up de prepTime/cookTime/totalTime no JSON-LD do #234) e por fim #238 (seed do catálogo, HITL/humano). NÃO comece o #188 sem grill nem o #238 (depende do dono).
```
