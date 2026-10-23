# Handoff 87 — Sair da conta recarrega a página (Console aberto depois do logout)

**Data:** 2026-10-23.
**PR:** "Sair da conta recarrega a página: Console e telas pessoais não ficam abertos depois do logout".
**Base:** `main` depois do #622.
**Migração:** nenhuma.
**ADR:** ADR-0028, "Adendo (2026-10-23) — Perder a sessão recarrega a página".

## 1. Escopo

O Fernando saiu da conta com o Console aberto em `/admin/users`. O header passou a mostrar "Entrar", mas a lista de Usuários continuou na tela e as gavetas de detalhes abriam. Só o clique em outra seção da barra lateral levou ao login.

**Diagnóstico:** era estado do cliente, não vazamento no servidor.

- As gavetas mostram a linha da lista que já tinha sido buscada antes de sair. Elas não fazem pedido novo.
- Todas as rotas `/api/admin/*` e `/api/curate/*` chamam `requireRole` e respondem 401 sem sessão. Conferido em produção em 2026-10-23: `GET /api/admin/users`, `/api/admin/config`, `/api/admin/ai-cost`, `/api/admin/users/search`, `/api/curate/reports` e `PUT /api/admin/roles` sem cookie ⇒ `401 {"error":"nao_autenticado"}`.
- `GET /pt-BR/admin/users` sem cookie responde 200 por causa do streaming do `loading.tsx` do grupo `(com-carregamento)`, mas o corpo é só o redirect para `/sign-in` (`NEXT_REDIRECT` + meta refresh), sem dado nenhum.
- O "Sair" do `AuthSlot` só refazia o `get-session`. O gate do Console roda no servidor, a cada navegação, então a página já carregada ficava.

**Entrega:**

1. `src/components/session-loss-guard.tsx`, montado uma vez em `src/app/[locale]/layout.tsx`. Quando a sessão some (logada → anônima) ou troca de conta, recarrega a página. Quando o papel muda na mesma conta, faz `router.refresh()`.
2. Quem navega sozinho segura a recarga com `holdSessionLossReload()`: a exclusão de conta (`delete-account-dialog.tsx`, durante o pedido, porque vai para a home do idioma) e o login/cadastro (`auth/auth-form.tsx`, do envio até sair da tela, para entrar como outra conta estando logado). Se a sessão sumiu ou trocou durante o hold, soltar o último recarrega.
3. `test/unit/admin-api-guard.test.ts`: reprova handler de `/api/admin` ou `/api/curate` sem `requireRole` com o papel certo, chamado antes de banco ou corpo.
4. E2E: `conta-e-navegacao` ganhou "sair recarrega esta aba e as outras abertas".
5. Comentário de `src/app/api/admin/prompt-compare/route.ts` corrigido: dizia que o `requireRole` era fail-open, mas ele é fail-closed desde o #51.

Sem issue no GitHub: veio de um relato direto do Fernando no projeto.

## 2. O que ler primeiro

1. O doc do topo de `src/components/session-loss-guard.tsx`.
2. O Adendo 2026-10-23 do ADR-0028.
3. `test/ui/session-loss-guard.test.tsx`: a matriz (perda, 401, erro de rede, carregando, troca de conta, entrar, papel, hold).
4. `test/ui/account-data-section.test.tsx` e `test/ui/auth-form-session-switch.test.tsx`: o guard é montado junto. A saída da exclusão confere que houve UMA navegação só; o login como outra conta não recarrega a tela de login e recarrega o destino ao desmontar.

## 3. Princípios inegociáveis

- **O servidor é a defesa.** O guard só limpa a tela. Toda rota que devolve dado do Console continua com `requireRole`, e o teste estático reprova a que não tiver.
- **Erro de rede não é logout.** Sessão ausente é o `get-session` respondendo 200 `null` (ou 401). `isPending` e erro de rede ou com outro status (5xx, 429) não disparam nada, mesmo quando o atom zera o `data` (o refetch do Better Auth ao voltar online zera).
- **Entrar não recarrega.** Quem entra já navega pela tela de login.
- **Fluxo que derruba ou troca a sessão e navega sozinho segura o guard** (`holdSessionLossReload()`), desde antes do pedido, e solta (`release()`) se desistir de navegar. Hold que nunca é solto desliga o guard até a próxima recarga: solte em todo caminho que não navega.

## 4. Landmines

- **Exceção à decisão 5 do ADR-0028.** Recarga sem pedido acontece nas outras abas e na sessão expirada, inclusive em páginas públicas. O Adendo registra por quê.
- **Toda aba recarrega quando a pessoa sai em qualquer uma.** O Better Auth avisa as outras abas pelo evento `storage` (chave `better-auth.message`), elas refazem o `get-session` e o guard recarrega. É o comportamento desejado, mas um rascunho não salvo em outra aba se perde. O "Criar" persiste a conversa no servidor, e sem sessão nenhuma escrita funcionaria mesmo.
- **E2E depois de "Sair":** a página recarrega. Use `markPage` antes e `waitForReload` depois (`e2e/fixtures/test.ts`) antes do próximo `goto`, senão o `goto` corre junto com a recarga.
- **Novo fluxo que chama `signOut` e depois navega** (ex.: um "sair de todos os aparelhos" que leve para uma página própria): sem `holdSessionLossReload()`, a recarga disputa com a navegação dele.
- **`router.refresh()` na troca de papel** reavalia os gates do servidor. Um admin rebaixado em `/admin/ia` passa a ver `AccessDenied`. Promoção não muda a tela atual além de re-renderizar os Server Components.

## 5. Follow-ups

Nenhum obrigatório. Se um dia o Console precisar sair na hora quando um admin for rebaixado por outra pessoa, sem esperar a volta à aba ou a navegação, isso pede polling ou push, fora do ADR-0028.

## 6. Critério de saída

- [x] Sair com o Console aberto leva ao login (recarga + gate do servidor).
- [x] Outra aba aberta também recarrega.
- [x] APIs admin e curadoria conferidas: 401 sem sessão em produção, e teste estático para rota nova.
- [x] Exclusão de conta segue indo para a home com o aviso.

## 7. Gotchas de ambiente

- O projeto Vitest `node` precisa de Postgres 17 + pgvector (Testcontainers ou `TEST_DATABASE_URL` inline). Com Postgres 16 a migração de `recipe_web_imported_private_chk` falha ("unsafe use of new value"), e o mesmo vale para o harness do E2E.
- `test/unit/admin-api-guard.test.ts` não usa banco, mas roda no projeto `node`, que sobe o `globalSetup` do banco.
