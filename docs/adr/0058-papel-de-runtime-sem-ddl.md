# ADR-0058 — Papel de runtime sem DDL (`app_rw`)

Status: aceito (2026-11-03)

Issue #644 (achado M-5 da auditoria SAST, `.security-audit/REPORT.md`). Relaciona: incidente de 2026-09-09
(`docs/incidents/`), achado H-3 do REPORT (guarda do banco de produção no harness de teste, `test/helpers/production-db-guard.ts`).

## Contexto

- A app conectava com a `DATABASE_URL` que a integração Neon/Vercel entrega: o papel `neondb_owner`, dono de todas as
  tabelas. Uma injeção de SQL futura ou uma dependência comprometida teria `DROP`, `TRUNCATE` e `ALTER` sobre todos os
  dados pessoais, e o plano free do Neon guarda só 6 h de histórico.
- O código de runtime não faz DDL (conferido: nenhum `CREATE`/`ALTER`/`DROP`/`TRUNCATE`/`LOCK TABLE` fora das
  migrações e dos testes). Só DML, advisory locks e `SET LOCAL lock_timeout`.
- As migrações rodam no build (`npm run db:migrate`, `vercel.json`) e precisam do dono.
- A integração gerencia `DATABASE_URL*` em Production e cria uma por branch de Preview. Trocar o valor dela à mão
  briga com a integração.

## Decisão

1. **Variável nova, só de runtime:** `APP_DATABASE_URL`. `getDb()` usa `resolveRuntimeDatabaseUrl`
   (`src/db/runtime-url.ts`): `APP_DATABASE_URL` quando existe (aparada; vazia conta como ausente), senão
   `DATABASE_URL`. O build, o `drizzle.config.ts` e os scripts seguem com a URL do dono. Na Vercel, a variável existe
   só em Production; o Preview segue com a branch do PR como está (ver #646).
   - O REPORT sugeria o inverso (`MIGRATION_DATABASE_URL` para o dono e `DATABASE_URL` com o `app_rw`). Não foi esse o
     caminho, porque exigiria sobrescrever a variável que a integração gerencia.
2. **O papel:** `app_rw`, criado por SQL (`scripts/sql/papel-app-rw.sql`), nunca pela tela de Roles do Neon, que põe o
   papel em `neon_superuser`. Ele tem `CONNECT`, `USAGE` em `public`, DML em todas as tabelas e `USAGE, SELECT` nas
   sequências. Também tem `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner`, para que tabela ou sequência criada por
   migração futura já nasça acessível. Sem acesso ao schema `drizzle` (histórico das migrações).
3. **Prova:** `test/integration/runtime-role.test.ts` roda esse mesmo arquivo, trocando os nomes do papel, do dono e
   do banco pelos do banco descartável. O dono do teste é um papel sem superusuário, como o `neondb_owner`. O teste
   prova seis coisas:
   - o papel não é superusuário e não é membro de nenhum outro papel;
   - tem os quatro privilégios em toda tabela e sequência de `public`;
   - um caminho real da app funciona com o papel: semear Receita, com as colunas geradas de FTS, e `GET /api/search`;
   - o upsert do limitador e o advisory lock funcionam;
   - uma tabela criada depois pelo dono já nasce acessível;
   - `DROP TABLE`, `TRUNCATE`, `ALTER TABLE`, `CREATE TABLE` e `DROP SCHEMA` dão 42501.
4. **Conferência em produção:** `scripts/sql/conferir-papel-app-rw.sql`, rodado no SQL Editor depois do SQL do
   papel, tem que voltar zero linhas. Isso importa porque `GRANT … ON ALL TABLES` sobre tabela de outro dono só dá
   WARNING. Depois, na primeira conexão de cada instância, sai uma linha
   `[db] runtime conecta como papel=<papel> origem=<variável>` (`docs/observabilidade.md`). O nome do papel vem do
   usuário da URL (`dbRoleFromUrl`), sem senha nem host.
5. **Guarda do E2E:** `e2eFakesActive` também recusa `APP_DATABASE_URL` fora de loopback, já que a app passaria a
   preferi-la.

## Consequências

- **Tabela nova numa migração:** não precisa de `GRANT`, porque o default privilege cobre. A exceção é uma migração
  rodada por outro papel que não o `neondb_owner`: ela precisa de `GRANT` explícito, e o teste não pega isso.
- **Schema novo além de `public`:** precisa de `GRANT USAGE` e dos privilégios para o `app_rw` na mesma migração.
- **Feature que precise de DDL em runtime** (`REFRESH MATERIALIZED VIEW`, `TRUNCATE`, tabela ou índice em `public`):
  o `app_rw` não consegue. Ou a feature muda de desenho, ou este ADR é revisto. Tabela temporária ele consegue,
  porque `PUBLIC` tem `TEMPORARY` no banco por padrão. Ela some com a sessão e não toca dado de ninguém, então
  ficou como está.
- **Senha errada na `APP_DATABASE_URL`:** derruba toda request de banco. Rollback: Instant Rollback para o deploy
  anterior na Vercel (ele guarda o env da época) ou apagar a variável e fazer redeploy.
- **O papel herda nas branches:** branches novas do Neon criadas de `main` copiam os papéis, então o `app_rw` existe
  também nas branches de Preview, com a mesma senha. Isso entra no desenho do #646.
