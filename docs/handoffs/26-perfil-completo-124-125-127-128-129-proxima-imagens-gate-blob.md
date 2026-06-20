# Handoff 26 — Perfil completo (#124/#125/#127/#128/#129 mergeados); próxima: imagens de receita, atrás do gate do Vercel Blob

## Escopo
Iniciativa **Imagens de receita + Perfil + Split do Admin**. Domínio + PRD + 11 issues já existem; esta sessão **entregou todas as fatias sem dependência externa**. O que resta (imagens) depende de um token do Vercel Blob — pendência humana, quase resolvida.

## Ler primeiro (não duplico aqui — referência)
- **PRD:** issue #122 + `docs/prd/imagens-perfil-admin.md`.
- **ADRs:** `docs/adr/0016-imagem-da-receita-entidade.md` (imagem = entidade ref-counted), `docs/adr/0017-contrato-geracao-imagem-ia.md` (geração REST sem SDK + tetos), adendo Blob em `docs/adr/0010-stack-decisoes-conscientes.md`.
- **Glossário:** `CONTEXT.md` — termos **Imagem da receita** e **Handle**.
- **Memórias:** `imagens-perfil-admin-initiative.md` (grafo de issues + decisões), `ci-merge-and-parallel-agent-gotchas.md` (gotchas operacionais).

## Feito nesta sessão (tudo mergeado, verde, cada um com review focado + CI isolada)
| PR | Issue | Entrega |
|----|-------|---------|
| #135 | #124 | Perfil: editar nome + bio (`/me/profile`, `GET/PATCH /api/me`) |
| #136 | #125 | Admin em rotas aninhadas `/admin/{config,users,moderation,translations,catalog}` + layout gate único fail-closed + link "Painel" (curador+) |
| #138 | #128 | Handle (`users.handle`, auto na criação + editável + backfill); `/api/me` valida; `src/domain/handle.ts` + `src/server/handle.ts` |
| #139 | #127 | Links sociais (`users.links` jsonb, ≤5, só URL http(s) — `safeHttpUrl` em `src/domain/links.ts`) |
| #140 | #129 | Perfil público `/u/<handle>` (anon) + crédito de **Autoria** (byline) no feed/busca/detalhe |

Perfil é navegável ponta-a-ponta. `main` em `56003e2`.

## Falta — ordem e dependências
1. **#126 avatar** — FAZ NASCER o **`ImageStore`** (Vercel Blob atrás de interface fina, Real/Fake/Throwing em `src/server/deps.ts`, espelhando Claude/Embedder/Translator). Avatar grava em `users.image` (URL), **não** na entidade `recipe_image`. `next.config` `remotePatterns` ou `<img>` simples; redimensiona no cliente. **Bloqueado pelo gate do Blob (abaixo).**
2. **#130 recipe_image + upload de foto** ← #126. Tabela `recipe_image` + FK `recipe.image_id`, many-versions→one-image, **ref-counted** (ADR-0016).
3. **#131 carry-forward** (herda image_id ao versionar; classificador grande/pequena determinístico) · **#132 geração IA** (seam `ImageGenerator`, Nano Banana 2 `gemini-3.1-flash-image` via REST puro, bytes→blob, tetos 24h deslizante) · **#133 moderação** ("remover só a imagem" = flag `recipe_image.moderated_at`, owner mantém privado) — todas ← #130.
4. **#134 /admin/ai** ← #125 + #132 (config `imageGen{enabled,model,dailyCapByRole}` estende `/api/admin/config`; liga os tetos da geração).

Paralelismo: #126/#127/#128 tocam o MESMO surface de perfil (sequenciais — #127/#128 já feitas). #130 é surface diferente (receita) → paraleliza com perfil. MAS suítes de teste concorrentes dão flake no Neon (ver landmines) → na prática rode **uma fatia por vez**.

## Gate do Vercel Blob (pendência humana — quase pronta)
- Store **criado**, acesso **PUBLIC** (correto: imagens servidas direto por URL a anônimos no perfil público/pool; o modo é **imutável**).
- O SDK `@vercel/blob` lê **`BLOB_READ_WRITE_TOKEN`** por padrão (a Vercel injeta no projeto na criação do store). **Não** é `BLOB_STORE_ID` (só id) nem `BLOB_WEBHOOK_PUBLIC_KEY` (verificação de webhook, não usamos).
- Para dev local: `vercel env pull .env.local` (ou colar só o `BLOB_READ_WRITE_TOKEN`). **Quando estiver no env, #126 destrava.** Verifique com `grep -q BLOB_READ_WRITE_TOKEN .env.local`.

