# ADR-0014 — Autenticação (Better Auth), soft-delete e reconciliação uuid-id

Status: aceito

> **Nota (#470, 2026-09-25):** a **verificação de e-mail** saiu do diferido (D3) para fechar a **enumeração de contas no cadastro** (`/sign-up/email` respondia 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` só quando o e-mail já tinha conta). `requireEmailVerification: true` liga a resposta genérica do Better Auth: e-mail existente responde **200 igual a um novo**, sem cookie, sem criar/alterar nada e sem e-mail. O corpo do cadastro é reduzido a `{ token: null, user: { id, name, email, emailVerified, image, createdAt, updatedAt } }` (hook `after`) e o id sintético é uuid (`customSyntheticUser`) — sem isso o usuário sintético se denunciava pela forma (sem `handle`, `role`/`plan` null, id base62). O cadastro **não loga mais**: o link (JWT de 24h, pelo mesmo `sendAccountEmail`/Brevo do reset, idioma `users.locale` → cookie `locale` → Accept-Language) confirma e **já loga** (`autoSignInAfterVerification`), voltando pela tela `/{locale}/verify-email` (link inválido ⇒ reenvio). Login de conta não confirmada = 403 `EMAIL_NOT_VERIFIED` + reenvio automático (`sendOnSignIn`, só com a senha certa); reenvio público neutro (3/min por IP) e **no máx. 3 e-mails de confirmação por conta a cada 15 min**; conta soft-deletada não recebe. A migração **0067** marca como confirmadas **todas as contas anteriores** (nunca tiveram como confirmar; senão ficariam trancadas) — consequência consciente: para elas passa a valer o vínculo implícito Google↔conta de mesmo e-mail (o Better Auth exige e-mail local confirmado). **Gate de deploy:** sem `BREVO_API_KEY` + remetente (`AUTH_MAIL_FROM`/`DSAR_MAIL_FROM`), contas novas de email+senha não conseguem entrar. Resíduo aceito: o caminho de conta nova faz alguns INSERTs a mais que o de conta existente (diferença de tempo pequena frente ao hash da senha, que os dois fazem; rate limit de 5/min por IP no cadastro).

> **Nota (#469, 2026-09-24):** o **password-reset** saiu do diferido (D3): `sendResetPassword` do Better Auth manda o link pelo mailer Brevo (`sendAccountEmail`, remetente `AUTH_MAIL_FROM` → fallback `DSAR_MAIL_FROM`), token de 1h e uso único, **sessões abertas revogadas** no reset, conta soft-deletada **não** recebe e-mail, no máx. 3 e-mails de reset por conta a cada 15 min. Verificação de e-mail segue diferida.

> **Nota (ADR-0027/0028, 2026-06-30):** o RBAC permanece **3-tier** por decisão consciente — `usuario ⊂ curador ⊂ admin` via `ROLE_RANK`, com `requireRole` hierárquico (o Admin já herda tudo do Curador). A iniciativa de avaliações/notificações exercitou a fronteira Curador/Admin (moderação de avaliação, eventos de restrição) **sem** novo papel — as rotas gateiam `requireRole('curador')` e o Admin herda. Um **`superadmin`** (separação de poderes pra gestão de papéis/config) foi **considerado e deferido**; gatilho pra revisitar = entrar um 2º admin.

A autenticação usa **Better Auth** com adapter Drizzle, route handlers (`toNextJsHandler`) e Node runtime — **sem `nextCookies`, sem Server Actions** (ADR-0010). A identidade do Usuário (ADR-0011) é **domínio** e congela FK; o provider de auth é **stack reversível** (ADR-0010/0011). Este ADR fixa o que não é reversível — o **id uuid estável** de Usuário e a política de **soft-delete** — e registra as dívidas conscientes.

## Escolha e versão

**Better Auth**, framework-agnostic, com plugin `admin` que cobre papéis e gestão de usuário, peer-compatível com a stack (Next 16, `drizzle-orm` ^0.45.2, `drizzle-kit` >=0.31.4). Email+senha sempre ligado; Google OAuth dormente sem credenciais (liga ao preencher `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`).

**Versão fixada: `better-auth@1.6.16`** — a estável mais nova **instalável neste ambiente** (o registry tem um corte antes de 2026-06-11). A `1.6.18` (2026-06-12) é **equivalente em API** (mesma superfície de adapter Drizzle, plugin `admin`, `testUtils`, `generateId`) e pode ser bumpada em produção quando disponível. Alinha com a política "última estável disponível" (ADR-0010): pinar a mais nova que de fato instala, não uma defasada. Os dois CVEs de 2026 (plugin `apiKey`; plugin `oauth-provider`) estão em plugins que **não** usamos — a superfície email+senha+sessão+papéis+social é segura. `testUtils` entra só em teste.

## Opções consideradas

- **Better Auth (escolhida).** Agnóstico de framework, plugin `admin` pronto para papéis, sem dependência de Server Actions (ADR-0010), peer-compat com a stack.
- **Sessão própria caseira (rejeitada).** Muito código de segurança (hashing, rotação de sessão, CSRF, reset) a escrever e manter; sem ganho de domínio.
- **NextAuth / Auth.js (rejeitada).** Desaconselhado pelo próprio mantenedor para greenfield; acoplamento mais forte a Server Actions, que evitamos (ADR-0010).
- **Lucia (rejeitada).** Descontinuada.

## Identidade única (ADR-0011/0001)

Uma única tabela **`users`** carrega a identidade do Usuário:

- Nome **plural** — **exceção justificada** à convenção singular do repo (todas as outras tabelas são singular). Evita colisão com a palavra reservada `user` do Postgres e casa com o default do Better Auth.
- `role` — pgEnum `role` com valores `usuario` / `curador` / `admin`. **Não** existe `visitante`: Visitante = ausência de sessão/conta (ADR-0011), nunca um valor persistido. O pgEnum dá integridade no banco.
- `locale` — `text` nullable; só apresentação (ADR-0001, D1); a coluna é a mesma que `/api/me/locale` lê e grava (#4.AC5 == #5.AC4).
- `deletedAt` — soft-delete (ver abaixo).
- `banned` / `banReason` / `banExpires` — colunas **exigidas pelo plugin admin** (o adapter as lê/escreve). São **inertes** aqui (default `false`/null); a **aplicação** de ban/shadow-ban é ADR-0007, **deferida** — nada lê esses campos para gating agora.

As tabelas `session` / `account` / `verification` são **infra da lib** (não domínio).

**Papéis.** O plugin `admin` é configurado com `createAccessControl` e papéis customizados; promover/rebaixar usa `setRole` (handler `/api/admin/roles`, admin-only). O gating dos handlers usa **rank de papel** (`ROLE_RANK`: usuario < curador < admin), simples e suficiente; o access-control fino (`ac`/`roles`) fica registrado para uso futuro. `defaultRole: 'usuario'` é **obrigatório**: o default `'user'` do plugin não existe no pgEnum e estouraria o INSERT.

## Reconciliação uuid-id

`recipe.owner_id` é **uuid** (#3) → `users.id` **tem** que ser uuid para a FK casar. Better Auth gera ids string por default; reconciliamos com **`advanced.database.generateId: false`** + `uuid().defaultRandom()` em **todas** as PKs do Better Auth (users/session/account/verification): com `generateId:false` o adapter pg **não envia** id e o **Postgres gera** (via `gen_random_uuid()`). Os FKs `userId` das tabelas de infra são uuid coerentes.

FK **`recipe.owner_id → users.id` `ON DELETE restrict`**, com `owner_id` **NULLABLE preservado** (NULL = catálogo/sistema, ADR-0011, inegociável). RESTRICT é rede de segurança: nunca dispara, pois não há hard-delete.

## Soft-delete (LGPD)

**Nunca** hard-delete de Usuário — preserva a integridade de `recipe.owner_id` e a autoria do pool da comunidade. Apenas a coluna **`deletedAt`** entra agora; a política de **máscara de email/nome**, **revogação de sessão** e o **endpoint de desativação de conta** ficam **deferidos** para a fatia de gestão de conta. O gating barra `deletedAt != null` com **401 (`conta_desativada`)**. Pré-condição: `session.cookieCache` fica **DESLIGADO** — com cache, a sessão não refletiria o `UPDATE ... deleted_at` e o gating ficaria stale; a re-leitura viva da linha é o que torna o soft-delete observável.

## Contrato de gating

- **401** — sem sessão (Visitante, ADR-0011) **ou** conta desativada (`deletedAt != null`).
- **403** — autenticado, mas com papel insuficiente.
- Corpo de erro `{ error }` claro e **fail-closed** (papel desconhecido não passa).

## Por quê

Uma tabela `users` única (em vez de provider próprio + tabela de perfil) mantém a identidade do Usuário como domínio enquanto o provider permanece reversível. O uuid-id não é cosmético: ele **congela** a FK de `recipe.owner_id` e, por isso, é o único ponto irreversível desta fatia — daí ser fixado aqui. Soft-delete em vez de hard-delete é exigência de integridade (autoria do pool) e de LGPD; entrar só com a coluna evita comprometer prematuramente o desenho do endpoint de desativação.

## Consequências

- **Custo de queries consciente** (cookieCache DESLIGADO): ~2 queries por request gated (sessão + leitura viva da linha) e ~4 no caminho de papéis. Trade aceito em troca de gating de `deletedAt`/papel sempre fresco.
- **Índices `session.user_id` / `account.user_id` deferidos** — entram junto com o endpoint de revogação/soft-delete (sem volume que justifique agora).
- **`CREATE EXTENSION vector`** no provisionamento Neon segue **herdado do ADR-0001/0008** — nada novo aqui.
- **Segurança deferida (D3)**: verificação de e-mail, password-reset e rate-limit de login não entram nesta fatia (sem infra de e-mail).
- **Atribuição editorial do catálogo** (Autoria vs Owner, ADR-0011) fica **deferida** (D6); `owner_id=NULL` já distingue catálogo de conteúdo de usuário.
- **`app_config` como singleton** (bool PK `id=true` + CHECK) persiste o "modelo default" (#5.AC2) sem acoplar à geração (#8); reversível.
- **Handler-sentinela `/api/curate`** (`requireRole 'curador'`) existe só para testar o degrau Usuário→Curador honestamente, sem inventar telas de catálogo.
- **Dívida conhecida — `<html lang>`**: o server emite `pt-BR` fixo; a chrome client é a que troca de idioma (satisfaz #4.AC1/AC3). Incremento reversível: ler o cookie `locale` no layout server e emitir `<html lang>` dinâmico.

## Reversibilidade

O **provider de auth** é stack reversível (ADR-0010/0011): trocar de lib não toca o domínio. O que **congela** é o **id uuid estável** de Usuário (a FK de `recipe.owner_id`). Tudo o mais aqui — gating por rank, singleton de config, colunas inertes de ban, deferimentos de segurança — é reversível e fica registrado para não ser re-litigado.
