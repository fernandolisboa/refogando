# Handoff 45 — Medida de ingrediente estruturada é a fonte única; `raw_text` vira NOME (Direção B)

## TL;DR / Escopo

Consertar o modelo de medida de ingrediente **de verdade** (não o remendo do PR #354). Hoje a medida vive em **dois lugares** — embutida no texto (`raw_text` = "320 g de arroz arbóreo") **e** nos campos estruturados (`quantidade=320`/`unidade=g`) — e o formulário deixa **divergir** (editar a quantidade sem tocar no texto), tornando a receita inconsistente e **impossível de escalar** sem IA.

**Design JÁ TRAVADO** (não re-litigar — leia antes de codar):
- `CONTEXT.md` → entrada **"Item de receita"** (atualizada).
- `docs/adr/0012-ingrediente-canonico-item-de-receita.md` → **Adendo (2026-06-30)**.
- `docs/adr/0009-contrato-de-geracao-ia.md` → **Adendo (2026-06-30)**.

**Decisão:** `quantidade`/`unidade` são a **fonte ÚNICA da medida**; `raw_text` é o **nome SEM a medida** ("arroz arbóreo"); a **exibição compõe** "medida + nome" (em-dash). Escalar (futuro) = `quantidade × ratio` (aritmética, não IA).

Esta sessão IMPLEMENTA. Os 3 fixes desta sessão anterior (#353 voto/favorito, #354 display de ingrediente [REMENDO], #355 dono-gerencia) já estão **mergeados na main** — contexto, não tarefa. **#354 será SUPERADO** por este trabalho.

## O trabalho (7 frentes)

1. **Contrato de geração** (ADR-0009 Adendo): em `src/domain/recipe-gen-schema.ts:53`, renomear o campo `rawText` → **`nome`** + `.describe("nome do ingrediente SEM quantidade/unidade — ex.: 'arroz arbóreo', nunca '320 g de arroz arbóreo'; a medida vai em quantidade + unidade")`. Atualizar o mapeamento em `src/server/generation/persist.ts` (`it.rawText`→`it.nome`, linhas ~145 e ~305) — coluna do DB segue `raw_text`.
2. **Importação web**: `src/server/import/recipe-importer.ts` / `recipe-import-parse.ts` já extraem `quantidade`/`unidade`; passar a **tirar a medida da linha** → `raw_text` = nome (best-effort, determinístico, no import).
3. **Exibição** (SUPERA #354): `src/domain/ingredient-line.ts` `formatIngredientLine` hoje devolve `rawText` cru — voltar a **compor**:
   - não-contável (`g/kg/ml/l/colher_de_sopa/colher_de_cha/xicara/dente/fatia/pitada`): `"{qtd} {unitLabel} — {nome}"` (em-dash, **zero gramática**: não pluraliza unidade).
   - contável (`unidade`): largar a palavra "unidade" → `"{qtd} {nome}"` (`"2 cebolas"`; plural estático já vem no nome).
   - `a_gosto`/`q_b`: **sufixo** → `"{nome} — a gosto"` / `"{nome} — q.b."`.
   - sem medida (qty null + unidade null): só `"{nome}"`.
   Consumidores `recipe-detail-view.tsx` e `server/recipe/seo.ts` já chamam o helper (nada a mudar lá).
4. **Diff + prompt de regeneração**: `src/server/recipe/derive.ts:66,109` (diff) e `src/domain/briefing.ts:255` (`rotuloItem`) já leem `rawText` + estruturado SEPARADOS → com `raw_text`=nome eles ficam **limpos automaticamente** (o prompt deixa de mandar "nome=320 g… ; quantidade: 100 g" contraditório). VERIFICAR/ajustar a composição do diff.
5. **Migração** (uma vez, **assistida por IA** — ver Adendo do ADR-0012): script único (molde: `scripts/seed-catalog.ts`) que, por linha de `recipe_ingredient`, manda `raw_text` + a `quantidade`/`unidade` **já corretas** a um modelo barato → "devolva só o nome, sem a medida, verbatim no resto" → `UPDATE raw_text`. **Rodar ANTES de retomar a curadoria**. ~1.887 linhas (1.773 catálogo HITL + ~114 do dono). É tarefa de **linguagem** (one-off), ≠ a aritmética da escala.
6. **Formulários**: campo de texto = **nome**. Reverter o placeholder do #354 (`criarReceitaIngredientePlaceholder` em `pt-BR.ts:1126` e `en-US.ts:1076`) de "Ex.: 500 g de feijão preto" de volta a **name-only** ("Ex.: feijão preto"). SEM validação dura (nome pode ter número, ex. "leite 2%"). Formas: `recipe-edit-form.tsx`, `admin/catalog-recipe-form.tsx`, `create-structured-wizard.tsx` (a textarea "tudo de uma vez" do wizard fica como está — é briefing pré-IA).
7. **Testes**: reverter/ajustar o que o #354 mexeu — `test/ui/recipe-detail.test.tsx` (fixture `rawText` virou linha-completa; voltar a `nome` + assert compõe "medida — nome"), `test/ui/conversation.test.tsx` (idem), `test/domain/ingredient-line.test.ts` (reescrever pro contrato de composição). Adicionar cobertura: em-dash, contável larga "unidade", `a_gosto`/`q_b` sufixo, sem-medida.

## DEFERIDO (NÃO fazer agora — anotado nos ADRs)

- Ligação do **Ingrediente canônico** (FK best-effort, #9/#19) — onde moram nome traduzido + formas singular/plural.
- Feature de **escalar por porções** (`quantidade × ratio`) + flexão de plural sob escala (via Ingrediente canônico, NÃO heurístico). Exibição estática NÃO precisa flexionar (o nome já nasce concordando com a qty gerada).
- Wiring da coluna `nota` (preparo) — hoje dormente (`schema.ts:508`).

## Landmines / gotchas

- **Migração ANTES da exibição-compõe.** Se virar a exibição pra compor mas não migrar, linhas com medida ainda no `raw_text` **re-duplicam** ("320 g — 320 g de arroz arbóreo"). A migração é **obrigatória**, não opcional.
- **Catálogo é HITL** (ADR-0026): o curador edita cada um antes de aprovar (#351) — rede de segurança pra erros da migração. As ~114 receitas do dono não têm essa rede (best-effort + o dono conserta).
- **A medida estruturada já existe e está correta** — a migração só REMOVE a medida do texto, não re-parseia. Cruzar com a qty/unidade conhecidas dá alta confiança.
- **`db:generate` SEMPRE dentro da worktree** (cwd) — não há migração de schema aqui (raw_text continua text), mas se mexer no schema, atenção.
- **CI consome cota paga** (repo privado) — o billing já foi corrigido pelo dono nesta sessão, mas confira se travar de novo (job "not started ... spending limit").
- Fluxo de merge: branch + PR + **review adversarial multi-lente (workflow ultracode)** + CI verde + squash-merge no foreground. "Closes #N" em inglês (PT não auto-fecha). `gh pr merge --delete-branch` falha no git local mas o merge remoto acontece — confirmar `gh pr view --json state`.

## Onde ler primeiro (real, file:line)

- `docs/adr/0012-*` Adendo + `docs/adr/0009-*` Adendo + `CONTEXT.md` "Item de receita" — o design travado.
- `src/domain/ingredient-line.ts` — o helper a re-compor (e o porquê do remendo #354 no docstring).
- `src/domain/recipe-gen-schema.ts:51-56` — o `IngredienteGen` (campo a renomear).
- `src/db/schema.ts:494-511` — colunas de `recipe_ingredient`.
- `scripts/seed-catalog.ts` — molde de script de dados one-off (env, ledger, makeSql).

## Critério de saída

Receita exibe cada ingrediente UMA vez, composto da medida estruturada + nome ("320 g — arroz arbóreo"); editar a quantidade no form reflete na exibição (sem divergir do texto); JSON-LD idem; nova geração/import nascem com `raw_text`=nome; migração rodada e VERIFICADA (0 linhas com medida embutida no `raw_text` pós-migração); 786+ testes UI verdes; tsc + lint; PR mergeado.

## Suggested skills (próxima sessão)

- **`/tdd`** — escrever os testes de composição (em-dash, contável, a_gosto, sem-medida) antes do helper.
- **Workflow (ultracode)** — review adversarial multi-lente do diff (correção/migração-leak/ADR-aderência) antes do merge.
- **`/verify`** ou **`/run`** — confirmar no app real que o detalhe e o form não divergem após editar a quantidade.
- **`/diagnose`** — se a migração assistida por IA produzir nomes estranhos em casos difíceis (medida soletrada "Meia xícara", sufixo "a gosto").

## Prompt de kickoff (copiar e colar numa sessão nova)

Implemente o conserto do modelo de medida de ingrediente (Direção B) já desenhado e travado. Leia primeiro `docs/handoffs/45-medida-de-ingrediente-estruturada-fonte-unica-rawtext-vira-nome.md` e os docs que ele referencia: o Adendo (2026-06-30) de `docs/adr/0012-ingrediente-canonico-item-de-receita.md`, o Adendo (2026-06-30) de `docs/adr/0009-contrato-de-geracao-ia.md`, e a entrada "Item de receita" do `CONTEXT.md`. A decisão (não re-litigar): `quantidade`/`unidade` são a fonte ÚNICA da medida; `raw_text` é o NOME do ingrediente sem a medida; a exibição compõe "medida — nome" (em-dash, zero gramática; contáveis largam a palavra "unidade" e exibem "2 cebolas"; `a_gosto`/`q_b` como sufixo); escalar é futuro e vira `quantidade × ratio`. Faça as 7 frentes do handoff: renomear o campo de geração `rawText`→`nome` + describe (ADR-0009) e o mapeamento em persist; strip da medida na importação web; re-compor `formatIngredientLine` (supera o remendo do PR #354 que exibia `raw_text` cru); verificar diff de derivar + `rotuloItem`; rodar a migração one-off assistida por IA que tira a medida do `raw_text` usando a `quantidade`/`unidade` já corretas (ANTES de retomar a curadoria, ~1.887 linhas, catálogo é HITL); formulários com campo = nome e reverter o placeholder do #354 pra name-only; reverter/ajustar os testes que o #354 mexeu + cobrir o formato de composição. Deferido (NÃO fazer): ligação do Ingrediente canônico, a feature de escalar, e a coluna `nota`. Siga o fluxo do repo: trabalhe numa worktree/branch off origin/main, TDD, review adversarial multi-lente via Workflow (ultracode), CI verde, squash-merge no foreground. A migração é OBRIGATÓRIA antes de virar a exibição (senão re-duplica). Confirme a migração com uma query (0 linhas com medida embutida no `raw_text` pós-run).
