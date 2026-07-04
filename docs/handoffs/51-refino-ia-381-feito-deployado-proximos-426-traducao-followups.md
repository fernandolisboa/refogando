# Handoff 51 — Refino da camada de IA (#381) FEITO+DEPLOYADO; próximos = #426 tradução + follow-ups

**Data:** 2026-07-04 · **Branch base:** `main` (HEAD `03f1ec4`) · **Contexto:** esta sessão pegou a Wave 1 do #381 em voo (handoff 50), mergeou tudo e implementou+mergeou a Wave 2 inteira, com deploy PROD verde.

## TL;DR

1. ✅✅ **Épico #381 (refino da camada de IA) 100% FECHADO e DEPLOYADO em PROD.** As 6 fatias (#420/#421/#422/#423/#424/#425) mergeadas+fechadas; migrações 0048→0051 aplicadas no Neon principal; `PROMPT_VERSION` bumpado 1→2. Nada pendente no #381.
2. 🔜 **Próximo trabalho natural: #426 (tradução real por LLM)** — track PRÓPRIA (greenfield, relaciona #187), NUNCA foi parte do #381. + 3 follow-ups de polimento: **#435/#436/#437**.
3. 🧑 **LGPD ainda tem AÇÕES HUMANAS do dono pendentes** (do handoff 50 — não foram tocadas nesta sessão). Ver §4.

## 1. O que foi entregue (ler os artefatos, não re-derivar)

Desenho fechado no **`docs/adr/0029-camada-geracao-composavel-eixos-variedade-escolha.md`** (mergeado antes). As 6 issues têm os critérios de aceite completos. Resumo do que está NA MAIN agora:

| # | Fatia | Migração | Commit |
|---|---|---|---|
| #420 | seam `buildSystemPrompt(mode, axes)` + prompt-base enriquecido + carimbo `generation.prompt_stamp` jsonb | 0048 | `981e57c` |
| #424 | variedade de imagem (biblioteca de estilo + rotação determinística FNV-1a por receita) | — | `9fdfbef` |
| #425 | comparador admin antes/depois (`/admin/comparador`, read-only) | — | `0af3f94` |
| #421 | eixo **Nível de habilidade** (iniciante/interm/avançado); Dificuldade virou SAÍDA estimada (removida como input) | 0049 | `cb4c643` |
| #422 | **cozinha-como-voz** (autenticidade genérica + nota curada opcional em `vocabulary_term.voice_note`) | 0050 | `8f3ea31` |
| #423 | **Variação de geração** "gerar 2, o usuário escolhe" (opt-in, schema-lista, config-driven) | 0051 | `03f1ec4` |

Deploys PROD confirmados verdes para #421/#422/#423 (status `Vercel`=success nos commits da main).

## 2. O SEAM final (`src/domain/briefing.ts`) — como plugar um eixo novo

O contrato de composição que a Wave 2 provou funcionar (para o próximo eixo, repita exatamente):

- **Registro**: `type PromptAxes` tem UM campo opcional por eixo (`nivelChef?`, `vozCozinha?`, `variacaoDivergente?`). Cada eixo = uma **função nomeada** `contribX: AxisFragmentContributor = (a)=> a.campo ? fragmento : null` + UMA linha no array `AXIS_FRAGMENT_CONTRIBUTORS`. `buildSystemPrompt(mode, axes)` compõe base + fragmentos.
- **Borda (Regra C — SPREAD ADITIVO)**: cada eixo tem um helper puro `resolveXAxis(...)` que devolve `{ campo }` ou `{}`. A borda compõe `let axes = { ...resolveA(...), ...resolveB(...) }` (cada `{}` colapsa p/ NEUTRAL byte-a-byte). As 3 bordas: `src/app/api/generations/route.ts` (nivelChef+variação resolvidos no topo; vozCozinha no ramo structured APÓS `parseBriefing` porque precisa de `briefing.cozinha`; `promptStamp` montado UMA vez DEPOIS, com o axes completo), `src/app/api/conversations/stream/route.ts` e `src/server/recipe/regenerate.ts` (o `recoverPrompt` devolve os axes EFETIVOS `{systemPrompt,userPrompt,axes}` p/ a proveniência não mentir).
- **Versão**: `PROMPT_VERSION` (hoje 2) carimba `generation.prompt_stamp={version,axes}`. Um bump por WAVE material (não por eixo).

**INVARIANTES DUROS (não quebrar):** Opus 4.8 rejeita `temperature`/`top_p`/`seed` (400) → variedade só do PROMPT; mesmo `RecipeGenSchema`; advisory FORA da Receita; taxonomia `classify` intacta; prato-sujeito na imagem (ADR-0022); cozinha do vocabulário controlado (ADR-0025); Extração ≠ Geração.

**Gotcha do #423 (schema-lista):** `generateRecipeVariants` usa `z.array(item)` **SEM `.min/.max/.length`** — qualquer bound hoista o item p/ `$defs`/`$ref` e o endpoint de structured output REJEITA com 400. Exato-2 é garantido pelo prompt + validação no app (há teste de regressão). Gate de teto exige 2 slots (`cap-1`).

## 3. Gotchas de MERGE SEQUENCIAL (aprendidos nesta sessão — valem p/ qualquer wave paralela)