## Inegociáveis
- ADR-0016/0017 e os termos do CONTEXT são lei: imagem é **entidade** `recipe_image` ref-counted (nunca coluna-URL); proveniência `user_photo|ai_generated` distinta da Proveniência da Receita; carry-forward híbrido; moderação por **flag** (não deleção). Geração: REST **sem SDK** (driblar cutoff do npm), bytes→blob num passo, tetos por papel configuráveis no admin, **janela 24h deslizante** + countdown.
- Seams de DI **Real/Fake/Throwing**; os testes **nunca** tocam Vercel Blob nem o Gemini (`FakeImageStore`/`FakeImageGenerator`).
- Pool gate **fonte única** (`src/domain/recipe-pool.ts`); admin gate **fail-closed** (`src/server/auth/admin-access.ts` — `decideSectionAccess`).

## Landmines / gotchas (vividos nesta sessão — leia!)
- **Agentes de implementação em background viram zumbis:** podem (a) derrapar ANTES de commitar (o trabalho fica staged no worktree — recupere) e (b) re-acordar e abrir **PR duplicado** (fechei #137, dup do #124). Ao assumir o worktree de um agente: `TaskStop` o agente, e **inspecione o index** (`git -C <wt> status --short`, `git -C <wt> show --stat HEAD`) ANTES de commitar — um `git add` cego varre o que o agente deixou staged (no #124 entrou de carona uma mudança de validação). Limpe os worktrees terminados (`git worktree remove --force`) e delete branches mergeadas.
- **`gh pr merge --auto` MERGEIA NA HORA** aqui (repo sem branch protection) — NÃO espera a CI. Para travar no verde de verdade: `rid=$(gh run list --branch <b> --limit 1 --json databaseId --jq '.[0].databaseId'); gh run watch "$rid" --exit-status` e SÓ ENTÃO `gh pr merge <n> --squash`.
- **Suítes concorrentes dão flake no Neon** (`PostgresError: database "refogando_test_<rand>" does not exist`) — é os DBs descartáveis correndo CREATE/DROP, **não** falha de código. Rode UMA fatia por vez; verifique pela **CI isolada** (Testcontainers, imune).
- **Branch defasada:** se o agente foi lançado ANTES de um merge anterior, a branch nasce de main velha e o diff vs main parece "deletar" o trabalho já mergeado. Faça `git merge origin/main` na branch (3-way costuma ser limpo), rode o gate no estado COMBINADO e só então mergeie (aconteceu com #125 — i18n auto-mergeou ok).
- **Backfill de migração precisa de unicidade GLOBAL:** review pegou um HIGH no #128 (`ROW_NUMBER PARTITION BY base` não garante; corrigi com laço PL/pgSQL conferindo o conjunto global). Sempre inspecione o `.sql` gerado e faça backfill seguro (add nullable → backfill → set not null → unique). Grep `search_vector|hnsw|gin` pra phantom DDL.
- **Worktree:** `cp -al <repo>/node_modules ./node_modules` (hardlink; **symlink quebra Turbopack**); `cp .env.local`; endpoint **DIRETO/unpooled** pros testes (strip `-pooler`); **nunca `npm install`** (cutoff de registro); **nunca** trabalhar fora de worktree dedicado em sessões paralelas.

## Critério de saída por fatia (AFK — sem human gate)
Implementar via TDD → **review focado por subagente** → corrigir achados → gate local DB-free verde (typecheck/lint/ui) → **CI isolada verde** via `gh run watch` → `gh pr merge --squash` → a issue fecha sozinha via "Closes #N".

## Skills sugeridas
- **NÃO** re-rodar `/grill-with-docs`, `/to-prd`, `/to-issues` — domínio/PRD/issues concluídos.
- Por issue, a sessão escolhe automaticamente: `tdd` (implementar), subagentes de code-review (revisar), `verify`/`run` (confirmar no app rodando — útil pro avatar/imagem assim que o Blob estiver ligado).
- `/handoff` ao fim da próxima leva.
