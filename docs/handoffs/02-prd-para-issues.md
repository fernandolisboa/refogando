# Handoff 02 — PRD → Issues

**Fase concluída:** PRD (`/to-prd`). **Próxima fase:** Issues (`/to-issues`).
Pipeline completo + fluxo de dev de 8 passos: ver `CLAUDE.md` → "Fluxo de trabalho".

## Ler primeiro (no repo — não duplicado aqui)

- **`docs/prd/refogando.md`** — o PRD completo: Problema, Solução, **319 histórias de usuário** (agrupadas por tema), Decisões de Implementação (modelo de dados, 9 lacunas resolvidas, invariantes, contrato de geração, busca, auth, stack), Decisões de Teste, Fora de Escopo, Notas. **Fonte de verdade pra fatiar.**
- **Issue #1** (https://github.com/fernandolisboa/refogando/issues/1, label `ready-for-agent`) — entrada do tracker: resumo executivo + todas as decisões travadas. Auto-suficiente (o PRD não cabe num issue de 64 KB).
- **`CONTEXT.md`** — glossário canônico (~26 termos). Termos são lei; respeite os `_Avoid_`.
- **`docs/adr/0001-0013`** — decisões travadas (índice no handoff 01). Não reabrir.
- **`CLAUDE.md`** — fluxo por fases + os 8 passos por issue.

## Tarefa desta sessão

Rodar **`/to-issues`** pra fatiar o PRD em **issues granulares e independentemente pegáveis** (vertical slices / tracer bullets), cada uma entregando **comportamento observável** pela seam alta (route handler/server action) com teste de integração contra Postgres real. Publicar no GitHub com dependências claras e label `ready-for-agent`.

## Ordem/dependências sugeridas (aterrar a fatia no modelo de dados do PRD)

Fundação antes de feature. Esqueleto da ordem natural (o `/to-issues` refina):
1. **Setup do banco** — Postgres + extensões `unaccent` e `pgvector`; harness de teste (Postgres real descartável + cliente Claude mockável). É pré-requisito de quase tudo.
2. **Schema canônico de Receita** — `Recipe` (origin, visibility, result_kind, owner_id, parent_recipe_id+lineage_kind, restrições[]) + `RecipeTranslation` + `Ingredient` canônico + `RecipeIngredient`. O Zod/Drizzle único (ADR-0009) nasce aqui.
3. **Usuário/papéis/auth** (ADR-0011) — destrava salvar/publicar/votar/favoritar; anônimo efêmero não depende disto.
4. **Busca híbrida** (ADR-0008) — depende de schema + traduções + embeddings.
5. **Geração IA** (conversa e estruturada, ADR-0009) — depende do schema canônico + interface mockável do Claude.
6. **Publicação/comunidade, votos, derivada/diff, aviso de restrição, moderação reativa** — em cima do núcleo.

## Princípios inegociáveis (não reabrir)

- Receita é o centro; segurança/compliance = toque leve (ADR-0004), nunca subsistema.
- Identidade única de Receita (ADR-0001) — nunca bifurcar por locale.
- Owner ≠ Autoria ≠ Proveniência.
- Termos do `CONTEXT.md` são lei.
- **Decisões travadas no PRD:** seam de teste (Postgres real + Claude mockável, teste pela porta mais alta); **linhagem unificada** (`parent_recipe_id` + `lineage_kind`); **última versão estável** de toda dependência (Next.js não-pinado em 15).

## Landmines

- **`result_kind`** só tem `success | degraded | playful` no banco. `impossible` e `invalid` são desfechos de geração que **não** viram Receita nem estado de banco — não adicionar ao enum.
- **Invariantes de banco** que cada fatia relevante precisa respeitar: CHECK `result_kind=playful ⇒ visibility=private`; CHECK `mode=structured ⇒ briefing presente`; `ON DELETE SET NULL` no `parent_recipe_id`; UNIQUE + não-autovoto no Voto; `origin` imutável.
- **Não criar ADR de infra** — Vercel/Neon é assunção não-ratificada; provider de banco fica neutro. O PRD exige "um Postgres com FTS por idioma + unaccent + pgvector + bancos descartáveis", não um fornecedor.
- **Cada fatia de feature entrega teste de integração** pela seam alta contra Postgres real; Claude sempre mockado nos testes.
- Não confundir **despublicar** (Owner toca `visibility`) com **remover do pool** (Curador, estado de moderação) — são caminhos distintos no schema.

## Gotchas de ambiente

- **Labels de triagem agora EXISTEM** (criadas nesta sessão): `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Não precisa recriar.
- **Escritas no GitHub** (`gh issue create`, labels) **funcionaram** nesta sessão sem bloqueio — mas o classificador de permissão do harness pode barrar; se barrar, o usuário aprova ou roda via `! ...`.
- **Branch:** `main` (commits foundacionais vão direto na main).
- **Push pendente:** o PRD foi commitado local (commit `1015686`) mas **não foi pushed**. O link do issue #1 pra `docs/prd/refogando.md` só resolve no GitHub depois do push. Pedir push ao usuário antes/no início da fase de issues, se quiser os links vivos.
- Repo: `fernandolisboa/refogando` (público); `gh` opera direto do clone.

## Como trabalhar com este usuário (memória persistida)

Em `~/.claude/projects/-home-ferna-projects-refogando/memory/`:
- **prefer-plain-language-no-jargon** — linguagem simples e direta, sem firula; frases curtas (ele reclamou de "rebuscado"). Termos do glossário continuam à risca.
- **decide-reversible-details-…** — grelhe só forks irreversíveis/que congelam schema; reversível: decida com default + **o porquê**, deixe vetar. Sem bikeshed.
- **keep-product-core-central-…** — receita é o centro; segurança/compliance = toque leve.
- **use-latest-stable-deps** — última versão estável de tudo; não pinar major velha.
- **infra-assumptions-vercel-neon** — Vercel + Neon não-ratificados; não cravar em ADR.
- Estilo: pt-BR informal, gosta de ser grelhado em decisão de verdade, prioriza momentum.

## Suggested skills

- **`/to-issues`** — fatiar o PRD em vertical slices publicadas no GitHub (tarefa principal desta fase).
- **`/triage`** — se for preciso ajustar estados/labels das issues criadas.
- Na fase de dev (depois): seleção automática por caso — `tdd`, `diagnose`, `review`, `request-refactor-plan`, `verify`, `run` (ver `CLAUDE.md`).

## Critério de saída desta fase

PRD fatiado em issues granulares (vertical slices) com dependências claras, publicadas no GitHub com labels. Então iniciar a **fase de Desenvolvimento** pelo fluxo de 8 passos por issue (`CLAUDE.md`).