- **Testes desatualizados só aparecem na CI.** Os agentes rodam só `typecheck`+`lint`+`vitest --project ui` local (sem Docker/Postgres). Os testes `node`/integração e o `next build` só na CI. Cada eixo novo que carimba `prompt_stamp.axes` ou muda um payload quebra `toEqual` estrito pré-existente (ex.: `me-profile` precisou de `nivelPadrao:null`; `generation.test` de `vozCozinha`+`version:2`; `generation-nivel` isolado com `cozinha:null`). **Loop rápido:** rodar a suíte `node` LOCAL contra Neon descartável — `cd <worktree> && set -a; . ./.env.local; set +a; npx vitest run --project node`. O `global-setup` cria `refogando_test_<rand>` no Neon (endpoint direto) e dropa no fim — **NÃO toca o `neondb` de prod** apesar de `TEST_DATABASE_URL==DATABASE_URL`. Serial (sem concorrência) evita o flake do Neon.
- **Vercel PREVIEW do PR SEMPRE flaka em PR que tem migração** (cria um Neon branch efêmero; o `db:migrate` sai com exit 1 sem NENHUM ERROR SQL, só NOTICES idempotentes). É flake, não bug. → **gatear no check `checks`**; confirmar o **deploy PROD pós-merge** (aplica no Neon principal, estável — deu success em #421/#422/#423). O merge passa apesar do `mergeStateStatus=UNSTABLE`.
- **Renumerar migração no merge:** cada fatia gerou `0049` local (colisão). No merge: `git rm` o `.sql` da fatia, `git checkout --ours`(rebase)/`--theirs`(merge) o `drizzle/meta/_journal.json`+`0049_snapshot.json` (pega a versão de main), `npm run db:generate` (OFFLINE, gera o próximo número livre). Conferir o `.sql` gerado (sem DDL fantasma `search_vector`/`hnsw`/`gin`). Ordem final: 0049 #421, 0050 #422, 0051 #423.
- **Contrato de borda aditivo** (função nomeada + campo próprio + spread) tornou os conflitos de `briefing.ts`/borda triviais (juntar linhas). Sem ele, seriam infernais.

## 4. LGPD — AÇÕES HUMANAS do dono ainda pendentes (não tocadas nesta sessão)

Do handoff 50 / memória `lgpd-skills-shelf-e-276-pacote.md` — engenharia toda na main, faltam só ações do DONO (todas fail-closed): alias `privacidade@refogando.com` (ImprovMX + MX na Vercel); envs `BREVO_API_KEY`+`DSAR_MAIL_FROM`+`DSAR_DPO_EMAIL` (mailer); `WEB_SEARCH_API_KEY`+redeploy (Descoberta na web). **#276** aberta só p/ sign-off; **PR #393** (rascunhos jurídicos) aberto DE PROPÓSITO (é pro advogado).

## 5. Próximos passos (ordem sugerida)

1. **#426 — tradução real por LLM** (track própria, o maior valor pendente). Greenfield: `RealTranslator` em `src/server/translation/translator.ts` hoje LANÇA; precisa de glossário culinário + conserta o bug do nome-de-ingrediente-em-PT numa tela EN. **Delicado:** mexe no display de ingrediente — ver memória `medida-ingrediente-fonte-unica-direcao-b` (NÃO re-localizar a medida). Relaciona #187.
2. **Follow-ups de polimento (`ready-for-agent`):** #435 (Dificuldade morta em `create-structured-experience.tsx` — inalcançável no fluxo real hoje), #436 (teto de tamanho p/ `voice_note`), #437 (fixtures do comparador #425 com eixos reais — fecha o valor do comparador agora que os 3 eixos existem).

## Critério de saída (deste handoff)

- #381 FECHADO com todas as fatias em PROD (✅ feito). #426 e #435/#436/#437 são novos trabalhos, não pendências do #381.

## Gotchas de ambiente

- `gh` autenticado; CI ~10-14min; repo PRIVADO (use user-attachments em issues, não raw.githubusercontent).
- Comunicar SEMPRE em **português** no chat. Nunca commitar direto na main (classificador bloqueia) — branch + squash PR; "Closes #N" em INGLÊS fecha.
- Worktree: `.claude/worktrees/` (excluída do vitest), branch de `origin/main`, `node_modules`+`.env.local` por symlink. `db:generate` SEMPRE dentro da worktree.
- Memória em `~/.claude/projects/-home-ferna-projects-refogando/memory/` — `followup-melhorar-camada-ia.md` (o #381 inteiro, atualizado) e `MEMORY.md` (índice).

## Referências

- ADR: `docs/adr/0029-camada-geracao-composavel-eixos-variedade-escolha.md`. Glossário: `CONTEXT.md` (`Nível de habilidade`, `Variação de geração`).
- Seam: `src/domain/briefing.ts` (`buildSystemPrompt`/`PromptAxes`/`AXIS_FRAGMENT_CONTRIBUTORS`/`resolve*Axis`/`PROMPT_VERSION`). Client Anthropic: `src/server/claude/client.ts` (`generateRecipe`/`generateRecipeVariants`). Imagem: `src/domain/image-prompt.ts`. Config de variação: `src/domain/recipe-variant-config.ts` + `app_config.recipe_variant_config`.
- Issues: #420-#425 (fechadas), #426 (aberta, track própria), #435/#436/#437 (follow-ups). Épico #381 (fechado).
- Handoff anterior: `docs/handoffs/50-lgpd-golive-feito-refino-ia-381-desenhado-wave1-dev-em-voo.md`.

## Suggested skills (próxima sessão)

- **Nenhum `/grill` nem `/to-issues`** — #426 já é uma issue com escopo; os follow-ups também. Se #426 precisar de desenho (glossário, estratégia de tradução), `/grill-with-docs` primeiro.
- Dev das fatias: fluxo padrão via **Workflow** em worktrees (explore→implement→review adversarial 3-lentes→fix→PR), mergeando no foreground quando `checks` verde (Vercel preview flaka — ignorar).
- `/handoff` de novo ao fim da próxima leva.
