# Handoff 54 — Lista de compras (ADR-0032) 6 fatias MERGEADAS+PROD; passe de review da re-tradução aplicado; acervo re-traduzido

**Data:** 2026-07-06 · **Branch base:** `main` (HEAD `284f346`) · **Contexto:** sessão longa que fechou 3 frentes — (1) endureceu a máquina de re-tradução (ADR-0031) com um passe de review adversarial 3-lentes; (2) rodou de verdade a re-tradução do acervo em PROD; (3) grelhou, desenhou (ADR-0032) e implementou a **lista de compras** inteira (#474) em 6 fatias. Também: backfill de nomes de ingrediente (#426) e checklist LGPD em HTML.

## TL;DR

1. ✅✅ **Lista de compras (#474) 100% IMPLEMENTADA+MERGEADA.** 6 fatias (#525/#526/#527/#528/#529/#530) em PROD; migração 0063 (2 tabelas). Desenho em **`docs/adr/0032-*.md`** + termo no `CONTEXT.md` (**Lista de compras**).
2. ✅ **Passe de review adversarial da re-tradução (ADR-0031) aplicado** (PR #519): fechou 1 ALTA (TOCTOU no commit) + 2 MÉDIA (gate de moderação, DRY). Deferido: #520 (circuit-breaker de linha envenenada).
3. ✅ **Acervo re-traduzido+re-embedado em PROD** (autorizado pelo dono): backfill fingerprints (225+225) → bump `TRANSLATION_PROMPT_VERSION`→2 (#516) → re-tradução 225/225 do catálogo (RealTranslator) → recompute 239 embeddings.
4. ✅ **Ação humana do #426 fechada** (`npm run backfill-ingredient-names`, 225/225) + **checklist LGPD** em `docs/checklists/lgpd-acoes-do-dono.html`.
5. 🧑 **GitHub Actions SEM cota** (o dono resolve depois): a fatia C (#528) foi mergeada no **verde-local** (typecheck+lint+build+136 testes shopping-list verdes na main) porque o CI falhava em 2s por limite de minutos — NÃO por código. Ver §5.

## 1. Lista de compras — o que foi entregue (ler os artefatos, não re-derivar)

Desenho: **`docs/adr/0032-lista-de-compras-multiplas-agregacao-por-ingrediente-snapshot.md`**. Decisões do grill: múltiplas listas nomeadas (+ padrão); agregação por `ingredient_id`-ou-`normalize(nome)`, soma só unidade idêntica (**nunca converte**); snapshot escalado por porções-alvo; storage = **linhas agregadas** (check-off/edição por linha); edição à mão + check-off persistente.

| PR | Fatia | Nota |
|---|---|---|
| #532 | **A1** container: 2 tabelas + CRUD listas + `ensureDefaultShoppingList` | migração **0063** (renumerada de 0062 por colisão com #531) |
| #535 | **A2** tracer: adicionar-de-receita + agregação/merge (upsert `NULLS NOT DISTINCT`) | o coração; `computeMatchKey`/`combineQuantidade` puros |
| #537 | **E** multi-add (N receitas, base) | extraiu `addRecipeItemsToList` |
| #539 | **D** check-off persistente + remover-marcados + limpar | criou a página `/me/shopping-lists/[listId]` |
| #538 | **B** escala por porções-alvo (reusa #452) | escala move-se p/ dentro de `addRecipeItemsToList` |
| #540 | **C** edição à mão (avulso + editar qtd + remover) | fundiu PATCH; UI dentro da página do D |

## 2. Invariantes/landmines desta entrega (não quebrar)

- **Merge/agregação (A2):** chave = `ingredient_id` (as text) senão `normalize(nome)` (reusa `normalizeText` de `recipe-restrictions.ts`). Upsert por `(list_id, match_key, unidade)` via índice **UNIQUE `NULLS NOT DISTINCT`** — soma `quantidade` só com unidade idêntica; **NULL nunca vira zero** (ausente preserva o presente); `source_recipe_id` vira NULL quando mescla ≥2 fontes. NUNCA converte unidade (Direção B).
- **Escala (B) dentro do núcleo:** `addRecipeItemsToList(porcoesAlvo?)` — single escala, **batch (E) chama sem porcoesAlvo ⇒ base** (dec.7, tem teste provando). Receita sem `porcoes` ⇒ base + `warning:'sem_porcoes'`.
- **PATCH `items/[itemId]` discrimina o corpo:** `{checked}` → toggle (D), `{quantidade}` → editar (C), nenhum → 400. Não separar em 2 rotas.
- **UI única:** a página canônica é a do D (`me/shopping-lists/[listId]`); C injetou os controles de edição DENTRO do `shopping-list-items-view.tsx` (a UI paralela do C foi descartada). B/E têm gatilhos próprios (botão na receita / bar em salvos).
- **NUL-byte gotcha:** a bucket-key do domínio usava separador NUL (git tratava como binário) — trocado por `JSON.stringify([matchKey, unidade])`. Não reintroduzir separador de controle.

## 3. Re-tradução (ADR-0031) — review aplicado + acervo materializado

- **PR #519** (review 3-lentes): (a) **TOCTOU real** — o re-check pré-LLM não fechava a janela re-check→commit; agora o commit roda em transação com `SELECT ... FOR UPDATE` + re-verificação de intocabilidade **sob lock** (CAS por campo não serve — a edição do Curador muda o jsonb, não o `mt_fingerprint`). (b) **Gate de moderação** `isNull(moderation_removed_at)` em `loadCandidates`. (c) **DRY** — worker/lista usam `isDefasada`/`isDivergente` + `sourceFingerprintOf`/`mtFingerprintOfRow` (fonte única). Deferido: **#520**.
- **Acervo em PROD:** ver memória `re-traducao-defasadas-adr-0031`. Padrão de disparo em lote: script throwaway `scripts/_run-*.ts` (removido após) chamando `retranslateOutdated`/`recomputeMissingEmbeddings(getDb(), N)` em loop até `remaining=0`. **Trava de auto-mode exige autorização explícita do dono** pra mutação de prod.

## 4. Próximos passos (sugestão)

- **Nenhum trabalho de código pendente meu.** O backlog aberto é `ready-for-human`: #467 (fiscal/billing — bloqueia billing), #468 (nav "Salvos"), #470 (enumeração de conta — depende do mailer LGPD), #469 (esqueci-senha), #471 (analytics), #472 (copy marca), #276/#473 (LGPD/legal). #520 (circuit-breaker re-tradução, `ready-for-agent`, baixa prioridade/teórico).
- **Planejador semanal** é o próximo degrau natural da lista de compras (a agregação + porções-alvo já existem) — precisa de grill/ADR.
- Se pegar uma issue `ready-for-human`: a maioria precisa de **decisão do dono** (fiscal, vendor) — grelhar antes.

## 5. Gotchas de ambiente (confirmados/novos nesta sessão)

- **GitHub Actions SEM cota (2026-07-06):** runs falham em ~2s com **0 steps** e "log not found" (o runner nem é atribuído) — é limite de minutos, NÃO falha de código. Distinguir de falha real: run real gasta ≥30s e tem log. Quando isso acontecer e o verde-local estiver completo (typecheck+lint+`next build`+testes focados), o dono OK'd mergear no verde-local (repo sem branch-protection). **`next build` é um step do CI que os subagentes NÃO rodam** — rodar localmente antes de mergear-sem-CI.
- **Fan-out de 4 fatias no mesmo módulo → merge SEQUENCIAL com reconciliação:** mergear 1, e cada **agente-autor rebasa a própria fatia** via `SendMessage` (quem escreveu entende o refactor) — melhor que eu reconciliar 4 refactors do mesmo arquivo à mão. Ordem importa (E extraiu núcleo → B/C/D reconciliam nele). i18n colide sempre (mesmo namespace novo) — fusão aditiva.
- **Subagentes de implementação (Agent tool, model:'sonnet') às vezes param esperando a suíte `node` inteira e não fecham o PR** — retomar via `SendMessage` mandando rodar só typecheck/lint/ui + focados. Aconteceu com vários.
- **Colisão de número de migração** com sessões concorrentes (o dono rodou #531 fase-2-billing em paralelo → 0062): `git checkout --theirs` no `_journal.json`+snapshot, `git rm` a própria `.sql`, `npm run db:generate` (renumera). Deu 0063.
- CI ~14-16min; `gh run watch <id> --exit-status` em background; repo sem branch-protection (`--squash` mergeia na hora; `--delete-branch` falha em worktree, limpar à mão).

## Critério de saída (deste handoff)

- #474 (lista de compras) FECHADA: 6 fatias mergeadas + migração 0063 em PROD + 136 testes shopping-list verdes na main (✅). ADR-0031 endurecido (#519) + acervo re-traduzido (✅). Nada de código meu pendente.

## Referências

- ADRs: `docs/adr/0032-*.md` (lista de compras), `docs/adr/0031-*.md` (re-tradução). Glossário: `CONTEXT.md` (**Lista de compras**, **Re-tradução**).
- Núcleo lista: `src/domain/shopping-list.ts` + `src/domain/shopping-list-item.ts` (`computeMatchKey`/`combineQuantidade`/`resolveShoppingListScale`/`validateAdhocItem`); `src/server/shopping-list/shopping-list.ts` (`addRecipeItemsToList`/`upsertShoppingListLines` + as funções por-fatia); rotas `src/app/api/me/shopping-lists/**`; UI `src/app/[locale]/me/shopping-lists/[listId]/` + `src/components/shopping-list/`.
- Issues: #474 (pai), #525-#530 (fatias, fechadas), #520 (re-tradução deferido). Handoff anterior: `docs/handoffs/53-*.md`.
- Memórias-chave: `re-traducao-defasadas-adr-0031`, `workflow-subagents-default-opus-pin-model` (gotchas de fan-out/Actions), `medida-ingrediente-fonte-unica-direcao-b` (Direção B).

## Suggested skills (próxima sessão)

- **`/grill-with-docs`** ANTES de qualquer feature nova (planejador semanal; ou destravar uma `ready-for-human` que seja decisão de produto).
- Dev de fatias: **Agent tool** (model:'sonnet') em worktrees; mergear no verde do `checks` (quando a cota do Actions voltar) — senão verde-local completo (incl. `next build`) com OK do dono.
- `/handoff` de novo ao fim da próxima leva.

---

### Prompt de kickoff (copiar/colar na próxima sessão)

Continuar o Refogando a partir do handoff 54 (docs/handoffs/54-lista-de-compras-adr-0032-6-fatias-mergeadas-review-retraducao.md). Estado: a lista de compras (#474) está 100% implementada e em PROD — 6 fatias mergeadas (#525-#530), migração 0063 (2 tabelas), desenho no ADR-0032, 136 testes shopping-list verdes na main. A máquina de re-tradução (ADR-0031) foi endurecida por um passe de review adversarial (#519: TOCTOU no commit fechado via SELECT FOR UPDATE, gate de moderação, DRY) e o acervo foi re-traduzido+re-embedado em PROD (225/225 + 239 embeddings). NÃO há trabalho de código meu pendente. O backlog aberto é todo ready-for-human (decisões de produto/fiscal/LGPD): #467 fiscal-billing, #468 nav-Salvos, #469 esqueci-senha, #470 enumeração-conta, #471 analytics, #472 copy-marca, #276/#473 LGPD/legal; + #520 (circuit-breaker de re-tradução, ready-for-agent, baixa prioridade). GOTCHA CRÍTICO: o GitHub Actions está SEM cota de minutos (runs falham em ~2s com 0 steps / log inexistente — é billing, não código); o dono vai resolver depois, então até lá gatear com verde-local COMPLETO (typecheck+lint+next build+testes focados) e mergear no verde-local com OK do dono (repo sem branch-protection). Próximo degrau natural da lista de compras = planejador semanal (precisa grill/ADR). Comunicar sempre em português; mutação de prod (backfills) exige autorização explícita; subagentes via Agent tool model:'sonnet' em worktrees, e cada autor rebasa a própria fatia num fan-out sobre o mesmo módulo.
