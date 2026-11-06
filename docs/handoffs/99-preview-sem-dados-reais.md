# Handoff 99 — Preview sem dados reais (#646)

**Data:** 2026-11-03.
**Base:** `f94b3e0` (main depois do #656).
**Migração:** nenhuma.
**ADR:** ADR-0059 (novo).
**Política:** sem nova versão. O registro de operações ganha a atualização de 2026-11-03 (operação 17).

## 1. Escopo

- Workflow manual `.github/workflows/preview-db.yml`: cria ou acha a branch `preview-sem-dados` (schema only) e
  copia do `main` só o histórico das migrações, `app_config` e o vocabulário ativo. Lista as `preview/*` que restam.
- ADR-0059, registro de operações e REPORT.
- O resto é configuração na Vercel e no Neon, sem código.

## 2. O que ler primeiro

1. ADR-0059.
2. `.github/workflows/preview-db.yml` (cabeçalho e travas).
3. A página "Tarefas do security scan", bloco #646 (os passos do Fernando).

## 3. Ordem e dependências

1. Merge deste PR. O `workflow_dispatch` só aparece com o arquivo na default.
2. Rodar o workflow (Actions → "Preview DB (branch sem dados reais)" → Run workflow). O resumo do job mostra a
   branch, a contagem de migrações e de contas, que tem que ser 0, e as `preview/*` que restam.
3. Fernando, na Vercel:
   - chaves de teste de IA só no Preview;
   - conexões dos stores Neon e `refogando-blob` só em Production, sem a branch por Preview;
   - store novo `refogando-blob-preview` só no Preview;
   - `DATABASE_URL` e `DATABASE_URL_UNPOOLED` da `preview-sem-dados`, só no Preview.
4. Fernando, no Neon: apagar as `preview/*`.
5. Claude, pela API da Vercel, e só depois do "feito #646":
   - `BETTER_AUTH_SECRET` e `CRON_SECRET` novos no Preview. Antes, editar as entradas atuais para só Production.
     Testar antes, numa variável descartável, que o PATCH de `target` preserva o valor.
   - Tirar `WEB_SEARCH_API_KEY` e `GOOGLE_*` do Preview.
6. Conferir:
   - `GET /v1/storage/stores/<id>`: `projectsMetadata[].environments` = `["production"]` nos dois stores antigos, e a
     ação "Neon" só em production;
   - `GET /v10/projects/<id>/env`: nenhuma chave de produção com `preview` no `target`;
   - um PR de teste sobe com o banco vazio.
   - Depois, fechar o #646.

## 4. Princípios inegociáveis

- O workflow nunca escreve no `main`.
- Nenhuma tabela com dado de pessoa vai para a preview.
- Na Vercel, editar a conexão do store, nunca removê-la: "Remove Project Connection" tira o banco da produção.

## 5. Landmines

- Se um PR com migração for abandonado, a preview diverge. Apagar a branch, rodar o workflow e trocar as duas
  variáveis do Preview, porque o host muda.
- O plano free tem 3 branches raiz, e a preview é a terceira.
- O `parent_id` de uma branch schema only pode vir preenchido na API. Quando a API devolve `init_source`, o workflow
  exige `schema-only`; sem o campo, exige branch raiz. A contagem de linhas em todo `public` é a segunda trava.
- O Neon copia os papéis para a branch nova com a mesma senha, inclusive o `neondb_owner` e o `app_rw` (ADR-0058),
  se já existirem. O workflow troca a senha de todos os papéis na `preview-sem-dados` na primeira rodada e recusa
  seguir se a senha do Preview for igual à do `main`. Se alguém recriar a branch à mão pelo Console, rode o workflow
  antes de copiar a URL para a Vercel.

## 6. Gotchas de ambiente

- A Vercel não tem API pública documentada para editar a conexão de um store. Por isso esse passo é do Fernando,
  no painel, e a conferência é pelo `GET` do store.
- O resumo do job é o único lugar com o host da preview. As URLs são mascaradas no log.

## 7. Critério de saída

- O workflow rodou verde.
- As conferências da seção 3 passaram.
- Nenhuma `preview/*` restou.
- #646 fechado.
