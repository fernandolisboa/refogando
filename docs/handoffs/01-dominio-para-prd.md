# Handoff 01 — Domínio → PRD

**Fase concluída:** Domínio (`/grill-with-docs`). **Próxima fase:** PRD (`/to-prd`).
Pipeline completo + fluxo de dev de 8 passos: ver `CLAUDE.md` → "Fluxo de trabalho".

## Ler primeiro (no repo — não duplicado aqui)

- **`CONTEXT.md`** — glossário canônico (~35 termos). Use os termos exatos; respeite os `_Avoid_`.
- **`docs/adr/0001-0013`** — decisões travadas (índice abaixo).
- **`CLAUDE.md`** — config das skills + o fluxo de trabalho por fases e o de 8 passos por issue.
- **`docs/agents/{issue-tracker,triage-labels,domain}.md`** — tracker = GitHub Issues; labels de triagem default; contexto único.

## Índice dos ADRs (o que já está cravado — não reabrir)

- 0001 i18n: identidade única language-neutral + tradução por `(recipe_id, locale)`
- 0002 Proveniência: entidade única `Recipe` com enum `origin`
- 0003 Publicação self-service + pool da comunidade seccionado (catálogo vs comunidade)
- 0004 Restrições: **aviso leve**, não verificação (app é receita-primeiro)
- 0005 Edição → **derivada** com diff (nunca muta a base)
- 0006 Sessão de criação: transcript persistido, apagável, sem TTL
- 0007 Reputação/shadow-ban: **PARADO** (sem mecânica no MVP)
- 0008 Busca **híbrida** FTS por idioma + semântica pgvector (dia 0); embeddings por locale
- 0009 Contrato de geração: schema canônico + taxonomia de resultado (success/degraded/playful/impossible/invalid)
- 0010 Stack consciente: Next.js 15 / Drizzle / Neon (reversível)
- 0011 Usuário + papéis (Visitante/Usuário/Curador/Admin) + acesso anônimo
- 0012 Ingrediente canônico vs item-de-receita (FK opcional best-effort)
- 0013 `result_kind` na Receita (`success|degraded|playful`; CHECK playful ⇒ privada)

## Tarefa desta sessão

Rodar **`/to-prd`** para gerar o PRD a partir da fundação do domínio. O PRD deve:
- cobrir os **três modos** (buscar, criar conversando, criar estruturada) e o **bilíngue pt-BR/en-US**;
- **honrar os 13 ADRs** (não reabrir decisões travadas);
- **resolver as 9 lacunas de shape de implementação** abaixo (é exatamente o que o PRD/issues precisam decidir);
- manter o princípio **receita-primeiro / segurança leve**.

## Princípios inegociáveis

- Receita é o centro; segurança/compliance = toque leve (ADR-0004), nunca subsistema.
- Identidade única de Receita (ADR-0001) — nunca bifurcar por locale.
- Termos do `CONTEXT.md` são lei; sem sinônimos proibidos.
- Owner (controla a linha) ≠ Autoria (atribuição) ≠ Proveniência (o "como").

## As 9 lacunas em aberto (o PRD deve fechar)

1. Versionamento da regeneração (ADR-0006) — unificar com o lineage da derivada (0005).
2. Nomear o estado candidato/"Sugestão" (0009) ou declarar tudo persistido.
3. Comentário consultivo (0009): persistido junto da geração ou só exibido?
4. Persistência do diff da derivada (0005): JSONB apresentacional vs tabela.
5. Modelagem do Briefing (0006/0012): FK pro ingrediente + campo "força" (obrigatório/preferido); CHECK `mode=structured` ⇒ briefing presente.
6. `ON DELETE` de `base_id` (0005): recomendado `SET NULL`; cobrir edição da própria receita pública.
7. Embedding: coluna pgvector em `RecipeTranslation` vs tabela `recipe_embedding`; busca semântica em locale sem tradução.
8. "Restrições atendidas": enum-set vs tabela + mapa alérgeno→restrição (glúten → sem_glúten).
9. Zoeira on-device (0009, deferido): se sair do deferido, fica fora do schema canônico/i18n.

## Como trabalhar com este usuário (memória persistida)

Em `~/.claude/projects/-home-ferna-projects-refogando/memory/`:
- **decide-reversible-details-…** — grelhe só os forks irreversíveis/que congelam schema; detalhe reversível: decida com default + **o porquê** (não dispense), deixe ele vetar. Sem bikeshed.
- **keep-product-core-central-…** — receita é o centro; segurança/compliance = toque leve, não subsistema, salvo pedido explícito.
- **infra-assumptions-vercel-neon** — Vercel + Neon são **assunção não-ratificada**; não cravar em ADR até o usuário bater o martelo (provável no PRD ou ADR de infra).
- Estilo: pt-BR informal, gosta de ser grelhado em decisão de verdade, prioriza momentum.

## Gotchas de ambiente

- **Escritas no GitHub podem ser barradas** pelo classificador de permissão do harness (uma `gh issue create` foi bloqueada nesta sessão). O `/to-prd` publica no tracker — se for barrado, o usuário aprova o prompt de permissão ou roda o comando via `! ...`.
- Branch de trabalho: `main` (repo greenfield do dono; commits foundacionais vão direto na main).
- Labels de triagem ainda **não existem** no GitHub — criar antes de aplicar (ver `docs/agents/triage-labels.md`).

## Critério de saída desta fase

PRD pronto e publicado, cobrindo os 3 modos + resolvendo as 9 lacunas, sem reabrir ADRs. Então rodar `/handoff` → `docs/handoffs/02-prd-para-issues.md` + kickoff pra fase de `/to-issues`.
