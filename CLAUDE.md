# refogando

## Agent skills

### Issue tracker

Issues and PRDs are tracked in this repo's GitHub Issues (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default triage label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.

## Fluxo de trabalho

O desenvolvimento segue um pipeline por **fases**. Cada fase é uma sessão nova, iniciada colando o **prompt de kickoff** da fase anterior; o agente lê o **handoff** correspondente em `docs/handoffs/` e começa dali.

### Pipeline de fases (ordem das skills)

1. **Domínio** — `/grill-with-docs` → `CONTEXT.md` + `docs/adr/`. ✅ concluído.
2. **PRD** — `/to-prd` → Documento de Requisitos do Produto, a partir da fundação do domínio.
3. **Issues** — `/to-issues` → fatia o PRD em issues granulares (vertical slices) com dependências claras, **publicadas no GitHub** nesse momento.
4. **Desenvolvimento** — por issue, o fluxo de 8 passos abaixo. Durante o dev, **selecionar automaticamente** a skill certa para cada caso (ex.: `tdd`, `diagnose`, `review`, `request-refactor-plan`, `verify`, `run`), sem o usuário precisar nomear.

### Fluxo de implementação por issue (8 passos)

Cada passo roda num **subagente especializado com contexto novo** (spawn fresco por passo):

1. **Explorar** — olhar a base de código e/ou conteúdo externo pra aprender o que executar.
2. **Planejar** — criar o plano de implementação.
3. **Revisar o plano** — validar correção; apontar ajustes.
4. **Corrigir o plano** — se necessário.
5. **Implementar** — código de verdade; pode spawnar subagentes em **paralelo** quando dá.
6. **Code-review** — spawnar **múltiplos** subagentes especializados (ex.: bugs/correção, segurança, qualidade/manutenibilidade, performance, aderência aos ADRs e ao `CONTEXT.md`).
7. **Corrigir** — aplicar os achados dos reviews.
8. **Validar e fechar** — se tudo verde (testes, lint, types, reviews satisfeitos): mergear o PR e fechar a issue relacionada.

### Handoff ao fim de cada fase

Rodar `/handoff` para gerar:
- um **documento de handoff** auto-suficiente em **`docs/handoffs/`** (commitado — nunca `/tmp`), aterrado no **código/artefatos reais**: escopo, o que ler primeiro, ordem/dependências, princípios inegociáveis, landmines, critério de saída, gotchas de ambiente;
- um **prompt de kickoff** copiável (bloco no fim da resposta, sem indentação e sem quebra de linha dentro dos parágrafos) apontando pro doc, pro usuário iniciar a próxima sessão sem re-derivar contexto.
