# Handoff 89 — "Eliminar conta" pela equipe no Console (e a fila ready-for-agent de 2026-10-23)

**Data:** 2026-10-23.
**PR:** "\"Eliminar conta\" pela equipe no Console → Usuários e Política v3.4 (#606)".
**Base:** `main` depois do #628 (#609).
**Migração:** 0083 (`account_closure`).
**ADR:** ADR-0051 (P1 e P3 no Console, "Fora do escopo"), ADR-0050 (atualização: registro do encerramento por 5 anos).

## 1. Escopo

Fecha a fila `ready-for-agent` aberta pelo sign-off jurídico (#607/#608/#612/#613). PRs desta leva, todos squash no `main`:

| PR | Issue | O quê |
|---|---|---|
| #615 | #604 | `image` nunca vem do cliente no Better Auth; avatar sob `avatars/<chave HMAC>/` |
| #617 | #602 | Eliminação pela própria pessoa exige sessão com menos de 24 h (403 `reautenticar`) |
| #620 | #605 | "Reportar" na página da receita pública; Termos v1.1 |
| #621 | #599 | Fila de revisão de imagens só com foto de receita publicada; Política v3.2, Termos v1.2 |
| #623 | #600 | Prova do consentimento das restrições (colunas + texto versionado em `docs/legal/consentimento-restricoes.md`); limpeza de `users.image` plantado; migração 0081; Política v3.3 |
| #627 | #611 | Páginas legais com o idioma nos links, canonical e hreflang |
| #628 | #609 | Motivo da retirada na notificação (lista fechada `src/domain/moderation-category.ts`), "Pedir nova análise" por mailto; migração 0082; Termos v1.3 |
| este | #606 | "Eliminar conta" pela equipe (abaixo) |

**#606.** O admin, na gaveta de um usuário em Console → Usuários, encerra a conta por um de dois motivos dos Termos:

- `menor_16` (P1 do ADR-0051): a conta é eliminada e o conteúdo público SEMPRE sai, porque a licença de um absolutamente incapaz é nula (CC arts. 3º e 166, I). Não há opção no diálogo.
- `violacao_grave` (P3): a conta é eliminada, o conteúdo público fica (com o autor anonimizado, como na eliminação pela própria pessoa) e, se o admin marcar, sai o e-mail de encerramento.

O aviso prévio (7 dias no P1; 15 dias para baixar os dados no P3, salvo conteúdo ilegal) é humano e vem ANTES do botão. O código só executa a decisão.

Peças:

- `src/server/admin/account-closure.ts` (`closeAccountByAdmin`): o doc do topo tem a ordem do efeito e as recusas.
- `POST /api/admin/users/[id]/erasure`: mesma origem, `requireFreshRole('admin')` (sessão com menos de 24 h, senão 403 `reautenticar`), `confirmHandle` com o @ digitado.
- `eraseAccount(db, { userId, decision? })` em `src/server/legal/account-erasure.ts`. Sem decisão é o `eraseOwnAccount` de antes (evento DSAR `self_service`). Com decisão, grava `account_closure` na mesma transação e não grava evento DSAR: encerramento é decisão do controlador, não pedido do titular.
- `account_closure` (append-only, sem e-mail, nome ou @): `reason`, `removed_public_content` (CHECK: só true no menor de 16), `notified_by_email` (o aviso foi TENTADO), `decided_by` (SET NULL), `user_id` (RESTRICT). Retenção de 5 anos, passo `accountClosures` do cron de retenção.
- `CloseAccountDialog` (`src/components/admin/close-account-dialog.tsx`). O diálogo fica travado para a própria conta e para admin, e escondido para conta inativa.
- Política v3.4 (`DATA_POLITICA_V3_4`): item 3.6 (registro, base art. 7º, VI, 5 anos) e item 5 (Resend envia o aviso de encerramento). Termos sem mudança.

## 2. O que ler primeiro

1. O doc do topo de `src/server/admin/account-closure.ts`.
2. ADR-0051, seções P1/P3 e "Fora do escopo".
3. `test/integration/admin-account-closure.test.ts`: recusas, menor de 16, violação, falha do e-mail, repetição depois de falha no meio, blob que não apaga.
4. `src/domain/account-closure.ts`, com a nota de nomes: "encerramento" é a decisão, "eliminação" é o efeito.

## 3. Princípios inegociáveis

- **Menor de 16 ⇒ o público sai, sempre.** O servidor ignora a falta da flag e recusa remover o público na violação (400 `conteudo_publico_so_menor_16`).
- **Admin não elimina admin nem a si mesmo.** Para encerrar um admin, rebaixe-o antes. O papel é relido sob `FOR UPDATE` na transação (`target_admin`).
- **Nada de dado pessoal no registro nem no log.** A linha `[admin-erasure]` (`docs/observabilidade.md`) tem o motivo, as flags e `emailEnviado=`, sem id, e-mail ou nome.
- **O e-mail nunca derruba o encerramento.** Ele sai depois do commit, como best-effort, e só para e-mail confirmado.

## 4. Landmines

- **Os passos 3 e 4 não são uma transação só.** Se a eliminação falhar depois de apagar o público, a conta fica ativa, deslogada e sem o público, e nada é registrado. O admin repete: os passos são idempotentes, e o teste "repetição depois de falha" cobre isso.
- **`notified_by_email` diz "tentamos", não "chegou".** A linha nasce dentro da transação, antes do envio, e a tabela não tem UPDATE. Se o Resend aceitou, isso fica em `emailSent` (resposta) e `emailEnviado` (log). A política diz "se tentamos avisar por e-mail". Mudar o sentido da coluna exige gravar fora da transação e mudar a política.
- **FK nova para `users` com RESTRICT entra em `CONTENT_GUARDS`** (`src/server/auth/pending-signup-purge.ts`), senão o expurgo de cadastro pendente quebra.
- **Rota admin nova com `requireFreshRole`:** `test/unit/admin-api-guard.test.ts` aceita `requireRole` ou `requireFreshRole`.
- **Uma migração por vez:** 0083 é desta PR. A próxima é 0084.

## 5. Follow-ups (registrados no ADR-0051, "Fora do escopo")

- Conta desativada não aparece com o botão (409 `conta_inativa`). Encerrar uma delas é por script.
- Não há suspensão durante a espera do P1 (7 dias) e do P3 (15 dias ou análise).
- O P2 (o responsável pede a exclusão da conta de alguém de 16 ou 17) é por script, com `eraseOwnAccount(db, { userId })`.
- "Pedir nova análise" depois da eliminação só rende explicação. Não há como desfazer.

## 6. Critério de saída

- [x] Admin encerra conta de menor de 16 (público e privado saem) e por violação (público fica anonimizado, e-mail opcional).
- [x] Recusas: própria conta, admin, inexistente, inativa, @ errado, público na violação.
- [x] Registro de 5 anos sem dado pessoal; Política v3.4, ROPA op. 18, parecer, ADRs e `CONTEXT.md` alinhados.
- [x] Painel de revisão limpo; `checks` e `e2e` verdes.

## 7. Gotchas de ambiente

- Vitest `node` precisa de Postgres 17 + pgvector (`TEST_DATABASE_URL` inline, nunca exportado).
- `test/ui/create-drawer-lazy.test.tsx` "o foco pelo teclado pré-carrega" é flaky sob carga (o `waitFor` usa o timeout padrão de 1 s). Uma nova rodada passa.
- Preview da Vercel em PR com migração pode falhar se o build rodar antes do branch do Neon existir. Nesta leva, 0081 e 0082 não falharam.
