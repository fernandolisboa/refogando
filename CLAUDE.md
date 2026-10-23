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

## Privacidade

- **A política anda junto com o código.** PR que muda dado pessoal coletado, finalidade, fornecedor, prazo de
  retenção ou conteúdo de log (este, se não couber no que a política já diz no item 3.7) atualiza **no mesmo PR**:
  a política (seção `privacidade` de `src/i18n/messages/pt-BR.ts` e `en-US.ts`, com nova versão na seção
  Alterações (`s10Historico`) e no rodapé), `docs/legal/registro-de-operacoes.md` e, se mudar uma decisão, o parecer
  (`docs/legal/parecer-interno-*.md`).
- **Termos de Uso** (seção `termos`, `/termos`, ADR-0051): mudança relevante só vale **15 dias depois** de um aviso
  no app e/ou e-mail (item 10), que o MESMO PR entrega: nova `AVISO_LEGAL_VERSAO` e o público do aviso em
  `src/domain/legal-notice.ts` (o `LegalChangeNotice` do layout volta para quem dispensou o anterior), nova linha
  em `termos.s10Historico` + rodapé com data própria (constante nova em `src/domain/legal-notice.ts`);
  `DATA_PUBLICACAO_TERMOS_V1` fica congelada depois do merge (data a v1, a v3.1 da política e o corte do aviso da
  v1). Feature que muda o que os Termos afirmam (denúncia, moderação, sanções, importação, cópias, eliminação,
  notificações de retirada) atualiza o texto no mesmo PR. Os Termos prometem processos manuais (conta de menor de
  16, encerrar conta, nova análise): o procedimento está no ADR-0051.
- **Textos que andam junto:** o rodapé de `seusDireitos` (versão, data e status) é igual ao da política, e um teste
  (`test/ui/seus-direitos.test.tsx`) reprova se divergirem; `restricoesPerfil.consentimento` (o texto junto do botão
  de salvar as restrições) nomeia o fornecedor de IA e o país onde o app e a IA funcionam, então trocar de
  fornecedor ou de região muda esse texto também. Se a mudança alterar algo que a pessoa autorizou com
  consentimento, ela precisa de aviso em destaque no lugar onde consentiu (LGPD art. 8º, §6).

## Banco de dados — landmines

- **Produção é o Neon `misty-lake-71917023` (branch `main`, host `ep-gentle-morning-…`).** Nunca rode
  reset/drop/truncate contra ele. Migrações só via `npm run db:migrate` (build da Vercel) ou `drizzle-kit migrate`.
- **Nunca exporte `DATABASE_URL`/`TEST_DATABASE_URL` globalmente no shell.** Agentes de outros repos herdam e
  podem resetar o schema (foi o incidente de 2026-09-09 — ver `docs/incidents/`).
- **Backup = branches `backup/<data>` do Neon** criados por `.github/workflows/db-backup.yml` (semanal).
  Plano free guarda só 6h de histórico; não existe PITR além disso. Restore documentado no workflow.

