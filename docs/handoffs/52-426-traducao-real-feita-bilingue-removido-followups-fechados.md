# Handoff 52 — #426 (tradução real por LLM) FEITO+DEPLOYADO; rótulo "bilíngue" removido; follow-ups #435/#436/#437 fechados

**Data:** 2026-07-04 · **Branch base:** `main` (HEAD `b4bc895`) · **Contexto:** esta sessão pegou o handoff 51 (que apontava #426 como próximo) e entregou o #426 inteiro + os 3 follow-ups + um pedido urgente do dono (remover "bilíngue" da UI). Tudo em PROD.

## TL;DR

1. ✅✅ **#426 (tradução real por LLM + nome de ingrediente por-locale) FECHADO e DEPLOYADO em PROD.** Duas fatias (#439 + #440), migração 0052 aplicada no Neon principal. Desenho em **`docs/adr/0030-*.md`** (endurecido por 2 rodadas de revisão adversarial: desenho + código).
2. ✅ **Rótulo "bilíngue" removido da UI** (#441, PROD) — pedido enfático do dono. **Regra durável gravada** na memória `nunca-rotular-app-como-bilingue`: nunca chamar o app de "bilíngue"/"bilingual" nem enumerar idiomas em texto de PRODUTO (espanhol é plano futuro).
3. ✅ **Follow-ups #435/#436/#437 FECHADOS** (#442, PROD) — polimento da Wave 2 do #381.
4. 🧑 **UMA AÇÃO HUMANA PENDENTE do #426: o dono roda `npm run backfill-ingredient-names`** (decisão dele nesta sessão). + as ações LGPD do handoff 51 §4 seguem pendentes (não tocadas).

## 1. O que foi entregue (ler os artefatos, não re-derivar)

| PR | Escopo | Migração |
|---|---|---|
| #439 | Fatia 1 #426: `RealTranslator` real + glossário culinário + `translation-prompt.ts` (schema/prompt/fidelidade) | — |
| #440 | Fatia 2 #426: nome de ingrediente por-locale (`recipe_translation.ingredientes` jsonb + `prompt_version`) + display auto-validante + backfill | 0052 |
| #441 | remover "bilíngue" de 4 superfícies de usuário (privacidade, manifest, metadata) | — |
| #442 | follow-ups #435 (Dificuldade morta) + #436 (teto voice_note) + #437 (fixtures do comparador) | — |

Detalhes duráveis do #426: ADR-0030 + memória **`traducao-real-426-feita`**. Não re-derivar.

## 2. Invariantes/landmines que esta sessão fixou (não quebrar)

- **Sonnet 5 roda adaptive-thinking por OMISSÃO** (oposto do Opus 4.8): o `RealTranslator` passa **`thinking:{type:'disabled'}` EXPLÍCITO** — senão os tokens de thinking dividem o teto com o JSON structured e a saída TRUNCA → degrada. (Fato durável para qualquer novo cliente Sonnet 5.)
- **Contrato de erro do `RealTranslator` é INVERSO ao do `ClaudeClient`:** LANÇA em falha/infidelidade (não devolve `parse_failed`), porque `ensureTranslation` degrada por try/catch (AC4). A fidelidade é validada PÓS-parse por `assertFaithfulTranslation` (puro, testável) — schema sozinho não basta (um parse lossy é válido p/ o schema).
- **Nome de ingrediente por-locale é auto-validante por `nomeOrigem`:** o jsonb guarda `{ordem, nome, nomeOrigem}`; o display (`resolveRecipeView`) usa o traduzido só quando `nomeOrigem === raw_text ATUAL`. Edição só-de-medida MANTÉM a tradução; rename/reorder cai no `raw_text` (correto). `replaceIngredients` NÃO invalida. A MEDIDA (quantidade/unidade) fica idêntica entre locales (Direção B).
- **Schema structured SEM bounds em array** (`.min/.max/.length` hoistam p/ $defs/$ref → 400, landmine #423). Cardinalidade/comprimento validam no app.

## 3. AÇÃO HUMANA PENDENTE do #426 (dono decidiu rodar ele mesmo)

**`npm run backfill-ingredient-names`** — traduz os nomes de ingrediente das **225 receitas do catálogo semeado** que já têm linha en-US (o `ensureTranslation` curto-circuita em `exists`, então só o backfill cobre o acervo pré-fatia). **Muta prod + custo LLM (~US$5-12), idempotente, gracioso** (falha do tradutor → deixa NULL, cai no raw_text). Precisa de `ANTHROPIC_API_KEY` no ambiente. Sem isso, o catálogo/SEO em en-US segue com nome de ingrediente em PT; o conteúdo NOVO já sai traduzido on-demand.

## 4. Próximos passos (ordem sugerida)

1. **Deferido do #426 → issue própria (o maior valor técnico pendente):** reativar a **máquina de staleness cross-locale** + **re-tradução de stale**, com um sinal seguro que distinga "stale-por-mudança-do-original" de "hand-edited-pelo-Curador" (senão a re-tradução SOBRESCREVE trabalho do Curador — foi o achado que matou o clear-on-edit; usar `prompt_version` e/ou o gatilho cross-locale). Também deferido: nome de ingrediente no **embedding da Busca** (exige bump `EMBEDDING_VERSION` + backfill) e edição do nome traduzido pelo **Curador na fila**. Precisa de `/grill-with-docs` (mexe no `decideStale` puro do #3 e em testes travados "nunca espalha").
2. **LGPD — ações humanas do dono (do handoff 51 §4, ainda pendentes):** alias `privacidade@refogando.com`; envs `BREVO_API_KEY`/`DSAR_MAIL_FROM`/`DSAR_DPO_EMAIL`; `WEB_SEARCH_API_KEY`+redeploy. #276 aberta só p/ sign-off.

## 5. Gotchas de ambiente (aprendidos/confirmados)

- **Regra do dono (dura, gravada):** nunca rotular o app como "bilíngue"/enumerar idiomas em texto de usuário. Ver memória `nunca-rotular-app-como-bilingue`.
- **Revisão de CÓDIGO (diff) pega o que a de DESENHO (ADR) não pega:** a revisão do diff da Fatia 2 achou que o clear-on-edit perderia os nomes permanentemente — daí o `nomeOrigem`. Sempre revisar o diff adversarialmente, não só o ADR.
- **CI ~14 min; gatear no check `checks`.** O Vercel PREVIEW de PR com migração *costuma* flakar (Neon efêmero) mas nesta sessão passou; confirmar o deploy PROD pós-merge de qualquer forma (a 0052 aplicou limpa no Neon principal).
- **Suíte node local:** `cd <worktree> && npx vitest run --project node` (o vitest carrega o `.env.local` sozinho; o `set -a; . ./.env.local` quebra no `&` das URLs — ignore, roda mesmo assim). `global-setup` cria `refogando_test_<rand>` no Neon (endpoint direto) e dropa — NÃO toca prod. Agentes de sub-tarefa rodam só `--project ui`+typecheck+lint; os testes node/integração só na CI (ou local, serial).
- Worktree: `.claude/worktrees/`, branch de `origin/main`, `node_modules` por hardlink (`cp -al`), `.env.local` por symlink; `db:generate` SEMPRE dentro da worktree. Nunca commitar direto na main (branch+squash PR).

## Critério de saída (deste handoff)

- #426 FECHADO com as 2 fatias em PROD + migração aplicada (✅). Rótulo "bilíngue" fora da UI (✅). #435/#436/#437 FECHADOS (✅). Único pendente do #426 = o backfill (ação do dono).

## Referências

- ADR: `docs/adr/0030-traducao-real-por-llm-glossario-culinario-nome-de-ingrediente-por-locale.md`.
- Seam de tradução: `src/server/translation/translator.ts` (`RealTranslator`/`TRANSLATION_MODEL`); domínio: `src/domain/translation-glossary.ts` + `src/domain/translation-prompt.ts`. Ciclo: `src/server/recipe/translation.ts` (`ensureTranslation`). Display: `src/domain/recipe-read.ts` (`resolveIngredientNames`/`resolveRecipeView`). Backfill: `scripts/backfill-ingredient-names.ts`.
- Handoff anterior: `docs/handoffs/51-refino-ia-381-feito-deployado-proximos-426-traducao-followups.md`.
- Memórias: `traducao-real-426-feita`, `nunca-rotular-app-como-bilingue`, `medida-ingrediente-fonte-unica-direcao-b`.

## Suggested skills (próxima sessão)

- **`/grill-with-docs`** ANTES de codar o deferido de staleness cross-locale (§4.1) — muda regra pura de #3 + testes travados; precisa de desenho (ADR novo) antes.
- Dev via **Workflow** em worktrees (explore→implement→**review adversarial do DIFF, não só do ADR**→fix→PR), mergeando quando `checks` verde.
- `/handoff` de novo ao fim da próxima leva.
