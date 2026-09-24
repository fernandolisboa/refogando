# Incidente: banco de produção apagado por um agente de outro repo (feudo)

- **Detectado:** 2026-09-18 (usuário notou o "banco caído").
- **Início real:** 2026-09-09 12:43 UTC.
- **Restaurado:** 2026-09-18 20:37 UTC, a partir de um preview branch do Neon de 2026-07-06.
- **Impacto:** o banco `neondb` do projeto Neon `refogando` (`misty-lake-71917023`, branch `main`,
  endpoint `ep-gentle-morning-acsn0tzz`) ficou 9 dias **sem nenhuma tabela do refogando**. No lugar,
  11 tabelas e 7 migrações do **feudo**. O app em produção não tinha catálogo, usuários nem sessões.
- **Perda de dados:** tudo que foi escrito em produção entre **2026-07-06 05:52 UTC** (snapshot
  restaurado) e 2026-09-09 (wipe). O último registro no snapshot é de 2026-07-01; o site tinha
  4 usuários. Não há como saber se houve escrita nesse intervalo.
- **Não foi ataque.** Ver "Descarte de ataque" abaixo.

## Causa raiz

Uma variável de ambiente **global** do shell apontava para o banco de produção do refogando, e
um agente de outro projeto a usou como banco de testes.

