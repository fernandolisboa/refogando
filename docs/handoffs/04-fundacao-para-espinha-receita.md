# Handoff 04 — Fundação (#2) feita → Espinha da Receita (#3)

**Sessão anterior:** implementou e mergeou a **#2 (Fundação)**. **Próxima sessão:** implementar a **#3 (Espinha canônica da Receita + leitura localizada)**, sozinha, pelo fluxo de 8 passos — **cada passo num subagente fresco** (ver "Processo" abaixo; é a correção principal deste handoff).

Pipeline e os 8 passos: `CLAUDE.md` → "Fluxo de trabalho".

## Estado

A **#2 está mergeada (squash `2203f7d`) e fechada**. A fundação já no `main` dá (referência — não reimplementar):

- **Harness de teste** travado e neutro, auto-detect: `test/global-setup.ts` (Testcontainers `pgvector/pgvector:pg17` por padrão; `TEST_DATABASE_URL` → banco efêmero `refogando_test_<rand>` em endpoint **direto** pra CI/sem Docker), `test/setup.ts` (DI por arquivo + `TRUNCATE` em `beforeEach`), `test/helpers/db.ts`. Integração pela **porta mais alta** (importa o route handler, chama com `Request`).
- **DB**: `src/db/client.ts` (`makeSql`/`makeDb`, TLS com verificação de cert em host remoto, `prepare:false` em pooler), `src/db/migrate.ts` (`runMigrations`), `drizzle.config.ts`, baseline `drizzle/0000_*.sql` (extensões `unaccent` + `vector`; journal já existe → `db:generate` da #3 anexa `0001` limpo). `src/db/schema.ts` hoje só tem a tabela `ping` (smoke-test, **não** é proto-Receita — a #3 a substitui pelo schema real).
- **Dois seams mockáveis** (`src/server/claude/client.ts` → `ClaudeClient.echo`; `src/server/embedding/embedder.ts` → `Embedder.embed` + `FakeEmbedder`/`ThrowingEmbedder`) + **raiz de composição** `src/server/deps.ts` (`getDb`/`getClaudeClient`/`getEmbedder` + `setX`/`resetDeps`). **Geração** fica pra #8 (seam não foi congelado).
- **Kernel do Vocabulário culinário** `src/domain/vocabulary.ts`: `COZINHAS`/`RESTRICOES` (enums), `DIFICULDADE`/`PORCOES` (faixas, ADR-0009), `CATEGORIAS` (separado), `Tag` (livre) + validadores puros.

Tudo verde: `npm test` (Testcontainers **e** Neon, 17/17), `lint`, `typecheck`, `build`. `npm audit` deixado em latest de propósito (6 vulns transitivas dev-only; os "fixes" rebaixariam next→9 / drizzle-kit→0.19).

> **Nota de processo:** a #2 foi construída majoritariamente no loop principal, fora do "subagente por passo". Foi desvio — a #2 fica como está (aceita: verde, revisada, mergeada), e o processo é corrigido a partir da #3.

## Processo (correção inegociável — seguir à risca)

O fluxo de 8 passos por issue roda com **cada passo num subagente especializado de contexto novo** (spawn fresco). O loop principal **só orquestra** e integra resultados:

1. **Explorar** → subagente. 2. **Planejar** → subagente. 3. **Revisar o plano** → subagentes em paralelo (múltiplas lentes). 4. **Corrigir o plano** → subagente. 5. **Implementar** → subagente(s), em **paralelo quando der** (worktree por agente se mexerem em arquivos ao mesmo tempo). 6. **Code-review** → **múltiplos** subagentes especialistas. 7. **Corrigir** → subagente. 8. **Validar e fechar** → orquestrador (verde em testes/lint/types/reviews → mergear o PR → fechar a issue).

Usar a ferramenta **Agent** (um passo) ou **Workflow** (fan-out/pipeline de passos) — não fazer o trabalho dos passos no loop principal.

**Fim de cada sessão/loop = `/handoff`** (doc em `docs/handoffs/`, commitado + nunca `/tmp`) **+ prompt de kickoff** copiável. É esta cadência: terminou o escopo da sessão → gera o handoff da próxima.

## Escopo da próxima sessão: **#3 sozinha**

**Recomendação: só a #3.** É a espinha — define a **identidade canônica da Receita** (ADR-0001) e é **dona** da **regra de `stale`** e das **colunas de faceta** (cozinha/categoria/Tag/restrições+GIN); #6, #7, #8 e as fatias de edição constroem sobre ela. Paralelizar a #3 com #4/#5 seria mexer no núcleo do schema em dois branches ao mesmo tempo → churn de merge num core ainda se formando. **Depois** que a #3 mergear, **#4 (casca de locale)** e **#5 (auth)** são independentes (só dependem da #2) e viram ótimas candidatas a rodar **em paralelo** numa sessão — recomendar isso no handoff 05.

## Ler primeiro (no repo / GitHub — não duplicado aqui)

- **Issue #3** (https://github.com/fernandolisboa/refogando/issues/3) — `What to build` + `Acceptance criteria`. **Fonte de verdade.** Cita as histórias do PRD.
- **`docs/prd/refogando.md`** (Issue #1) — histórias citadas pela #3 + Decisões de Implementação/Teste.
- **`CONTEXT.md`** — glossário (Receita, Tradução, Nome, Proveniência, Visibilidade, Restrição, Ingrediente canônico, Item de receita, Cozinha/Categoria/Tag, Embedding). Termos são lei; respeitar os `_Avoid_`.
- **ADRs**: `0001` (i18n: identidade única + tradução por locale), `0002` (proveniência = enum `origin` imutável), `0012` (Ingrediente canônico × Item de receita), `0013` (`result_kind` + CHECK playful⇒privada), `0009` (schema canônico fonte única Zod/Drizzle + versão), `0005` (derivada/linhagem), `0008` (busca híbrida + `recipe_embedding` dormente aqui).
- **Código da #2 pra construir EM CIMA** (acima): estender `src/db/schema.ts`, referenciar `src/domain/vocabulary.ts`, usar `getDb` de `src/server/deps.ts`, herdar o harness de `test/`.

## Mapa de propriedade / landmines (relevantes à #3)

- **#3 é a dona ÚNICA da regra de `stale`**: campo **traduzível** muda → marca `RecipeTranslation` + `recipe_embedding` daquele locale como `stale`; campo **invariante** (quantidade/unidade/porções/dificuldade) **não** marca nada. É **flip de flag, sem recompute**. #19/#20/#21/#23 **invocam**; **re-embedding (recompute do vetor) é da #14**; geração/exibição da tradução automática é da **#23**.
- **`recipe_embedding(recipe_id, locale, embedding, model, stale)` nasce DORMENTE** — nenhuma chamada de embedding na #3 (o seam fica mockável, mas não é exercitado).
- **Invariantes de banco a exercitar por teste de integração** (AC pede rejeição no nível do banco): CHECK `result_kind=playful ⇒ visibility=private`; `origin` **imutável** (alterar é rejeitado); **`ON DELETE SET NULL`** no `parent_recipe_id`. `result_kind` só `success|degraded|playful`. Linhagem unificada (`parent_recipe_id` + `lineage_kind` `regenerated|edited`).
- **Facetas nascem aqui**: coluna `cozinha` (enum do kernel), coluna `categoria` (enum controlado **separado**), `restrições[]` (ARRAY de enum) + **índice GIN**, junção **Receita↔Tag (N:M)**.
- **Leitura localizada (GET por id)**: nome original **primário**; tradução confiável **entre parênteses** (sem redundância quando locale==original — "Feijoada", não "Feijoada (feijoada)"; sem parênteses vazios sem tradução); corpo cai pro texto de origem quando o campo não tem tradução; **selo de `origin` sempre presente**; quantidade/unidade/porções/dificuldade **idênticas** entre locales (só o rótulo muda). Trocar de locale = mesma Receita reapresentada, nunca cria/edita.
- **Identidade única e language-neutral da Receita** — nunca bifurcar por locale; `RecipeTranslation` por `(receita, locale)`. **Owner ≠ Autoria ≠ Proveniência.** Seed de catálogo com `owner_id=NULL`.
- **Schema canônico = fonte única** (Zod/Drizzle, ADR-0009) com **coluna de versão do schema**.

**Fora de escopo da #3** (não puxar): qualquer comportamento de embedding/semântica (#14); geração/exibição de tradução automática (#23); busca (#6/#10/#14); Aviso de restrição (#7 — aqui só expõe as restrições como faceta leve, sem motor de contradição).

## Seam de teste (herdada da #2 — honrar)

- Integração pela porta mais alta contra **Postgres real e descartável** (Testcontainers default / `TEST_DATABASE_URL` Neon). Os **CHECKs, o GIN e o `ON DELETE SET NULL`** têm que ser exercitados contra PG real (o AC exige rejeição no nível do banco).
- **Migrations**: `npm run db:generate` emite o DDL de tabela; conferir o que o drizzle-kit gera para **CHECK** (`check()` no `pgTable`), **GIN em array** (`index().using('gin', ...)`) e a **self-FK com SET NULL** — o que o drizzle-kit não expressar, editar à mão no `0001` (o journal já existe). Migrar pelo endpoint **unpooled** (`max:1`).
- Claude e embedding atrás de interface mockável (na #3 o embedding fica dormente).

## Gotchas de ambiente

- **`.env.local`** tem segredos da Neon (gitignored — **nunca commitar**). **Docker** precisa estar de pé pro caminho default (Testcontainers). `npm test` verde nos dois backends. Migrações exigem URL **unpooled**. **`git push` depois de cada commit** (memória).
- Escritas no GitHub podem ser barradas pelo classificador; se barrar, o usuário aprova ou roda via `! ...`.

## Critério de saída

#3 verde (testes/lint/types/code-reviews satisfeitos) → **mergear o PR e fechar a #3** → rodar **`/handoff`** pra próxima sessão (recomendar **#4 + #5 em paralelo**, ou reavaliar).

## Suggested skills

- **Orquestração**: cada um dos 8 passos como **subagente fresco** (`Agent`) ou **`Workflow`** (fan-out/pipeline) — o ponto deste handoff.
- **`tdd`** — red-green pela seam alta (pão-com-manteiga da #3: seed → GET → asserção no banco real).
- **`diagnose`** — quando algo quebrar de forma difícil. **`review`/code-review** — passo 6, múltiplas lentes (bugs/segurança/qualidade/perf/aderência ADR+CONTEXT). **`verify`/`run`** — confirmar no app real. **`request-refactor-plan`** — se aparecer dívida. **`triage`** — ajustar estado/labels.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. Esta sessão implementa a issue #3 (Espinha canônica da Receita + leitura localizada), sozinha, pelo fluxo de 8 passos do CLAUDE.md. REGRA INEGOCIÁVEL: cada um dos 8 passos roda num subagente fresco de contexto novo (ferramenta Agent para um passo, Workflow para fan-out/pipeline) — o loop principal só orquestra e integra; não faça o trabalho dos passos no loop principal. Comece lendo o handoff @docs/handoffs/04-fundacao-para-espinha-receita.md (estado, processo, escopo, mapa de propriedade, landmines, seam de teste, gotchas) e tenha à mão a Issue #3 no GitHub (fonte de verdade), @docs/prd/refogando.md (histórias), @CONTEXT.md (glossário — termos são lei) e os ADRs 0001/0002/0012/0013/0009/0005/0008. Construa EM CIMA da fundação já mergeada da #2: estenda src/db/schema.ts (hoje só tem a tabela ping, que a #3 substitui pelo schema real Recipe/RecipeTranslation/Ingredient/RecipeIngredient/recipe_embedding + junção Receita↔Tag), referencie o kernel src/domain/vocabulary.ts, use getDb de src/server/deps.ts e herde o harness em test/ (integração pela porta mais alta contra Postgres real e descartável: Testcontainers por padrão, TEST_DATABASE_URL para Neon/CI; migração pelo endpoint unpooled). A #3 é a dona ÚNICA da regra de stale (flip de flag, sem recompute: campo traduzível marca RecipeTranslation + recipe_embedding daquele locale; campo invariante não marca nada) — re-embedding é da #14, geração/exibição de tradução automática é da #23, e recipe_embedding nasce dormente. Respeite os landmines no banco e exercite-os por teste de integração contra PG real: result_kind só success|degraded|playful, CHECK playful⇒visibility=private, origin imutável, ON DELETE SET NULL no parent_recipe_id, linhagem unificada (parent_recipe_id + lineage_kind), identidade única e language-neutral da Receita (nunca bifurcar por locale; RecipeTranslation por (receita, locale)), schema canônico fonte única com coluna de versão, owner_id NULL no catálogo. Facetas nascem aqui (coluna cozinha do kernel, coluna categoria separada, restrições[] + índice GIN, Receita↔Tag N:M). A leitura localizada (GET por id) mostra nome original primário, tradução confiável entre parênteses (sem redundância quando locale==original, sem parênteses vazios sem tradução), corpo caindo pro texto de origem, selo de origin sempre presente, e quantidade/unidade/porções/dificuldade idênticas entre locales. Não puxe escopo de fora: nada de embedding/semântica (#14), tradução automática (#23), busca (#6/#10/#14) ou motor de Aviso (#7). Estilo: linguagem simples e direta, pt-BR; grelhe só decisão irreversível/que congela schema, no resto decida com default + porquê e me deixe vetar; receita é o centro, compliance é toque leve; última versão estável de toda dependência; git push depois de cada commit. Ao terminar a #3 verde (testes/lint/types/reviews) e mergeada/fechada, rode /handoff gerando o doc em docs/handoffs/ + prompt de kickoff pra próxima sessão (recomendação: #4 e #5 em paralelo). Comece pelo passo 1 (Explorar) spawneando um subagente de exploração para a issue #3.
