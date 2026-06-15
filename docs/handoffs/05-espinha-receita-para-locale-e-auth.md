# Handoff 05 — Espinha da Receita (#3) feita → Casca de locale (#4) + Auth/Usuário (#5)

**Sessão anterior:** implementou e mergeou a **#3 (Espinha canônica da Receita + leitura localizada)** — squash `40ef124`, PR #25, issue fechada. **Próxima sessão:** implementar **#4 (Casca de locale + i18n de interface)** e **#5 (Usuário, papéis, auth e admin)**, pelo fluxo de 8 passos — **cada passo num subagente fresco** (ver "Processo").

Pipeline e os 8 passos: `CLAUDE.md` → "Fluxo de trabalho".

## Estado (o que a #3 deixou no `main` — referência, não reimplementar)

Tudo verde no `main` (`npm test` 60/60 contra Postgres real, `lint`/`typecheck`/`build`). A #3 adicionou, **em cima da fundação da #2**:

- **Schema da espinha** `src/db/schema.ts`: `recipe` (uuid PK, `origin`/`visibility`/`result_kind` independentes, `owner_id` uuid **NULLABLE sem FK ainda**, `original_locale` text, `cozinha`/`categoria` enums, `restricoes[]`+GIN, `parent_recipe_id` self-FK SET NULL + `lineage_kind`, `schema_version`), `recipe_translation` por `(recipe, locale)` (+ `provenance` enum + `stale`), `ingredient`/`ingredient_translation`, `recipe_ingredient`, `tag`+`recipe_tag` (N:M), `recipe_embedding` (dormente, `vector(1536)`). **Mantém `ping`.**
- **Domínio** `src/domain/recipe.ts` (enums origin/visibility/result_kind/lineage_kind/translation_provenance + `SCHEMA_VERSION_RECEITA` + validadores), `src/domain/vocabulary.ts` (kernel #2 + agora `UNIDADES`), `src/domain/recipe-read.ts` (resolvers puros de leitura localizada), `src/domain/stale-rule.ts` (regra de `stale`, flip de flag puro).
- **Route handler** `src/app/api/recipes/[id]/route.ts` — **padrão a imitar** para novos handlers: `GET(req, { params }: { params: Promise<{ id: string }> })`, `await params`, valida uuid → 404, `getDb()`, `db.select()` (não a relational query API), leituras independentes em `Promise.all`, `Response.json`.
- **Migração** `drizzle/0001_curved_black_cat.sql` (a espinha + trigger de imutabilidade de `origin`). A próxima migração será `0002` (o journal já tem idx:0 e idx:1; `db:generate` anexa limpo).
- **Testes** `test/helpers/recipes.ts` (factories de seed — **padrão a imitar** para novas factories), `test/integration/*` (porta mais alta + cliente postgres.js cru pra invariantes), `test/unit/*`.

**Locale é `text` de propósito** em `recipe.original_locale`, `recipe_translation.locale`, `recipe_embedding.locale` — a #3 **não congelou** o conjunto de locales; **a #4 é dona desse conjunto** (ver landmines).

## Processo (inegociável — funcionou nesta sessão, manter)

Os 8 passos rodam com **cada passo num subagente especializado de contexto novo** (spawn fresco). O loop principal **só orquestra e integra**. Nesta sessão a #3 foi feita assim e deu certo: usar a ferramenta **Agent** (um passo) ou **Workflow** (fan-out/pipeline de passos) — **não** fazer o trabalho dos passos no loop principal. Padrão que rendeu bem:

1. **Explorar** → Workflow com leitores paralelos (fundação/harness/ADRs/PRD) + síntese. 2. **Planejar** → Agent (`Plan`) escrevendo plano concreto. 3. **Revisar o plano** → Workflow multi-lente + veredito. 4. **Corrigir o plano** → Agent. 5. **Implementar** → Workflow: backbone serial do schema → fatias paralelas em arquivos disjuntos → **green-gate** único (typecheck/lint/test/build). 6. **Code-review** → Workflow: lentes (correção/segurança/qualidade/perf/ADR+CONTEXT) → **verificação adversarial de cada achado** → síntese. 7. **Corrigir** → Agent aplica achados confirmados + re-roda o green-gate. 8. **Validar e fechar** → **orquestrador**: branch (estamos no `main`), commit, push, PR, **squash-merge**, fechar issue.

Decisões: **grelhar só o que congela schema / é irreversível**; o resto, decidir com default + porquê e deixar vetar (nesta sessão grelhei só PK uuid vs serial e `unidade` enum vs texto). **`git push` depois de cada commit.** O plano detalhado é artefato de rascunho (foi escrito em `docs/plans/` e **removido antes do commit** — não há convenção de `docs/plans/` no repo; o durável é este handoff).

**Fim da sessão = `/handoff`** (doc em `docs/handoffs/`, commitado) + prompt de kickoff.

## Escopo da próxima sessão: **#4 + #5 juntas, numa só sessão**

> **Correção ao handoff 04.** A #4 e a #5 **não são totalmente independentes** como dito antes. Lendo as issues: a **AC#5 da #4** ("seam de servidor") faz round-trip da **coluna de locale do Usuário**, que é **entregue pela #5** ("a persistência da preferência para usuário logado é uma coluna no Usuário, entregue junto da fatia de auth #5"). E a #5 AC#4 também cita essa preferência. **Ambas tocam a mesma tabela `Usuário`.** Rodá-las em **branches paralelos separados** recriaria o churn de schema que adiamos no #3.

**Recomendação:** uma **única sessão** que trata #4+#5 como um bloco coordenado, com a **tabela `Usuário` (#5) como backbone serial de schema**, e fan-out paralelo no que não é schema:

1. **Backbone serial (#5):** entidade `Usuário` (id estável uuid; papel Visitante/Usuário/Curador/Admin; **coluna de preferência de locale**), sessão/auth, e **a FK que falta**: `recipe.owner_id` → `users.id` (hoje é uuid solto sem FK). Uma migração `0002`.
2. **Fan-out paralelo (arquivos disjuntos):** **#5** auth/gating por papel/config de Admin; **#4** provider de locale + seletor + detecção do navegador + persistência na **sessão do navegador** (Visitante) + catálogos de mensagens pt-BR/en-US.
3. **Topo:** **#4 AC#5** — route handler que grava/relê a coluna de locale do Usuário (precisa da tabela do passo 1) contra Postgres real.

Fallback, se preferir sessões separadas: **#5 primeiro** (dona do `Usuário`), **#4 depois** (consome a coluna). Nunca #4 antes de #5.

## Ler primeiro (no repo / GitHub — não duplicado aqui)

- **Issue #4** (https://github.com/fernandolisboa/refogando/issues/4) e **Issue #5** (https://github.com/fernandolisboa/refogando/issues/5) — `What to build` + `Acceptance criteria`. **Fonte de verdade.**
- **`docs/prd/refogando.md`** (Issue #1) — histórias citadas: #4 → 218, 221, 222, 192 (apresentação); #5 → 143, 162, 177–186, 220.
- **`CONTEXT.md`** — termos são lei: **Locale** (chave de apresentação, não de identidade), **Usuário e papéis** (Visitante/Usuário/Curador/Admin), **Owner / Autoria** (≠ Proveniência), **Perfil culinário** (não é entidade). Respeitar os `_Avoid_`.
- **ADRs**: `0001` (i18n: locale é apresentação; identidade única), `0011` (usuário/papéis/acesso anônimo — **a lib de auth é reversível mas é decisão real; explicitar no passo de plano, última estável, não escolher em silêncio**). `0010` (stack: route handlers, não Server Actions).
- **Código da #3 pra construir EM CIMA** (acima): `src/db/schema.ts`, `src/app/api/recipes/[id]/route.ts` (padrão de handler), `test/helpers/recipes.ts` (padrão de factory), harness em `test/`.

## Mapa de propriedade / landmines

- **Tabela `Usuário` é compartilhada** entre #4 (round-trip da coluna de locale) e #5 (dona da entidade). **#5 cria a tabela com a coluna de locale**; #4 só a exercita por um handler. Não bifurcar.
- **#4 é dona do CONJUNTO de locales.** A #3 deixou `locale` como `text` de propósito. A #4 deve formalizar o vocabulário de locale (pt-BR/en-US) — e a **coluna de locale do Usuário (#5) deve usar a mesma representação**. Locale não suportado → padrão sensato, **sem tela quebrada**.
- **`recipe.owner_id` hoje é uuid NULLABLE SEM FK.** A #5 deve **adicionar a FK** `owner_id → users.id` (NULL = catálogo/sistema). Seed de catálogo continua `owner_id=NULL`.
- **Três eixos distintos (CONTEXT/ADR-0011), não conflar:** **Owner** (controla a linha, `owner_id` nullable) ≠ **Autoria** (creditado na exibição — derivada do owner pra conteúdo de usuário; atribuição editorial separada pro catálogo `owner_id=NULL`) ≠ **Proveniência** (`origin`, já na Receita).
- **Gating por papel nos route handlers:** ação acima do papel é negada **com mensagem clara** (401/403), não com erro confuso. Config de Admin (modelo default `claude-opus-4-8` vs custo `claude-sonnet-4-6`; promover/rebaixar papéis) **só Admin**.
- **Persistência de locale:** **Visitante** → sessão do navegador (não DB); **usuário logado** → coluna no Usuário. Trocar o locale da **interface NÃO** dispara criação/edição de Receita (a localização de *conteúdo* da Receita é da #3, já feita).
- **Criar conta** acontece ao tentar persistir algo; salvar/publicar/votar/favoritar **exigem conta** (estas ações em si são de fatias posteriores — a #5 entrega o gating/auth, não os endpoints de salvar/votar).
- **Seam de Claude/embedding continua dormente** — nada de geração (é da #8) nem embedding (#14) aqui.

## Seam de teste (herdada — honrar)

- Integração pela **porta mais alta** (importa o route handler, chama com `Request`) contra **Postgres real e descartável** (Testcontainers default / `TEST_DATABASE_URL` Neon). Migrar pelo endpoint **unpooled** (`max:1`).
- **Invariantes de banco** (ex.: FK `owner_id`, unicidade de Usuário) e o **gating** exercitados por integração. Para erros do banco, usar **cliente postgres.js cru** (`makeSql(inject('databaseUrl'))`) e ler `.code` no topo — **drizzle-orm 0.45 embrulha o erro do driver em `DrizzleQueryError` com o original em `.cause`** (padrão já no `test/integration/recipe-constraints.test.ts`).
- `truncateAll` descobre tabelas novas automaticamente (sem editar o helper). Lógica pura (catálogos de mensagens, resolução de locale) → teste unitário sem DB.

## Gotchas de ambiente

- **`.env.local`** tem segredos da Neon (gitignored — **nunca commitar**). **Docker** de pé pro caminho default (Testcontainers `pgvector/pgvector:pg17`). `TEST_DATABASE_URL` presente como fallback (Neon — pode logar "endpoint pooled; derivando o direto", informativo). Migrações exigem URL **unpooled**.
- **`git push` depois de cada commit.** Branch a partir do `main` (não commitar direto no `main`). Squash-merge do PR (estilo das #2/#3). `gh` autenticado.
- Escritas no GitHub podem ser barradas pelo classificador; se barrar, o usuário aprova ou roda via `! ...`.

## Critério de saída

#4 e #5 verdes (testes/lint/types/code-reviews satisfeitos) → **mergear o(s) PR(s) e fechar #4 e #5** → rodar **`/handoff`** pra próxima sessão (provável próximo passo: a fatia de criação/geração #6/#8, reavaliar pelo grafo de dependências).

## Suggested skills

- **Orquestração**: cada um dos 8 passos como **subagente fresco** (`Agent`) ou **`Workflow`** (fan-out/pipeline) — confirmado eficaz nesta sessão.
- **`tdd`** — red-green pela seam alta (round-trip de locale do Usuário; gating 401/403).
- **`diagnose`** — quando algo quebrar difícil. **`review`/code-review** — passo 6, múltiplas lentes + verificação adversarial. **`verify`/`run`** — confirmar no app real (o seletor de locale troca o chrome). **`request-refactor-plan`** — se aparecer dívida. **`triage`** — ajustar estado/labels.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. Esta sessão implementa as issues #4 (Casca de locale + i18n de interface) e #5 (Usuário, papéis, auth e admin), pelo fluxo de 8 passos do CLAUDE.md. REGRA INEGOCIÁVEL: cada um dos 8 passos roda num subagente fresco de contexto novo (ferramenta Agent para um passo, Workflow para fan-out/pipeline) — o loop principal só orquestra e integra; não faça o trabalho dos passos no loop principal. Comece lendo o handoff @docs/handoffs/05-espinha-receita-para-locale-e-auth.md (estado, processo, escopo, mapa de propriedade, landmines, seam de teste, gotchas) e tenha à mão as Issues #4 e #5 no GitHub (fonte de verdade), @docs/prd/refogando.md (histórias), @CONTEXT.md (glossário — termos são lei) e os ADRs 0001/0011/0010. Construa EM CIMA do que a #3 deixou no main (já mergeada, squash 40ef124): src/db/schema.ts (espinha da Receita; recipe.owner_id é uuid NULLABLE SEM FK ainda), src/app/api/recipes/[id]/route.ts (padrão de route handler a imitar), test/helpers/recipes.ts (padrão de factory), o harness em test/ (integração pela porta mais alta contra Postgres real; Testcontainers default, TEST_DATABASE_URL para Neon/CI; migração unpooled), e o kernel src/domain/vocabulary.ts. ATENÇÃO ao acoplamento: #4 e #5 NÃO são independentes — ambas tocam a tabela Usuário (a AC#5 da #4 faz round-trip da coluna de locale do Usuário, que a #5 entrega). Trate como UMA sessão coordenada: a tabela Usuário da #5 (id estável uuid; papéis Visitante/Usuário/Curador/Admin; coluna de preferência de locale; e a FK que falta recipe.owner_id→users.id) é o backbone serial de schema (migração 0002); depois faça fan-out paralelo no que não é schema — #5: sessão/auth, gating por papel nos route handlers (ação acima do papel negada com mensagem clara, 401/403), config de Admin (modelo default claude-opus-4-8 vs custo claude-sonnet-4-6, promover/rebaixar papéis, só Admin); #4: provider de locale, seletor pt-BR/en-US, detecção do navegador, persistência na sessão do navegador para Visitante, catálogos de mensagens nas duas línguas; e por fim a AC#5 da #4 (handler que grava/relê a coluna de locale do Usuário contra Postgres real). Respeite os três eixos distintos (Owner ≠ Autoria ≠ Proveniência); #4 é dona do conjunto de locales (a #3 deixou locale como text de propósito; formalize pt-BR/en-US e use a mesma representação na coluna do Usuário; locale não suportado cai num padrão sensato sem tela quebrada); trocar o locale da interface não dispara criação/edição de Receita; Visitante persiste no navegador, usuário logado na coluna. A lib de autenticação é reversível (ADR-0011) mas é decisão real: explicite a opção no passo de plano (última estável), não escolha em silêncio. Não puxe escopo de fora: nada de geração (#8), embedding (#14), busca (#6/#10/#14) ou endpoints de salvar/publicar/votar (fatias posteriores — a #5 entrega só auth/gating). Estilo: linguagem simples e direta, pt-BR; grelhe só decisão irreversível/que congela schema, no resto decida com default + porquê e me deixe vetar; receita é o centro, compliance é toque leve; última versão estável de toda dependência; git push depois de cada commit; branch a partir do main, squash-merge. Ao terminar #4 e #5 verdes (testes/lint/types/reviews) e mergeadas/fechadas, rode /handoff gerando o doc em docs/handoffs/ + prompt de kickoff pra próxima sessão. Comece pelo passo 1 (Explorar) spawneando subagente(s) de exploração para #4 e #5.
