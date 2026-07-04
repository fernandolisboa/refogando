# Handoff 50 — LGPD go-live FEITO + refino de IA (#381) DESENHADO (ADR-0029) + dev Wave 1 EM VOO

**Data:** 2026-07-04 · **Branch base:** `main` (HEAD `0f4fca6`) · **Contexto:** sessão fez duas coisas grandes (LGPD ao ar + design do #381) e deixou a 1ª leva de código do #381 rodando.

## TL;DR

1. ✅ **LGPD ao ar, sem advogado, por decisão do dono** — páginas legais publicadas + #411/#412/#413 mergeadas e fechadas + deploy PROD verde. Sobram só **ações humanas do dono** (e-mail, envs). Detalhe: [[memória lgpd-skills-shelf-e-276-pacote]] e §1 abaixo.
2. ✅ **#381 (refino da camada de IA) GRELHADO → ADR-0029 (PR#419 MERGEADO) + 7 issues #420–#426.** Ler `docs/adr/0029-camada-geracao-composavel-eixos-variedade-escolha.md` e os 2 termos novos no `CONTEXT.md` (`Nível de habilidade`, `Variação de geração`).
3. 🔴 **Dev do #381 começou: Workflow "Wave 1" (#420 + #424) estava RODANDO no fim da sessão** — Workflow session-scoped `wzl7x2xbm` (não resumível em sessão nova). **1ª coisa a fazer:** ver se os PRs saíram (§3).

## 1. LGPD — FEITO e DEPLOYADO (main `b7d45e8`), só faltam ações HUMANAS

Engenharia toda na main. Não é "continuar código": **#411/#412/#413 FECHADAS**, #276 aberta só pro sign-off. Detalhe completo (decisões, migr 0043–0047, gotchas) na memória `lgpd-skills-shelf-e-276-pacote.md`. **Ações que só o DONO faz** (todas fail-closed — nada quebra sem elas):
- Criar alias **`privacidade@refogando.com`** (ImprovMX/ForwardEmail + MX no DNS da Vercel). O código já publica o endereço (hardcoded nas i18n pt-BR/en-US — 6 ocorrências cada; trocar por `contato@` = find/replace). Controlador publicado = "Fernando Lisboa" pessoa física.
- Envs na Vercel pro mailer acender: `BREVO_API_KEY` + `DSAR_MAIL_FROM` (sender verificado no Brevo) + `DSAR_DPO_EMAIL`.
- `WEB_SEARCH_API_KEY` na Vercel + **um redeploy** pra ligar a Descoberta na web.
- **PR #393** (rascunhos jurídicos `docs/legal/`) segue ABERTO de propósito — é pro advogado, não mergear.

## 2. #381 — desenho fechado (ler os artefatos, não re-derivar)

**ADR-0029** cristaliza tudo. Não repito aqui; leia o ADR + a memória `followup-melhorar-camada-ia.md`. Os pontos que um dev PRECISA ter na cabeça:

- **Abstração = composição de fragmentos de prompt na chamada da API** (função pura `buildSystemPrompt` em `src/domain/briefing.ts`, threaded da borda como o `cozinhaSlugs` já faz) — **NÃO** "skill" externa.
- **INVARIANTE DURO (verificado na doc da Anthropic):** **Opus 4.8 rejeita `temperature`/`top_p`/`seed` (400)**. Toda variedade vem do **conteúdo do prompt**, jamais de sampling. O comentário em `src/server/claude/client.ts:118` é impreciso (diz "por causa do structured output"; na verdade é o modelo).
- Outros invariantes que o refino NÃO pode quebrar: mesmo `RecipeGenSchema` via structured output; consultivo (Aviso) fora do objeto Receita; taxonomia success/degraded/playful/impossible (`src/domain/generation.ts` classify); prato SEMPRE sujeito na imagem (ADR-0022); cozinha = vocabulário controlado (a IA não inventa cozinha, ADR-0025); Extração ≠ Geração.
- **Nível de habilidade** (iniciante/interm/avançado) ≠ **Dificuldade**: a Dificuldade do prato **vira SAÍDA estimada pela IA** (removida como campo de entrada, evita 2 seletores irmãos).

**7 issues** (critérios de aceite completos em cada uma; NÃO re-fatiar):
| # | Fatia | Depende |
|---|---|---|
| #425 | Comparador admin antes/depois (medir) | #420 |
| #420 | **FUNDAÇÃO** — seam `buildSystemPrompt` + enriquecer prompt-base + carimbo de versão | ADR |
| #421 | Eixo Nível de habilidade | #420 |
| #422 | Cozinha-como-voz (nota curada em `vocabulary_term`) | #420 |
| #423 | Variação de geração (gerar 2, opt-in) | #420 |
| #424 | Variedade de imagem automática | ADR |
| #426 | **Tradução real** — track PRÓPRIA (greenfield, relaciona #187, NÃO é #381) | — |

## 3. Estado do DEV e o que fazer AGORA (ordem)

O dono pediu "paraleliza o máximo e finaliza logo". A dependência real: **#421/#422/#423/#425 compõem no seam que #420 constrói** → só podem branchar DEPOIS que #420 mergear. Por isso 2 ondas.

**Wave 1 (rodava no fim da sessão): #420 + #424** em paralelo (worktrees, TDD, review adversarial 3-lentes, fix, PR — sem mergear). Workflow `wzl7x2xbm` (não resumível numa sessão nova). Branches esperadas: `feat/420-ia-seam-composicao`, `feat/424-variedade-imagem`.

**Passo 1 — reconciliar o estado:** `gh pr list --state open` e `git ls-remote --heads origin 'feat/42*'`.
- Se os 2 PRs existem → confira CI (`gh pr checks <n>`; gotcha do watcher: trate `""`/null como PENDING), **mergeie #420 primeiro** (é o seam), depois #424. Leia o `seamNotes` do resultado do Workflow (ou o PR de #420) pra saber a **assinatura exata do registro de fragmentos** que a Wave 2 pluga.
- Se algum não saiu (Workflow morreu no meio) → re-autore o stream faltante a partir da issue + ADR (o .mjs original estava no scratchpad EFÊMERO desta sessão — não conte com ele; reescreva). Padrão de Workflow reusável: ver os handoffs anteriores e a memória `use-worktree-isolation-parallel-sessions`.

**Passo 2 — Wave 2 (assim que #420 mergear):** lançar `#421 ∥ #422 ∥ #423 ∥ #425` em paralelo, branchando de main-com-#420. **Colisões a gerenciar no merge (foreground):**
- **`src/domain/briefing.ts`**: #421/#422/#423 adicionam fragmentos ao registro de #420 — mesma-região aditiva; mergeie um, rebase os outros (padrão "2º rebaseia").
- **Migrações**: #421 (default de Nível no Perfil), #422 (coluna de nota-de-voz em `vocabulary_term`), #423 (talvez registro da escolha) podem gerar migração cada → colisão de número. Mergeie um, rebase+`db:generate` os seguintes DENTRO da worktree. #420 tenta evitar migração (carimbo no jsonb de proveniência).

**Passo 3 — #426 (tradução):** track separada, quando quiser. É greenfield (o `RealTranslator` em `src/server/translation/translator.ts` LANÇA) + conserta o bug do nome-de-ingrediente-em-PT numa tela EN — mexe no display de ingrediente (delicado: ver [[medida-ingrediente-fonte-unica-direcao-b]], NÃO re-localizar medida).

## Princípios inegociáveis / landmines (aprendidos nesta e nas levas anteriores)

- **Nunca direto na main** (classificador bloqueia): branch + squash PR; push após cada commit. **"Closes #N" em inglês** fecha; "Fecha #N" NÃO.
- **`gh pr merge --delete-branch` FALHA no git local** (branch em worktree) mas o merge REMOTO acontece — confirme `state=MERGED`, limpe branch/worktree à mão.
- **Migração aplica on-deploy** (`vercel.json` → `db:migrate && build`); NUNCA `db:migrate` local. `db:generate` SEMPRE dentro da worktree (cwd), senão lê schema errado e diz "no changes".
- **Worktree precisa de node_modules**: `ln -s <repo>/node_modules ./node_modules` (symlink; NÃO npm install). Excluídas do vitest sob `.claude/worktrees/`.
- **Cheques na worktree** (sem .env.local/Postgres): typecheck + lint + testes SEM banco (test/domain, unit, ui). Integração valida na CI. **Flake conhecido na CI:** `test/integration/conversation-transcript.test.ts` (corrida de append) — se falhar sozinho e o PR não toca conversa, é flake → re-run.
- **Preview Vercel do PR flaka** (Neon branch) mesmo com Actions verde → gatear no check "checks" + confirmar deploy PROD pós-merge (status "Vercel"=success no HEAD da main).
- **Opus 4.8: sem temperature/top_p/thinking em generateRecipe** (400). Variedade = prompt.

## Critério de saída

- #381 fechado quando #420/#421/#422/#423/#424/#425 mergeados+fechados e deploy PROD verde. #426 é bônus (track própria).
- Cada geração deve: emitir o mesmo RecipeGenSchema, respeitar os selos de IA, e (novo) carimbar a versão de prompt.

## Gotchas de ambiente

- `gh` autenticado; CI ~6–10min; repo PRIVADO (raw.githubusercontent não renderiza em issues — use user-attachments).
- Comunicar SEMPRE em **português** no chat (dono se incomoda com PT/EN misturado).
- Memória em `~/.claude/projects/-home-ferna-projects-refogando/memory/` — `MEMORY.md` é o índice (mantido enxuto; detalhe nos arquivos-tópico).

## Suggested skills (próxima sessão)

- **Nenhum `/to-issues` nem `/grill`** — o desenho está fechado (ADR-0029) e as issues existem.
- Reconciliar/mergear: `gh` direto (ver §3).
- Dev das fatias: fluxo padrão do repo via **Workflow** em worktrees (implement→review adversarial 3-lentes→fix→PR), como nas levas LGPD e desta Wave 1. NÃO tem auto-merge → mergear no foreground quando CI verde.
- `/handoff` de novo ao fim da próxima leva.

## Referências

- ADR: `docs/adr/0029-camada-geracao-composavel-eixos-variedade-escolha.md`. Glossário: `CONTEXT.md` (Nível de habilidade, Variação de geração).
- Issues: #420–#426 (épico #381). LGPD: #411/#412/#413 (fechadas), #276/#393 (abertas, gate humano).
- Camada de IA (seams): prompts texto `src/domain/briefing.ts`; seam Anthropic `src/server/claude/client.ts`; imagem `src/domain/image-prompt.ts` + `src/server/images/image-generator.ts`; tradução (stub) `src/server/translation/translator.ts`; DI `src/server/deps.ts`; vocabulário `vocabulary_term` (ADR-0025).
- Memórias-chave: `followup-melhorar-camada-ia.md` (o #381 inteiro), `lgpd-skills-shelf-e-276-pacote.md` (LGPD).

---

### Prompt de kickoff (copiar/colar na próxima sessão)

Continuar o dev do refino da camada de IA do Refogando (#381). Leia docs/handoffs/50-lgpd-golive-feito-refino-ia-381-desenhado-wave1-dev-em-voo.md para o contexto completo. Estado: o desenho está fechado no ADR-0029 (mergeado) e nas issues #420–#426; a LGPD já foi ao ar (só faltam ações humanas do dono). No fim da sessão anterior um Workflow "Wave 1" estava rodando pra implementar #420 (fundação: seam buildSystemPrompt + enriquecer prompt-base + carimbo de versão) e #424 (variedade de imagem) em paralelo, em worktrees, sem mergear. PRIMEIRO PASSO: reconciliar o estado — rode `gh pr list --state open` e `git ls-remote --heads origin 'feat/42*'` pra ver se os PRs de #420 e #424 saíram; se saíram, confira CI e MERGEIE #420 primeiro (é o seam que todo o resto compõe), depois #424; se algum não saiu, re-autore o stream a partir da issue + ADR-0029. Assim que #420 mergear, lance a Wave 2 em paralelo (#421 Nível de habilidade, #422 cozinha-como-voz, #423 Variação de geração/gerar-2, #425 comparador admin), branchando de main-com-#420, gerenciando no merge as colisões de src/domain/briefing.ts (aditivas, rebase do 2º) e de migração (rebase + db:generate dentro da worktree). Invariante duro: Opus 4.8 rejeita temperature/top_p/seed — variedade vem só do prompt; mantenha o RecipeGenSchema, os selos de IA e o prato-como-sujeito. O dono quer paralelizar o máximo e finalizar logo, sempre em português, mergeando no foreground quando a CI ficar verde. #426 (tradução real) é track própria (relaciona #187), não é parte do #381 — deixe por último. Padrão de dev: Workflow em worktrees (implement→review adversarial 3-lentes→fix→PR).
