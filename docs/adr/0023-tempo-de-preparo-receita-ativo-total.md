# ADR-0023 — Tempo de preparo da Receita: atributo invariante com duas facetas (ativo + total), JSON-LD só `totalTime`

Status: aceito

A Receita ganha **Tempo de preparo** — um atributo **invariante** (language-neutral, como `porções`), com **duas facetas**: o **tempo ativo** (mão na massa) e o **tempo total** (relógio na parede). Resolve o desejo registrado na issue #188 e fecha o follow-up de SEO do #234 (que deixou `prepTime`/`cookTime`/`totalTime` de fora do JSON-LD de propósito, esperando esta fatia). Origem: fase de domínio do overhaul de criar/editar (o protótipo `RecipeFormModal` inventou um campo "Tempo de preparo (minutos)" que não existia no domínio).

## Decisões

1. **Atributo INVARIANTE no nível da Receita — NÃO por passo, NÃO traduzível.** Vive em `recipe` (junto de `porções`/`dificuldade`, ADR-0016), nunca em `recipe_translation`. A ideia inicial ("tempo por passo, total = soma") foi **rejeitada**: os passos (`recipe_translation.passos`, `text[]`) são **conteúdo traduzível** sem identidade estável entre locales (o nº de passos pode divergir pt-BR/en-US), enquanto o tempo é invariante — atrelar tempo a um passo traduzível é incoerente. E **somar passos super-conta** quando há espera/paralelo.

2. **Duas facetas: `tempo ativo` (mão na massa) + `tempo total` (relógio na parede, inclui esperas passivas — marinar/descansar/gelar).** Unidade: **minutos (int)**. Ambos **OPCIONAIS** (nullable; "ausente ≠ vazio", espelha `porções`). Invariante: o ativo só existe junto de um total e nunca o excede — **`tempo_ativo IS NULL OR (tempo_total IS NOT NULL AND tempo_ativo ≤ tempo_total)`** (CHECK no banco, espelha os CHECKs de consistência de moderação). Positividade (`> 0`) valida na **borda** (rota), como os outros caps do app.

3. **Tempo é OUTPUT-ONLY: a IA estima ambos em toda geração; o Briefing NÃO ganha campos de tempo.** Os modos (`ai_structured`/`ai_free_text`/`ai_chat`) preenchem os dois no schema de saída do `generateRecipe`, **opcionais na saída** (geração degradada persiste sem tempo, não derruba a Receita). O usuário **não pré-especifica** tempo na criação estruturada — o `briefing` **não ganha colunas**; o tempo só aparece no entregue (estimado) e é **editável depois**. **Incoerência `ativo > total` ⇒ SALVAR descartando o ativo** (mantém o total), **NÃO invalidar a Receita.** Atenção ao implementar: isto é **deliberadamente mais brando** que `porções`/`dificuldade`, cujos valores fora-de-faixa derrubam a geração inteira pra `invalid` (`classify`, `src/domain/generation.ts` — *"NÃO clampar"*). O tempo pode ser brando **porque ambas as facetas são opcionais** (não gateiam a validade da Receita) e é baixo-risco — é uma política NOVA de **salvamento**, não um espelho do `classify`.

4. **JSON-LD: emite SÓ `totalTime`** ← `tempo_total` (ISO 8601, ex.: 90 min → `"PT1H30M"`), e só quando há dado. **NÃO emite `prepTime`/`cookTime`**: não modelamos o split preparo-vs-cozimento (só ativo-vs-total), e o Google aceita `totalTime` sozinho como rich result válido. Emitir o ativo como `prepTime` seria structured data **impreciso** (o ativo é mão-na-massa geral, não a fase de preparo pré-cozimento). Fecha o follow-up do #234 em `buildRecipeJsonLd` (`src/domain/recipe-seo.ts`).

5. **Busca/filtro por tempo = FORA DE ESCOPO** (follow-up próprio). Esta fatia entrega o atributo ponta-a-ponta (schema → IA → editar → detalhe → SEO), sem inflar a Busca — e adia a decisão "filtrar por ativo ou por total".

## Por quê