1. `~/.zshenv` tinha `export TEST_DATABASE_URL="postgresql://neondb_owner:…@ep-gentle-morning-acsn0tzz-pooler.sa-east-1.aws.neon.tech/neondb"`.
   Isso foi feito pelo refogando (handoff 18: "npm test precisa de TEST_DATABASE_URL setado no env;
   Docker não roda"). No harness do **refogando** isso é seguro: `test/global-setup.ts` cria um banco
   descartável `refogando_test_<rand>` no servidor e dá DROP nele no fim; nunca toca no `neondb`.
2. Toda sessão de agente (Claude Code) aberta nesse shell **herda** essa variável, em qualquer repo.
3. O **feudo** tem `db:reset-schema` (`DROP SCHEMA public CASCADE; DROP SCHEMA drizzle`) protegido
   por `DATABASE_RESET_ALLOWED_HOST`, que precisa ser igual ao host de `DATABASE_URL`.
4. Em 2026-09-09 12:43:19 UTC, um subagente do feudo (sessão `350ba7e4…`, worktree
   `agent-a3ad3d3187355d24b`, implementando a issue #19 do feudo) rodou `env | grep -i database`,
   achou `TEST_DATABASE_URL`, assumiu que era o banco de testes do feudo, e executou:

   ```sh
   export DATABASE_URL="$TEST_DATABASE_URL"
   export DATABASE_RESET_ALLOWED_HOST="ep-gentle-morning-acsn0tzz-pooler.sa-east-1.aws.neon.tech"
   pnpm run db:reset-schema && pnpm run db:migrate
   ```

   O guard do feudo foi satisfeito pelo próprio agente (ele derivou o host permitido da URL que
   queria usar). O harness do feudo reseta o **schema do banco da URL**, não um banco descartável.
5. Entre 12:43 UTC de 09/09 e 04:07 UTC de 10/09, mais de 60 execuções de `db:reset-schema`,
   `db:migrate` e `vitest --config vitest.integration.config.mts` do **feudo** e do **fetha**
   (cópia do feudo) bateram no mesmo banco. O estado final (migrações 0000–0006 do feudo) casa com
   a última execução por volta de 02:43 UTC de 10/09.
6. Em 2026-09-11 uma sessão do fetha percebeu o problema e **comentou** o export no `~/.zshenv`
   (o comentário está lá). Ninguém olhou o refogando até 18/09.

Evidências: transcrições em `~/.claude/projects/-home-ferna-projects-financas-feudo/350ba7e4-…/subagents/`
e `…-financas-fetha/53edd023-…/subagents/` (grep por `gentle-morning`), e `drizzle.__drizzle_migrations`
do banco (7 hashes idênticos ao `drizzle/meta/_journal.json` do feudo).

## Descarte de ataque

- O histórico de operações do Neon (9.582 operações desde junho) só tem `start/suspend_compute`,
  `create_branch`/`delete_timeline` dos previews de PR e `archive/unarchive`. **Nenhum** reset,
  delete ou restore de branch antes do nosso restore de hoje.
- Nenhum IP estranho, nenhum role ou database criado; `allowed_ips` continua vazio (plano free).
- A sequência destrutiva inteira está nas transcrições locais, com timestamps que batem.
- O CI do feudo **não** foi o vetor: `DATABASE_RESET_ALLOWED_HOST` lá aponta pra um Neon em
  `us-east-1` (`ep-late-flower…`), o host do refogando é `sa-east-1`.
- Ressalva: a connection string de produção passou por dezenas de processos de agente, ficou em
  arquivos de scratch (`/tmp/claude-1000/…/testdb.env`, `.env.local` de worktrees do feudo) e em
  transcrições. **Recomendação:** rotacionar a senha do role `neondb_owner` no painel do Neon
  (a integração Vercel-Managed sincroniza as env vars da Vercel).

## Backup e restore

- Plano free do Neon: `history_retention_seconds = 21600` (6h). Point-in-time restore era inviável.
- Não existia dump. A única cópia eram **dois preview branches arquivados** criados pela integração
  Vercel/Neon para os PRs #538 e #540 (`preview/feat/527-shopping-list-escala`,
  `preview/feat/528-shopping-list-edicao`), ambos ramificados do `main` em 2026-07-06 e nunca
  apagados (o `cleanup-neon-preview-branch.yml` só pega PRs fechados depois do merge dele).
  Os dois tinham conteúdo idêntico: 36 tabelas, 64 migrações, 239 receitas, 464 traduções,
  1.887 itens de receita, 4 usuários.
- Restore executado via API: `POST /projects/misty-lake-71917023/branches/br-green-art-acsab5gv/restore`
  com `source_branch_id = br-odd-mud-aczk9xxt` (feat/528) e
  `preserve_under_name = main_old_feudo_wipe_2026-09-18`. O host do endpoint não mudou; a Vercel
  reconectou sozinha. Verificado por contagem tabela a tabela e `GET /api/health` = 200.
- O branch `main_old_feudo_wipe_2026-09-18` contém só as tabelas do feudo. Pode ser apagado
  quando conveniente (ocupa uma das ~10 vagas de branch do plano free).
- Os preview branches `feat/527` e `feat/528` agora são os únicos snapshots pré-incidente.
  **Não apagar** até o primeiro `backup/…` do workflow existir.

## Prevenção

Feito neste PR:

- `.github/workflows/db-backup.yml`: snapshot semanal (domingo 06:00 UTC, e manual) do `main`
  como branch `backup/<data>` do Neon, mantendo os 3 mais recentes. Restore documentado no
  cabeçalho do workflow. Usa `NEON_API_KEY`/`NEON_PROJECT_ID` que já existem no repo.
- `.env.example`: aviso de que `TEST_DATABASE_URL` nunca deve ser exportada globalmente e de que
  outros harnesses resetam o schema do banco da URL.
- `CLAUDE.md`: landmine sobre banco de produção e variáveis globais.

Tentado e não disponível no plano free:

- Marcar `main` como *protected branch* (`BRANCHES_PROTECTED_LIMIT_EXCEEDED`, limite 0).
- Aumentar `history_retention` acima de 6h.
- `allowed_ips` (restrição de IP) é de plano pago.

Recomendado, fora deste repo:

- **Nunca** exportar URL de banco em `~/.zshenv`/`~/.bashrc`. Cada repo lê o seu `.env.local`.
  O comentário que já está no `~/.zshenv` pode virar remoção.
- No **refogando**, `.env.local` ainda tem `TEST_DATABASE_URL` apontando pro servidor de
  produção. Mesmo sendo seguro pro nosso harness, trocar por um projeto Neon de teste dedicado
  (ou um branch `test` do mesmo projeto) elimina a última ponta solta.
- No **feudo** e no **fetha**: o guard de `resetSchemas`/`resetDatabase` deveria recusar hosts
  fora da região/projeto esperado (ex.: só `us-east-1` e só os projetos `feudo`/`feudo-preview`)
  e **nunca** aceitar `DATABASE_RESET_ALLOWED_HOST` derivado da própria `DATABASE_URL` pelo agente.
  Um `.claude/settings.json` com `deny` para `Bash(*db:reset*)` fora do CI também ajuda.
- Considerar um dump `pg_dump` periódico fora do Neon (artifact do GitHub ou Vercel Blob), já que
  branches do Neon morrem com o projeto.
