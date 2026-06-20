# Handoff 28 — Iniciativa Imagens COMPLETA (#133 + #134 mergeadas); próxima direção: follow-ups ou nova fase

## Escopo
A **iniciativa Imagens + Perfil + Split do Admin** (PRD #122, ADR-0016/0017) está **COMPLETA**: todas as fatias mergeadas e verdes. Esta sessão fechou as duas que faltavam — **#133** (moderar só a imagem) e **#134** (`/admin/ai`, tornar a geração admin-configurável). `main` em `52e0c8c`. Não há mais fatia pendente da iniciativa; o próximo passo é decidir a direção (follow-ups conhecidos ou nova fase).

## Feito nesta sessão (mergeado, CI isolada verde, review adversarial multi-lente por Workflow)
| PR | Issue | Entrega | Achados confirmados |
|----|-------|---------|---------------------|
| #149 | #133 | Moderar **só a imagem** (flag `recipe_image.moderated_at`); some do público no feed/busca/detalhe, Owner ainda vê; Receita **continua no pool** (eixo ortogonal ao #18) | 0 |
| #150 | #134 | `/admin/ai`: config `imageGen { enabled, model, dailyCapByRole }` em `app_config`; a geração lê teto/modelo/enabled da config no lugar dos defaults fixos | 2 MEDIUM (lacunas de TESTE, código correto — fechadas no mesmo PR) |

Detalhes duráveis (decisões, arquivos-âncora, gotchas) NÃO duplico aqui — vivem na **memória** `imagens-perfil-admin-initiative.md` e nos commits/PRs acima.

## Estado atual (tudo na `main` `52e0c8c`)
- **Domínio:** `src/domain/image-gen-config.ts` é a **fonte ÚNICA** da config de geração (tipos, defaults, `IMAGE_GEN_MODELS`, `DEFAULT_IMAGE_MODEL`, `capFromConfig`, `parseImageGenConfig`). **`capForRole`/`DAILY_IMAGE_GEN_CAP_BY_ROLE` foram REMOVIDOS** de `image-quota.ts` (consolidação; lá ficam só `decideImageQuota` + `IMAGE_GEN_WINDOW_MS`). `null` no `dailyCapByRole` = ilimitado (mapeado a `Infinity`).
- **Server:** `src/server/app-config.ts` (`loadAppConfig`/`loadImageGenConfig`). Rota `/api/admin/config` GET/PUT estendida (upsert parcial: `defaultModel` e/ou `imageGen` independentes).
- **Geração:** `applyRecipeImageGeneration` lê a config após o gate de dono → `!enabled`→403 `geracao_desabilitada` antes do seam; teto via `capFromConfig`; modelo repassado ao gerador.
- **Moderação de imagem:** `applyImageModeration` (moderation.ts) + rota `/api/curate/reports/[id]/remove-image`; gate público em feed/busca (`AND ri.moderated_at IS NULL`) e detalhe (`imageModerated && !canManage`).
- **Schemas:** migrações 0018 (moderação de imagem) e 0019 (config de geração) aplicadas; geram limpas (sem phantom DDL).

## Próxima direção (escolher — não há fatia obrigatória pendente)
1. **PRD #122 candidato a FECHAR** — todas as histórias de produto entregues. Decisão do usuário (ação outward-facing): confirmar antes de fechar.
2. **Follow-ups conhecidos (abertos):**
   - **#146** — `deleteOwnRecipe` (hard-delete #21, `owner-edit.ts`) NÃO roda o ref-count → apagar a ÚLTIMA versão que aponta um `image_id` deixa `recipe_image`+blob **órfãos**. Fix esboçado na memória (capturar image_id antes do DELETE → COUNT=0 ⇒ apagar a linha + blob best-effort; injetar `ImageStore` no delete path). É a próxima fatia mais natural.
   - **Rate-limit geral** (ADR-0017, fora de escopo do PRD) — issue **ainda NÃO criada**.
   - **Presets de estilo da geração (#132)** — deferidos; hoje só prompt livre.
3. **Gate humano pendente (não-bloqueante de código):** `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` NÃO está no `.env.local` — a geração ao vivo não roda até alguém colar a key (como foi o Blob token). Código/testes fecham verdes sem ela (FakeImageGenerator). Quando a key entrar, dá pra `/verify`/`/run` a geração de verdade.

## Inegociáveis (ADR-0016/0017 + CONTEXT) — referência
Imagem é entidade `recipe_image` ref-counted (nunca coluna-URL); moderação = flag (some do público em toda parte, Owner vê no privado, Receita segue no pool); teto conta **EVENTOS** (ledger `image_generation`), não linhas `recipe_image`; geração Gemini REST sem SDK; seams Real/Fake/Throwing — testes **nunca** tocam Vercel Blob nem Gemini; `image_id`/proveniência crua nunca vazam no DTO.

## Landmines / gotchas (vividos — leia antes de mexer)
- **Suíte node COMPLETA local FLAKA no Neon:** rodar `vitest --project node` no conjunto inteiro (94 arquivos) faz o banco descartável SUMIR no meio (`PostgresError: database "refogando_test_..." does not exist` no `truncateAll` do beforeEach → TODOS falham, inclusive testes PUROS; **0 falhas de asserção**). NÃO é regressão. **Rode arquivos focados localmente (≤10) e confie na CI isolada** (Testcontainers) pra suíte cheia.
- **`gh run watch|tail` MASCARA o exit code** → sempre `gh run view <id> --json conclusion`.
- **Backtick (`) dentro do script de Workflow QUEBRA o parse** (termina o template literal) → aspas simples ou `array.join('\n')`.
- **Editar campo TRADUZÍVEL** em teste de integração dispara `applyEdit→embedTranslation→RealEmbedder` que LANÇA → `setEmbedder(new FakeEmbedder())`.
- **`FOR UPDATE` não no lado nulável de outer join** (Postgres estoura) → innerJoin + select FOR UPDATE separado.
- **Sem Docker local:** integração roda só na CI (Testcontainers) OU localmente focada contra o Neon descartável (`TEST_DATABASE_URL` no env; o harness deriva o endpoint direto stripando `-pooler`). Gate local DB-free: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run --project ui`, `next build` (com `BETTER_AUTH_SECRET=dummy...`).
- **Branch/merge:** sempre de `origin/main` (local desatualiza); commit só via branch+PR (classifier bloqueia main direto, handoffs inclusos); `gh pr merge <n> --squash --delete-branch` SÓ após CI verde; NUNCA `--auto`.

## Critério de saída por fatia (AFK — sem human gate)
TDD/implementar → **review adversarial multi-lente por Workflow** (lentes correção/leak/ADR/testes/concorrência → verificação cética por achado) → corrigir achados confirmados → gate local DB-free verde + arquivos node focados verdes → **CI isolada verde** (confirmar via `gh run view --json conclusion`) → `gh pr merge --squash` → a issue fecha via "Closes #N" → `/handoff` ao fim da leva.

## Ler primeiro (referência — não duplico)
- **Memória:** `imagens-perfil-admin-initiative.md` (grafo completo + decisões + gotchas de TODA a iniciativa, atualizada), `ci-merge-and-parallel-agent-gotchas.md`, `use-worktree-isolation-parallel-sessions.md`.
- **PRD/ADRs:** #122 + `docs/prd/imagens-perfil-admin.md`; `docs/adr/0016-*.md`, `docs/adr/0017-*.md`; `CONTEXT.md` (termos _Imagem da receita_, _Handle_).
- **Código-âncora #134:** `src/domain/image-gen-config.ts`, `src/server/app-config.ts`, `src/app/api/admin/config/route.ts`, `src/components/admin/ai-config-section.tsx`. **#133:** `src/server/recipe/moderation.ts` (`applyImageModeration`), `src/app/api/curate/reports/[id]/remove-image/route.ts`.

## Skills sugeridas
- Se for a **#146**: `tdd` (red-green pro ref-count no delete) + review por Workflow + `verify`/`run`.
- Se for **fechar a iniciativa / nova fase**: `triage` (criar a issue de rate-limit / presets), ou `/to-prd`→`/to-issues` pra uma nova frente.
- Sempre: subagentes/Workflow de code-review adversarial antes de mergear; `/handoff` ao fim.

---

Kickoff copiável (cole numa sessão nova):

A iniciativa Imagens do refogando está COMPLETA — #126/#130/#131/#132/#133/#134 todas mergeadas (main 52e0c8c). Leia docs/handoffs/28-imagens-completa-133-134-mergeadas-proxima-direcao.md primeiro (aterra tudo: o que foi entregue, o estado, inegociáveis e landmines) e a memória imagens-perfil-admin-initiative.md. Não há fatia obrigatória pendente; decida a direção comigo: (a) FECHAR o PRD #122 (todas as histórias entregues — confirme antes, é outward-facing); (b) atacar o follow-up #146 (deleteOwnRecipe não roda ref-count → recipe_image/blob órfão no hard-delete da última versão; fix: capturar image_id antes do DELETE, COUNT(recipe WHERE image_id=X)=0 ⇒ apagar recipe_image + blob best-effort injetando ImageStore no delete path); (c) criar as issues ainda inexistentes (rate-limit geral do ADR-0017; presets de estilo da geração #132); ou (d) abrir nova frente via /to-prd→/to-issues. Respeite os inegociáveis (ADR-0016/0017): imagem é entidade ref-counted, teto conta EVENTOS no ledger image_generation, seams Real/Fake/Throwing, testes nunca tocam Vercel Blob nem Gemini. Heed os landmines: a suíte node COMPLETA local flaka no Neon (db descartável some no meio → PostgresError database does not exist; rode arquivos focados ≤10 e confie na CI isolada); gh run watch|tail mascara o exit code (use gh run view --json conclusion); backtick quebra script de Workflow; setEmbedder(FakeEmbedder) em testes que editam campo traduzível; FOR UPDATE não no lado nulável de outer join; sem Docker local rode typecheck/lint/ui/build + node focado e confie na CI; branch de origin/main, nunca commit direto na main; mergeie só com CI verde via --squash, nunca --auto. Cada fatia: implementar → review adversarial multi-lente por Workflow → corrigir → CI isolada verde → squash-merge (Closes #N) → /handoff.
