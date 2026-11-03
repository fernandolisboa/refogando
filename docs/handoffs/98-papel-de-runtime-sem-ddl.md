# Handoff 98 — Papel de runtime sem DDL (`app_rw`, #644)

**Data:** 2026-11-03.
**Migração:** nenhuma.
**ADR:** ADR-0058 (novo).
**Política:** sem mudança. A linha `[db]` é registro técnico e só leva o nome do papel, então cabe no item 3.7.

## 1. Escopo

- `getDb()` usa `APP_DATABASE_URL` quando existe; sem ela, segue com a `DATABASE_URL`. Código em
  `src/db/runtime-url.ts` e `src/server/deps.ts`.
- Na primeira conexão de cada instância, sai a linha `[db] runtime conecta como papel=… origem=…`.
- O SQL do papel está em `scripts/sql/papel-app-rw.sql` e é provado por `test/integration/runtime-role.test.ts`.
- A guarda do E2E recusa `APP_DATABASE_URL` remota.
- Sem a variável, nada muda. O merge é seguro antes de o Fernando criar o papel.

## 2. O que falta (passos do Fernando, na página "Tarefas do security scan")

1. Rodar o SQL no SQL Editor do Neon, branch `main`, com uma senha só de letras e números.
2. Criar `APP_DATABASE_URL` em Production na Vercel (pooled, usuário `app_rw`, Sensitive) e fazer o redeploy.
3. Conferir no log: `npx vercel@latest logs --token $VERCEL_TOKEN --scope flisboa-projects --project refogando
   -e production --since <ISO> --query '[db]' --json`. Tem que aparecer `papel=app_rw origem=APP_DATABASE_URL`.
   Depois disso, fechar o #644 e marcar o M-5 do REPORT como CORRIGIDO.
4. Depois, trocar a senha do `neondb_owner`, pendente desde o incidente. Antes, listar pela API da Vercel as
   variáveis `DATABASE_*`/`POSTGRES_*`/`PG*` que levam essa senha.

## 3. Landmines

- Se a senha da `APP_DATABASE_URL` estiver errada, toda request de banco cai. O rollback é o Instant Rollback da
  Vercel ou apagar a variável e fazer redeploy.
- O papel tem que ser criado por SQL. Pela tela de Roles do Neon, ele vira `neon_superuser`, e o teste da seção 1
  não pega isso em produção.
- Uma migração rodada por outro papel que não o `neondb_owner` não é coberta pelos default privileges e precisa de
  `GRANT`. Um schema novo também precisa (ADR-0058, Consequências).
- O `app_rw` é copiado para toda branch nova do Neon, inclusive as de Preview, com a mesma senha. Considerar isso no #646.

## 4. Critério de saída

- `checks` e `e2e` verdes.
- O log de produção mostra `papel=app_rw`.
- #644 fechado.