- **Nível-da-receita > por-passo:** passos são traduzíveis e sem identidade estável entre locales; tempo é invariante. Somar passos mente sempre que há espera (marinar 8h + picar cebola 5 min ≠ 8h05 de trabalho — só 5 min ativos). schema.org quer tempo no nível da Receita.
- **Ativo + total > só-total e > prep+cook:** *só-total* perde a distinção decisiva entre "8h de marinada + 20 min ativo" e "1h30 inteira na panela" (o furo ativo≠total). *prep+cook* (mapeamento direto do schema.org) re-introduz o problema da soma (descanso não é preparo nem cozimento), não serve receita sem cozimento (salada, no-bake), e `total ≠ prep+cook` quando há descanso. **Ativo + total** responde aos dois furos com o mínimo de campos, e o total é honesto (relógio na parede, declarado direto — não somado).
- **JSON-LD só `totalTime`:** honesto e suficiente para o rich result do Google (que aceita `totalTime` isolado). Não temos um split prep-vs-cozimento confiável; forçar `prepTime ← ativo` arriscaria structured data impreciso (risco de ação manual do Google).
- **Opcional:** espelha `porções`/`dificuldade`; receitas pré-existentes (sem tempo) degradam graciosamente — sem backfill, igual a quando a imagem foi adicionada.

## Alternativas rejeitadas

- **Tempo por passo, total = soma** (a ideia inicial do dono) — exigiria reestruturar os passos em entidades invariantes com identidade estável entre locales (mudança enorme); incoerente com passos-traduzíveis; a soma super-conta com espera/paralelo. Rejeitada.
- **Só `tempo_total`** (um número) — o mais enxuto, mas perde a distinção ativo-vs-passivo. Rejeitada como modelo (segue sendo o fallback de simplificação se algum dia o ativo provar pouco usado).
- **`prepTime` + `cookTime`** (schema.org direto) — descanso/marinada cai fora dos dois; `total ≠ prep+cook` com descanso; não serve no-cook. Rejeitada.
- **Emitir `prepTime ← ativo` no JSON-LD** — impreciso (ativo ≠ fase de preparo). Rejeitada.
- **Filtro de tempo na Busca já nesta fatia** — infla o slice e força "filtra por ativo ou total". Deferido (follow-up).

## Consequências

- **Schema (migração só GERADA — `.env.local` É PROD — + migrate-on-deploy):** duas colunas nullable `tempo_ativo_min` / `tempo_total_min` em `recipe` + CHECK `tempo_ativo_min IS NULL OR (tempo_total_min IS NOT NULL AND tempo_ativo_min <= tempo_total_min)`. **Sem backfill** (linhas existentes ficam NULL). Snapshot Drizzle limpo (grep o `.sql`).
- **`generateRecipe`:** o schema de saída ganha os dois campos (opcionais); o `classify`/persist **clampa** `ativo > total` (descarta o ativo).
- **Edição:** `OwnRecipePatch` (`src/server/recipe/owner-edit.ts`) ganha os dois campos; a UI de edição é o **`RecipeEditForm`** (`src/components/recipe/recipe-edit-form.tsx`) — materializa os dois inputs espelhando o idioma `<Input type=number min/max>` que `porções` já usa lá; validação `> 0` na borda. (O *"RecipeFormModal"* do protótipo é referência de design, não o arquivo real.)
- **Exibição:** `RecipeDetailView` (`src/components/recipe/recipe-detail-view.tsx`) mostra **ambos quando presentes, total sozinho senão** (`ativo` sozinho é impossível pelo CHECK); card de busca = opcional. O formato legível (`Xh Ymin` / `X min`) e os rótulos são **detalhe de apresentação i18n PT/EN (ADR-0001) — nível de issue**, não do ADR.
- **SEO (#234):** `RecipeSeoInput` ganha `tempo_total`; `buildRecipeJsonLd` emite `totalTime` (ISO 8601) quando presente — fecha o follow-up. Precisa de um helper PURO **net-new** `minutos → ISO 8601 duration` (`90→PT1H30M`, `60→PT1H`, `5→PT5M`, `0`/null → omite), unit-testado.
- **Glossário:** termo **Tempo de preparo** (ativo + total) no `CONTEXT.md`.
- **Follow-up:** filtro de tempo na Busca ("até X min") — issue própria; aí se decide ativo-vs-total como eixo do filtro.
