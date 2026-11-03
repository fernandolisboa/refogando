# Handoff 98 — Papel de runtime sem DDL (`app_rw`, #644)

**Data:** 2026-11-03.
**Commits:** "Papel de runtime sem DDL: APP_DATABASE_URL e app_rw (#644)" e, em cima, os achados da revisão.
**Base:** `7f0b034` (main depois do #654).
**Migração:** nenhuma.
**ADR:** ADR-0058 (novo).
**Política:** sem mudança. A linha `[db]` é registro técnico e leva só o nome do papel, então cabe no item 3.7.

## 1. Escopo

- `getDb()` usa `APP_DATABASE_URL` quando existe. Sem ela, segue com a `DATABASE_URL` (`src/db/runtime-url.ts`,
  `src/server/deps.ts`).
- Na primeira conexão de cada instância, sai a linha `[db] runtime conecta como papel=… origem=…`.
- O SQL do papel está em `scripts/sql/papel-app-rw.sql` e é provado por `test/integration/runtime-role.test.ts`.
- A guarda do E2E recusa `APP_DATABASE_URL` remota. O harness do E2E zera essa variável e a guarda de produção do
  harness de teste conta o servidor dela como banco da app.
- Sem a variável, nada muda. O merge é seguro antes de o Fernando criar o papel.

## 2. O que ler primeiro

1. ADR-0058.
2. `src/db/runtime-url.ts` e `getDb` em `src/server/deps.ts`.
3. `scripts/sql/papel-app-rw.sql` e `test/integration/runtime-role.test.ts`.
4. M-5 em `.security-audit/REPORT.md`.

## 3. Ordem e dependências

Os passos 1 e 2 são do Fernando e estão na página "Tarefas do security scan", bloco #644.

1. Rodar o SQL no SQL Editor do Neon, branch `main`, com uma senha só de letras e números. Depois, rodar
   `scripts/sql/conferir-papel-app-rw.sql`, que tem que voltar zero linhas.
2. Criar `APP_DATABASE_URL` em Production na Vercel e fazer o redeploy. A URL é a pooled, com o usuário `app_rw`, e a
   variável é Sensitive. Se este PR ainda não estiver mesclado, o merge já faz o deploy.
3. Conferir o log:
   `npx vercel@latest logs --token $VERCEL_TOKEN --scope flisboa-projects --project refogando -e production --since <ISO> --query '[db]' --json`.
   Ele tem que mostrar `papel=app_rw origem=APP_DATABASE_URL`.
4. Com isso confirmado, fechar o #644 e marcar o M-5 do REPORT como CORRIGIDO.

## 4. Princípios inegociáveis

- O papel é criado por SQL, nunca pela tela de Roles do Neon: lá ele vira membro de `neon_superuser`.
- As migrações seguem com o dono. Não mexer na `DATABASE_URL` que a integração Neon/Vercel gerencia.
- Nada de DDL em runtime. Uma feature que precise de DDL revê o ADR-0058 antes.

## 5. Landmines

- **Senha errada na `APP_DATABASE_URL`:** toda request de banco cai. O rollback é o Instant Rollback da Vercel, ou
  apagar a variável e fazer o redeploy.
- **Papel criado pela tela de Roles:** `test/integration/runtime-role.test.ts` não pega isso, porque o teste roda num
  banco descartável e não em produção.
- **Migração rodada por outro papel** que não o `neondb_owner`: os default privileges não cobrem e ela precisa de
  `GRANT`. Um schema novo também precisa (ADR-0058, Consequências).
- **Branches do Neon:** o `app_rw` é copiado para toda branch nova, inclusive as de Preview, com a mesma senha.
  Considerar isso no #646.

## 6. Gotchas de ambiente

- O teste de integração precisa de Postgres 17 com pgvector. No container da sessão: `dockerd &` e depois
  `npx vitest run test/integration/runtime-role.test.ts`, que usa Testcontainers.
- Com `TEST_DATABASE_URL`, o papel de teste precisa de `CREATEROLE`.

## 7. Follow-ups

- #646, segredos do Preview.
- Trocar a senha do `neondb_owner`, pendente desde o incidente. Antes, listar pela API da Vercel as variáveis
  `DATABASE_*`, `POSTGRES_*` e `PG*` que levam essa senha.

## 8. Critério de saída

- `checks` e `e2e` verdes.
- O log de produção mostra `papel=app_rw`.
- #644 fechado.
