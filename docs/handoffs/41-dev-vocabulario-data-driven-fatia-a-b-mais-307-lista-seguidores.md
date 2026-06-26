# Handoff 41 — Dev: Vocabulário data-driven (épico #313) + #307 lista completa de seguidores

**Fase:** Desenvolvimento (AFK). Dois streams **paralelos e independentes** (zero overlap de arquivos).
**Data:** 2026-06-26.

## Escopo

Dois streams AFK que rodam **em paralelo**:

- **Stream 1 — Épico #313: vocabulário culinário data-driven (cozinha).** Migrar `cozinha` de `pgEnum` hard-coded → vocabulário controlado data-driven (tabela `vocabulary_term`) + fluxo "Outra"→sugestão→Curador. Decisão completa: **ADR-0025**. É uma **migração sequencial** (Fatia A) seguida de features (Fatia B).
- **Stream 2 — #307: lista completa de seguidores/seguindo (modal).** Área de perfil/social, **totalmente independente** do Stream 1 (não toca em cozinha/vocabulário). Roda em paralelo do início ao fim.

`/grill-with-docs` do **#308** e curadoria do **#238** são **HITL** — fora deste handoff. **#270**/**#276** são decisões do dono.

## O que ler primeiro

1. `docs/adr/0025-vocabulario-culinario-data-driven-cozinha-sugestao-curadoria.md` — a decisão e todo o racional do Stream 1 (incl. sequência de migração e landmines). **Inegociável ler antes de tocar código.**
2. `CONTEXT.md` — entradas **Cozinha**, **Vocabulário culinário**, **Curador** (glossário atualizado por este ADR).
3. As issues: **#313** (épico, com checklist) + **#314–#321** (cada uma tem AC + gotchas embutidos). Para o Stream 2: **#307** + `src/server/user/follow.ts`.

## Ordem e dependências

**Stream 1 (migração — NÃO paralelizar o flip de coluna):**

```
#314 → #315 → ( #316 ∥ #317 ) → #318  ── fim da Fatia A
                                    ↓
                         ( #319 ∥ #321 ) ;  #319 → #320  ── Fatia B
```

- Cadeia linear de propósito (verde a cada passo, mínimo rebase). A **única** paralelização segura interna é **#316 ∥ #317** (validação vs rótulos — independentes, ambos dependem só do reader #315).
- **NÃO** paralelizar #314–#318 de outra forma: é uma migração que flipa o tipo de uma coluna; conflito garantido.
- Fatia B só começa depois de #318. #321 (Admin CRUD) é paralelo a #319/#320.

**Stream 2:** #307 sozinho, do começo ao fim, em paralelo com tudo do Stream 1.

## Princípios inegociáveis (landmines da auditoria + revisão de 4 lentes do ADR)

Stream 1 — **não derrapar nisto** (a revisão adversarial pegou cada um ANTES do "aceito"):

- **FK nasce SÓ no flip (#318), nunca antes.** `recipe.cozinha`/`briefing.cozinha` são `pgEnum` até o flip; FK `enum↔text` é incriável no Postgres.
- **`UNIQUE(slug)` CRU** — não-parcial, não-composto com `kind` (senão a FW pra chave natural é incriável). A convenção do repo usa unique parcial/composto — **aqui não**.
- **O flip é migração escrita À MÃO + grep da `.sql`** (drizzle erra DDL de enum→text): `ALTER COLUMN ... TYPE text USING cozinha::text` nas **DUAS** colunas (`recipe`, `briefing`), `::cozinha[]`→`::text[]` na Busca, **cria as 2 FKs `ON DELETE RESTRICT`**, e só então `DROP TYPE cozinha` — **tudo numa migração**.
- **`status` enum = `suggested|active|deprecated|merged|rejected`. Tombstone, NUNCA DELETE físico** (preserva `briefing.cozinha` = proveniência imutável, ADR-0006).
- **Contenção TOTAL do `suggested`:** ausente em faceta, display, `recipeCuisine` do JSON-LD e OG card. Texto cru só pro dono (edição) + fila do Curador. **Publicar NÃO é bloqueado** (default-open, ADR-0020).
- **"Outra" mora na autoria, não na IA:** a IA emite `cozinha=null`; o servidor grava o slug `suggested` pós-geração (fora do `z.enum`).
- **Validação por injeção:** `isCozinha`/`parseBriefing`/`parseFacetParams` continuam **puros**, recebendo o conjunto-ativo por argumento. **Leitura = cache TTL; validação de escrita = DB-direct** (não o cache).
- **`culinary-profile.ts`:** assertion de startup/teste de que os slugs citados ⊆ termos semeados, e **proibir hard-delete** de slug citado (só depreciar).
- **`americana` é semeada em #314** — isto **destrava a faceta `americana` do #238**.

Stream 2 (#307): **modal** (decisão já registrada na issue), paginação por cursor, soft-deleted nunca aparece (contador e lista concordam), sem rota nova indexável.

## Critério de saída

- **Fatia A (#314–#318):** `pgEnum cozinha` e `COZINHAS as const` removidos; `type Cozinha = string`; comportamento **idêntico** ao de hoje; CI verde.
- **Fatia B (#319–#321):** usuário sugere via "Outra"; Curador aprova/mescla/rejeita; Admin add/edita/depreca — **tudo sem deploy**.
- **#307:** clicar no contador abre modal com a lista completa paginada; contador e lista concordam.
- Issues fechadas com **`Closes #N`** (inglês) no PR; épico #313 com os checks marcados.

## Gotchas de ambiente (confirmados em sessões anteriores)

- **Worktree obrigatório** off `origin/main` (sessões paralelas colidem na working dir). **Hardlink** `node_modules` (symlink quebra `next build`/Turbopack). Para os 2 streams em paralelo: **uma worktree por stream**.
- **`db:generate` SEMPRE dentro da worktree (cwd)** — rodar no repo principal lê o `schema.ts` errado e diz "no changes".
- **Migração aplica ON-DEPLOY** (nunca `db:migrate` local). Testes usam o endpoint **DIRETO** do DB (tirar `-pooler`) ou sessões concorrentes falham a suíte.
- **`Closes #N` em INGLÊS** (PT não auto-fecha). `gh pr merge --delete-branch` **falha no git local** mas o merge **remoto acontece** — confirmar via `gh pr view --json state` + limpar a branch à mão. **CI ~6min**; repo **sem auto-merge** → mergear no foreground quando verde.
- **Pipeline por issue:** worktree → plano → **plan-review** (multi-lente) → **TDD** → **diff-review** (3 lentes + verify) → fix → squash-merge. Reviews adversariais pagam-se (pegaram bugs reais em todas as iniciativas anteriores).

## Estado atual

- ADR-0025 + glossário na main (PR #312). Issues #313–#321 publicadas (`ready-for-agent`). #307 promovida a `ready-for-agent` (decisão modal). #237 fechado (não bloqueia mais #238). Nada de código do épico implementado ainda — **começar por #314**.
