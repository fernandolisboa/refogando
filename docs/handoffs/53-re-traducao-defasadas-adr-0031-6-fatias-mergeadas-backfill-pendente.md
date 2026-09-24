# Handoff 53 — Re-tradução de defasadas (ADR-0031) DESENHADA + 6 fatias MERGEADAS+PROD; backfill de fingerprints pendente (bloqueado por trava de prod)

**Data:** 2026-07-05 · **Branch base:** `main` (HEAD `2519669`) · **Contexto:** esta sessão pegou o handoff 52 (que apontava a máquina de staleness cross-locale como o maior valor pendente do #426), grelhou o desenho até fechar o **ADR-0031**, fatiou em 6 issues e **implementou+mergeou todas** via Workflow/subagentes em worktrees. Também fechou a ação humana do #426 (backfill de nomes) e entregou um checklist LGPD em HTML.

## TL;DR

1. ✅✅ **Máquina de re-tradução de traduções defasadas — DESENHADA (ADR-0031) e 100% IMPLEMENTADA+DEPLOYADA.** 6 fatias (#496/#497/#498/#499/#500/#501) mergeadas e fechadas; migração 0058 (2 colunas de fingerprint) aplicada em PROD. Desenho em **`docs/adr/0031-re-traducao-de-defasadas-fingerprint-de-fonte-e-mt-intocada.md`** (endurecido no grill + review adversarial do diff, incl. fecho de um TOCTOU).
2. ✅ **Ação humana do #426 FECHADA:** rodei `npm run backfill-ingredient-names` (225/225 receitas do catálogo com nome de ingrediente em en-US).
3. ✅ **Checklist LGPD em HTML** entregue em `docs/checklists/lgpd-acoes-do-dono.html` (checkboxes com `localStorage`) — novo padrão de artefato pra ações do dono.
4. 🧑 **UMA ação humana pendente do ADR-0031:** rodar `npm run backfill-translation-fingerprints` (torna o acervo existente auto-elegível à re-tradução) — **sem LLM, só hashes, idempotente**, mas a **trava de auto-mode bloqueou** por ser mutação de prod não pré-autorizada. Ver §3. + as ações LGPD do handoff 51/52 seguem pendentes.

## 1. O que foi entregue (ler os artefatos, não re-derivar)

Modelo do ADR-0031: **pull por dois fingerprints** (`source_fingerprint`/`mt_fingerprint` em `recipe_translation`). Defasada e intocada são **derivadas por comparação** — `decideStale` e o teste travado "nunca espalha" ficaram **intactos**. Termos novos no `CONTEXT.md`: **Re-tradução / defasada / intocada**.

| PR | Fatia | Migração |
|---|---|---|
| #503 | **A** fundação: `translation-fingerprint.ts` (hash puro) + colunas + `ensureTranslation` grava os 2 | **0058** (2 ADD COLUMN) |
| #506 | **(ii)** nome de ingrediente no texto embedado da Busca + bump `EMBEDDING_VERSION` (reembed self-healing) | — |
| #507 | **(iii)** Curador edita nome traduzido (`PATCH .../translations/[locale]`, gate comunidade) | — |
| #508 | **D** backfill idempotente de fingerprints dos legados (migração agressiva) | — |
| #509 | **B** worker `retranslateOutdated(db,limit)` + rota `/api/admin/translations/retranslate` + UI (`/admin/descoberta`) | — |
| #512 | **C** lista do Curador das defasadas-e-divergentes (`/api/curate/translations/divergent-stale`) | — |

## 2. Invariantes/landmines que esta sessão fixou (não quebrar)

- **Espelhamento do fingerprint é segurança-crítico:** escrita (`ensureTranslation`) e comparação (worker/backfill/lista) DEVEM construir o hash idêntico. B extraiu **`sourceFingerprintOf`/`mtFingerprintOfRow`** (`src/domain/translation-fingerprint.ts`) e refatorou `ensureTranslation` pra usá-los; C reusa o **próprio `loadRecipeTranslationContext`** como fonte (impossível divergir). Qualquer novo call-site: reuse esses helpers/loader, NUNCA reconstrua à mão.
- **Trava de segurança = MT intocada, NÃO proveniência:** o worker só sobrescreve linha onde `mtFingerprintOfRow(conteúdo atual) == mt_fingerprint` gravado. `mt_fingerprint` NULL ⇒ nunca intocada (protege legado/humano). Editar via a rota do Curador (iii) muda o jsonb mas **não** o campo `mt_fingerprint` ⇒ a linha vira não-intocada ⇒ protegida.
- **TOCTOU fechado:** `retranslateOne` **re-verifica intocada** (recomputa do conteúdo fresco vs o `mt_fingerprint` do scan) ANTES de gastar LLM — edição concorrente vira `skipped` (vai pro Curador), não sobrescreve.
- **Degradação POR LINHA** (não aborta o lote): tradutor lança ⇒ `degraded` (fica defasada, retry); `{retranslated, degraded, remaining}`. (Corrigi a contradição do texto original da decisão 5 do ADR.)
- **`ingredientesJsonb` é `null` ou não-vazio, NUNCA `[]`** — os helpers de hash colapsam `[]`→null defensivamente; a construção do D usa `? :` (trataria `[]` como truthy), mas como `[]` nunca ocorre no dado, não há divergência real. **Consistência latente** (não-bug): D duplica a construção em vez de usar os helpers do B — consolidar é polimento opcional.
- Slug congelado, medida invariante (Direção B), GET read-only (nunca re-traduz on-read): todos preservados.

## 3. AÇÕES HUMANAS PENDENTES

1. **`npm run backfill-translation-fingerprints`** (ADR-0031 dec.7) — preenche `source_fingerprint` em todas as derivadas + `mt_fingerprint` nas `automatica_nao_revisada` (confiáveis ficam NULL). **Sem LLM, só hashes, idempotente, ~centenas de linhas.** Torna o acervo existente auto-elegível; sem ele, só traduções NOVAS (pós-deploy) entram na re-tradução automática, e as defasadas legadas caem na lista do Curador. **A trava de auto-mode bloqueou** (mutação de prod não pré-autorizada) — rode você (`! npm run backfill-translation-fingerprints`) ou autorize num próximo turno.
2. **Re-tradução automática** é ação de Admin: em `/admin/descoberta`, botão capado/retomável (chama até `remaining===0`; **gasta LLM** — custo controlado por você). Só depois do backfill (1) fazer sentido pro acervo legado.
3. **(ii) Backfill de embeddings** (bump `EMBEDDING_VERSION`): rodar o backfill de embedding existente (`/admin` → recompute) até `remaining===0` pra o nome de ingrediente entrar no índice semântico. Gasta chamadas de embedding.
4. **LGPD (handoff 51/52 §4, ainda pendentes):** ver **`docs/checklists/lgpd-acoes-do-dono.html`** — alias `privacidade@refogando.com`; envs Brevo (`BREVO_API_KEY`/`DSAR_MAIL_FROM`/`DSAR_DPO_EMAIL`); confirmar `CRON_SECRET` + `WEB_SEARCH_API_KEY` em PROD; redeploy; fechar #276.

## 4. Próximos passos (sugestão)

- Rodar o backfill de fingerprints (§3.1), depois disparar a re-tradução do acervo pelo `/admin/descoberta` (§3.2).
- Deferidos que continuam deferidos (não abri issue): staleness por **edição de invariante** que afete a tradução (não há); re-tradução em **cron** (descartada no ADR — trivial de somar se quiser hands-off).
- Polimento opcional: fazer o backfill (D) reusar `sourceFingerprintOf`/`mtFingerprintOfRow` (single-source; ver §2).

## 5. Gotchas de ambiente (confirmados nesta sessão)

- **Subagentes de Workflow/Agent caem em Opus 4.8 por padrão** e estouram o limite — cravei `model:'sonnet'` nos agentes de implementação (rodaram bem). Ver memória `workflow-subagents-default-opus-pin-model`.
- **Subagentes de implementação às vezes param esperando a suíte `node` inteira** (o global-setup do banco é lento) e NÃO fecham o PR sozinhos — retomar via `SendMessage` mandando rodar só typecheck/lint/ui + testes focados e abrir o PR. Aconteceu com ii e C.
- **CI (`checks`) ~14-15min**; gatear com `gh run watch <run-id> --exit-status` em background. **Vercel PREVIEW passou** nos PRs com e sem migração desta vez (não flakou). Confirmar deploy PROD pós-merge (fatia A `success`).
- **Repo SEM branch-protection:** `--squash` mergeia na hora; `gh pr merge --delete-branch` FALHA em branch de worktree (o merge remoto acontece; limpar worktree+branch à mão).
- Worktrees em `.claude/worktrees/`, branch de `origin/main`, `node_modules`+`.env.local` por symlink; `db:generate` SEMPRE dentro da worktree. Migração aplica on-deploy (nunca `db:migrate` local).
- **Trava de auto-mode bloqueia mutação de prod** não pré-autorizada mesmo sob "autonomia genérica" — backfills que mexem no banco precisam de autorização específica do dono (rode com `!` ou peça OK).

## Critério de saída (deste handoff)

- ADR-0031 + `CONTEXT.md` mergeados (#495); 6 fatias mergeadas+fechadas + migração 0058 em PROD (✅). Único pendente da máquina = o backfill de fingerprints (ação do dono, §3.1) + a re-tradução via Admin (§3.2).

## Referências

- ADR: `docs/adr/0031-re-traducao-de-defasadas-fingerprint-de-fonte-e-mt-intocada.md`. Glossário: `CONTEXT.md` (Re-tradução).
- Núcleo: `src/domain/translation-fingerprint.ts` (`fingerprintSource`/`fingerprintMt`/`sourceFingerprintOf`/`mtFingerprintOfRow`); `src/server/translation/retranslate.ts` (`retranslateOutdated`); `src/server/curate/translation-divergent-stale.ts` (lista do Curador); `scripts/backfill-translation-fingerprints.ts`. Escrita: `src/server/recipe/translation.ts` (`ensureTranslation`).
- Issues: #496-#501 (fechadas). Handoff anterior: `docs/handoffs/52-426-traducao-real-feita-bilingue-removido-followups-fechados.md`.
- Memórias-chave: `traducao-real-426-feita`, `workflow-subagents-default-opus-pin-model`, `medida-ingrediente-fonte-unica-direcao-b`.

## Suggested skills (próxima sessão)

- **Nenhum `/grill` nem `/to-issues`** — a máquina está entregue; o que resta são ações humanas (§3).
- Se for mexer nos deferidos: `/grill-with-docs` antes (mexe em regra de domínio).
- `/handoff` de novo ao fim da próxima leva.

---

### Prompt de kickoff (copiar/colar na próxima sessão)

Continuar o Refogando a partir do handoff 53 (docs/handoffs/53-re-traducao-defasadas-adr-0031-6-fatias-mergeadas-backfill-pendente.md). Estado: a máquina de re-tradução de traduções defasadas (ADR-0031) está 100% implementada e em PROD — 6 fatias mergeadas (#496-#501), migração 0058 aplicada, modelo pull por fingerprints (source/mt) com trava de MT intocada e TOCTOU fechado; decideStale e o teste "nunca espalha" intactos. FALTAM só AÇÕES HUMANAS do dono: (1) rodar `npm run backfill-translation-fingerprints` (sem LLM, só hashes, idempotente — torna o acervo legado auto-elegível; a trava de auto-mode bloqueou por ser mutação de prod, então rode com `!` ou autorize); (2) disparar a re-tradução do acervo em /admin/descoberta (botão capado/retomável, gasta LLM); (3) opcional: backfill de embeddings pós bump de EMBEDDING_VERSION (fatia ii) via /admin recompute; (4) LGPD pendente — ver docs/checklists/lgpd-acoes-do-dono.html. Landmines duráveis: o espelhamento do fingerprint é segurança-crítico (reuse sourceFingerprintOf/mtFingerprintOfRow ou loadRecipeTranslationContext, nunca reconstrua à mão); subagentes de Workflow caem em Opus por padrão (cravar model); repo sem branch-protection (squash mergeia na hora, gatear no check "checks" ~14min); mutação de prod precisa de autorização específica mesmo sob autonomia. Comunicar sempre em português.
