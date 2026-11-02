# Auditoria de segurança — refogando (SAST) — 2026-11-01

Branch: `security/audit-2026-11-01`. Modo: **SAST apenas** (argumento `sast only`). Primeira auditoria: não há
relatório anterior para comparar.

## Perfil (recon)

- **Tipo:** `web`. Next.js 16 App Router na Vercel (região `gru1`), 137 route handlers em `src/app/api/**`,
  **nenhuma** server action (`'use server'` não aparece em `src/`), `src/proxy.ts` só negocia locale.
- **Linguagem / pacotes:** TypeScript, npm + `package-lock.json` (901 pacotes, todos de `registry.npmjs.org` com
  `integrity`).
- **Dados e serviços:** Neon Postgres (drizzle-orm + postgres.js, pgvector), Vercel Blob (imagens/avatares),
  better-auth (email+senha e Google; plugin `admin`), Anthropic (receitas, conversa, tradução), Gemini
  (imagens e embeddings), Brave Search (descoberta web), Resend (email), sharp (re-encode de uploads).
- **Fronteiras de confiança:** HTTP (route handlers, `/api/auth/*`), páginas importadas da web (import por URL,
  com allowlist e pinning de DNS), saída do LLM (estruturada por zod, renderizada como texto), uploads de imagem
  (avatar, foto da avaliação, imagem da receita), links de email, crons da Vercel (`CRON_SECRET`).
- **Autorização:** `requireSession` / `requireRole` / `requireFresh*` (`src/server/auth/guard.ts`), sessão relida do
  banco a cada request (cookie cache desligado), papéis `usuario` / `curador` / `admin`. Dono checado na leitura e
  de novo no `WHERE` das escritas.
- **Segredos:** env vars da Vercel, só server-side (não existe `NEXT_PUBLIC_*`). Local: `.env.local` (não
  versionado, nunca esteve no histórico).

### O que NÃO foi testado, e por quê

- **DAST inteiro (seção 3 da skill):** fora do escopo pedido (`sast only`). Nada rodou contra Preview, produção
  ou localhost; nenhum usuário de teste foi criado; nenhum script de autorização usuário-B-contra-usuário-A rodou
  contra a app no ar. A cobertura de autorização vem da revisão manual de todas as rotas e dos testes de
  integração que já existem.
- **Preflight da Vercel/Neon** (comparar envs de Production e Preview): só é exigido antes de varredura ativa,
  então não rodou. Por isso **M-7** fica como PLAUSÍVEL: o código e os ADRs indicam que o Preview usa cópia dos
  dados reais e chaves de verdade, mas os valores não foram conferidos.
- **Headers/TLS/cookies em resposta real:** só revisados na config (`next.config.ts`, defaults da better-auth).

### Ferramentas (saídas brutas em `.security-audit/raw/`, fora do git)

| Ferramenta | Versão | Resultado |
|---|---|---|
| semgrep (`p/default`, `p/owasp-top-ten`, `p/secrets`, `p/nextjs`, `p/typescript`, `p/react`) | 1.183.0 | 10 achados (7 tags mutáveis de Action, 3 falsos positivos), 1 timeout de regra em `src/db/schema.ts` |
| CodeQL `javascript-security-extended` | 2.27.3 | 15 achados, todos falsos positivos (13 em `test/` ou `scripts/`) |
| gitleaks (histórico inteiro) | 8.30.1 | 9 achados, todos fixtures de teste |
| trufflehog `--only-verified` | 3.99.7 | 0 |
| osv-scanner / npm audit | 2.7.0 / npm 11 | ver H-1, H-2, L-1, L-2, L-15 |
| trivy fs (vuln, secret, misconfig) | 0.76.1 | só o JWT do `.env.local` (não versionado) e lockfiles de `.claude/worktrees/` (ruído) |

Todos os binários foram baixados das releases oficiais com o SHA-256 conferido.

## Resumo

| Severidade | Total | Corrigidos neste PR | Abertos |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 3 | 2 (+1 parcial) | 1 parcial (H-3: falta a ação manual) |
| Medium | 9 | 0 | 9 |
| Low | 15 | 3 | 12 |
| Info | 7 | 0 | 7 |

O npm audit marca a `next` e a `better-auth` como **critical**. A severidade aqui é a que vale para **este** app:
cada advisory foi checado contra o uso real (ver H-1 e L-1).

## Achados

### High

#### H-1 — Next.js 16.2.9 com advisories de RCE e SSRF no Image Optimizer · CORRIGIDO
- **Severidade:** High, 8.1 `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H`
- **CWE / OWASP:** CWE-1395 (dependência vulnerável) · A06:2021 Componentes vulneráveis e desatualizados
- **Local:** `package.json` (`next@16.2.9`); superfície em `next.config.ts:67-72` (`images.remotePatterns`), que mantém
  `/_next/image` ativo.
- **Evidência:**
  - Advisories de RCE no Image Optimizer: GHSA-2464-fhr4-w9xw (SVG) e GHSA-2xp9-vwfh-vxw4 (AVIF).
  - SSRF no Image Optimizer: GHSA-cjq9-62q9-8jv4.
  - Envenenamento de cache SSG/ISR: GHSA-mcj8-r9mp-w47p e GHSA-4jqv-mc3x-m676.
  - DoS no parser de Server Actions: GHSA-m99w-x7hq-7vfj e GHSA-p3m5-59mp-jv5r.
  - Todos são corrigidos a partir de 16.4.1.
  - Não alcançáveis aqui: `use cache` (só aparece num comentário), `next/og`, rewrites, host Windows e o bypass de
    single-locale (o app tem 2 locales).
- **Exploração:** o otimizador aceita qualquer URL `https://*.public.blob.vercel-storage.com`, inclusive de **outros**
  stores do Blob. Um atacante hospeda um AVIF ou SVG malicioso no próprio store e chama
  `/_next/image?url=<arquivo>&w=64&q=75` sem autenticação. A complexidade é alta porque depende do exploit
  publicado para cada formato.
- **Correção:** `next` e `eslint-config-next` 16.2.9 → **16.4.2** (publicado em 2026-10-15; a 16.4.3 tem menos de
  14 dias). Ajuste extra recomendado: remover `images.remotePatterns`, já que o app não usa `next/image`.

#### H-2 — sharp 0.34.5 decodifica uploads com libvips/libheif/librsvg vulneráveis · CORRIGIDO
- **Severidade:** High, 7.5 `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:H`
- **CWE / OWASP:** CWE-1395 / CWE-787 · A06:2021
- **Local:**
  - `src/server/images/user-photo.ts:66-68` (avatar e foto da avaliação)
  - `src/server/images/image-derivatives.ts:105-110`
  - `src/server/images/blob-sweep.ts:189`
- **Evidência:** GHSA-f88m-g3jw-g9cj (libvips: CVE-2026-33327, -33328, -35590 e -35591), GHSA-rgj7-g3m4-5g8c
  (libheif) e GHSA-wq5f-xc86-pv6w (librsvg). O sharp chama `.metadata()` sobre os bytes enviados **antes** da
  allowlist de formato, então o decoder roda com entrada do usuário. O limite de 24 MP e o re-encode para WebP não
  protegem o parser.
- **Exploração:** um usuário logado envia um HEIF ou SVG forjado (até 2 MB) como avatar ou foto de avaliação. O bug
  de memória no decoder roda dentro da função da Vercel, que tem acesso às env vars de produção.
- **Correção:**
  - sharp → **0.35.5**.
  - Os tipos mudaram para ESM, o que exigiu ajustar `import sharp, { type Metadata }` em `image-derivatives.ts` e
    `blob-sweep.ts`.
  - Recomendação extra: checar os magic bytes (JPEG/PNG/WebP) antes de chamar o sharp.

#### H-3 — `.env.local` aponta dev e teste para o banco de PRODUÇÃO com o papel dono · PARCIAL
- **Severidade:** High, 8.2 `CVSS:3.1/AV:L/AC:L/PR:L/UI:R/S:C/C:H/I:H/A:H`
- **CWE / OWASP:** CWE-1188 (default inseguro) / CWE-250 · A05:2021 Configuração incorreta
- **Local:** `.env.local`, arquivo não versionado. `TEST_DATABASE_URL`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED` e
  `POSTGRES_URL*` usam todas `neondb_owner@ep-gentle-morning-…`. Também afeta `drizzle.config.ts:10-14` e
  `test/global-setup.ts:20-35`.
- **Evidência:** os hosts foram conferidos sem imprimir as senhas. Os scripts `npm run grant-role`, `backfill-*`,
  `seed-catalog` e `images-catalog` (todos com `--env-file=.env.local`), o `next dev` e o `drizzle-kit` usam
  produção com permissão de DDL.
- **Exploração:** basta um `source .env.local`, um agente que herde o ambiente (o incidente de 2026-09-09) ou um
  `npm test` com a variável exportada. A suíte faz `CREATE DATABASE` e varre os `refogando_test_*` **no servidor de
  produção**, e um `drizzle-kit push` ou um script de seed vai direto em produção.
- **Correção:**
  - **Feita neste PR:** `test/helpers/production-db-guard.ts`, chamado no começo de `test/global-setup.ts`.
    - Recusa `TEST_DATABASE_URL` ou `TEST_DATABASE_URL_UNPOOLED` que apontem para o host de produção, ou para o
      mesmo host do banco da app, **antes** de conectar.
    - Teste de regressão em `test/unit/production-db-guard.test.ts`.
    - Conferido também de ponta a ponta: com `TEST_DATABASE_URL` no host de produção, a suíte aborta com a
      mensagem da trava.
  - **Falta (ação manual sua):**
    1. Remover `TEST_DATABASE_URL` do `.env.local`, já que o harness sobe um Postgres via Testcontainers.
    2. Apontar `DATABASE_URL*` locais para uma branch `dev` do Neon com papel sem DDL.
    3. Tirar `NEON_API_KEY` e `VERCEL_TOKEN` do `.env.local` (ver M-8).
  - O mesmo tipo de trava cabe nos scripts de `scripts/`.

### Medium

#### M-1 — Conversa em stream: chamada paga ao Claude sem cobrança de quota se o cliente desconecta · ABERTO
- **Severidade:** Medium, 4.3 `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L` · CWE-770 / CWE-799 · A04:2021 Design inseguro
- **Local:** `src/app/api/conversations/stream/route.ts:242-305`.
- **Exploração:**
  - O pré-check de quota é só leitura.
  - `streamConversation` é pago por inteiro, e a quota só é cobrada na destilação (`persistGeneration`).
  - O cliente que lê os tokens e aborta antes do frame terminal (`if (signal.aborted) return`, linha 305) nunca é
    cobrado.
  - Na prática, isso vira um proxy do Claude sem limite para qualquer conta gratuita. O desfecho
    `geracao_invalida` também queima duas chamadas sem cobrança.
- **Correção:** reservar o slot de forma atômica antes da 1ª chamada, como já fazem `reserveExtractionSlot` e
  `reserveMenuSuggestionSlot`. Também cabe um limite de turnos por usuário/hora nesta rota.

#### M-2 — Quota de geração (receita e imagem) checada antes, cobrada depois da chamada paga (TOCTOU) · ABERTO
- **Severidade:** Medium, 4.3 `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L` · CWE-367 / CWE-770 · A04:2021
- **Local:**
  - `src/app/api/generations/route.ts`: pré-check em ~364, Claude em ~410/~530, gate atômico em ~462 e em
    `persist.ts:245`.
  - `src/server/recipe/image.ts`: peek em ~233, Gemini em ~396, gate em ~422.
- **Exploração:** com a quota em N-1, M requisições paralelas passam todas pelo pré-check e todas pagam o
  provedor. Só uma persiste. A quota se mantém, mas o custo é multiplicado por M.
- **Correção:** a mesma do M-1 (reservar antes, liberar na falha) e, se quiser, um limite de 1 requisição em voo
  por usuário.

#### M-3 — Tradução de receita sem quota e repetida a cada falha · ABERTO
- **Severidade:** Medium, 4.3 `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L` · CWE-770 / CWE-400 · A04:2021
- **Local:** `src/app/api/recipes/[id]/translations/[locale]/route.ts:74`, `src/server/recipe/translation.ts:45-69`.
- **Exploração:** qualquer usuário logado dispara a tradução de qualquer receita pública. Uma tradução que falha
  (estoura `max_tokens` ou reprova na checagem de fidelidade) não grava nada, então cada POST chama o LLM de novo,
  e o texto de entrada não tem limite de tamanho (L-7).
- **Correção:** quota ou cooldown por usuário e por receita, cache negativo de falha, single-flight por
  (receita, locale) e limite de tamanho da entrada.

#### M-4 — Busca anônima chama o embedding pago do Gemini sem limite · ABERTO
- **Severidade:** Medium, 5.3 `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` · CWE-770 · A04:2021
- **Local:** `src/app/api/search/route.ts:183-192,211`.
- **Exploração:** `GET /api/search?q=<aleatório>` em loop, sem login, sem limitador e sem cache. A chave
  `GEMINI_API_KEY` é compartilhada com a geração de imagens, que passa a devolver 429 para todos.
- **Correção:** limitador por IP persistido no banco (o padrão da tabela de rate limit da better-auth), cache dos
  vetores de busca, ou só embedding para quem está logado.

#### M-5 — A app roda como dono do banco (sem menor privilégio) · ABERTO
- **Severidade:** Medium, 5.9 `CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:H/I:H/A:N` · CWE-250 / CWE-269 · A05:2021
- **Local:** `vercel.json:5` (o build roda `db:migrate`), `drizzle.config.ts:10`, `src/server/deps.ts:77`. A
  integração Neon/Vercel entrega `neondb_owner`.
- **Risco:** uma injeção de SQL futura, ou uma dependência comprometida, ganha `DROP SCHEMA`/`TRUNCATE` sobre todos
  os dados pessoais. O plano free não tem PITR além de 6 h.
- **Correção:**
  - Criar um papel `app_rw`, só com DML em `public`, para o `DATABASE_URL` de runtime.
  - Usar o URL de dono só no passo de migrate, numa variável `MIGRATION_DATABASE_URL`.

#### M-6 — A exigência de confirmar email desliga sozinha se o mailer não estiver configurado · ABERTO
- **Severidade:** Medium, 4.8 `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:L` · CWE-636 (fail-open) · A07:2021
- **Local:** `src/lib/auth.ts:209,304,493,597` e `src/server/mail/mailer.ts:71-72`.
- **Risco:** se `RESEND_API_KEY` ou o remetente sumirem ou forem renomeados em Production, três coisas voltam sem
  aviso:
  - a enumeração de contas (422 para email existente);
  - cadastro e login com email não provado (dá para ocupar o email de outra pessoa);
  - e não existe mais reset de senha.
- **Correção:** com `VERCEL_ENV === 'production'`, lançar no boot se o mailer não puder enviar email de conta, como já
  é feito com `BETTER_AUTH_SECRET`. Antes de ligar essa trava, confirme que Production tem as duas variáveis, senão
  o deploy cai.

#### M-7 — Preview recebe cópia dos dados reais e, ao que tudo indica, o token de produção do Blob · ABERTO (PLAUSÍVEL)
- **Severidade:** Medium, 6.8 `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:N` · CWE-668 / CWE-200 · A05:2021
- **Evidência:**
  - ADR-0047:40 diz que o Preview usa uma branch do Neon criada de `main` "e as chaves de verdade".
  - `src/app/api/cron/blob-sweep/route.ts:12-14` admite que dev e Preview podem ter o token de produção do Blob.
  - A checagem `owns()` de `image-store.ts` só olha o host.
- **Risco:**
  - Código de PR ainda não revisado roda contra a cópia de todos os usuários, com as chaves reais de IA e email.
  - Um fluxo de exclusão exercitado no Preview (eliminação de conta, troca de imagem) apaga blobs **de produção**.
  - Branches sem PR nunca são limpas, então dados eliminados podem sobreviver além do prazo que a política promete.
- **Correção:**
  - Dar ao Preview um store e um token próprios do Blob, e chaves de IA e email de teste ou com cota baixa.
  - Criar a branch do Preview a partir de um pai só com schema, ou anonimizado.
  - Limpar as branches órfãs.
  - Este é também o bloqueio para qualquer DAST **ativo** contra o Preview (ver `.security-audit/config.md`).

#### M-8 — Backups no mesmo projeto Neon da produção · ABERTO
- **Severidade:** Medium, 4.4 `CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:N/A:H` · CWE-693 · A05:2021
- **Local:** `.github/workflows/db-backup.yml`: branches `backup/*` dentro do mesmo projeto. O `NEON_API_KEY` está
  nos secrets do Actions e também no `.env.local`.
- **Risco:** apagar o projeto, vazar a chave (que apaga branches) ou ter um problema na conta leva a produção e todos
  os backups juntos.
- **Correção:** `pg_dump` semanal, criptografado, para um storage fora do Neon (o doc do incidente já recomenda), e
  tirar as chaves de API do `.env.local`.

#### M-9 — Formulário público de notificação de retirada pode inundar o banco e a caixa do encarregado · ABERTO
- **Severidade:** Medium, 5.3 `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` · CWE-770 · A04:2021
- **Local:** `src/app/api/legal/takedown/route.ts:14-34`, `src/server/legal/takedown-intake.ts:49-70`.
- **Exploração:**
  - Não há login nem captcha, e o limite de 1 req/s por IP fica em memória, por instância.
  - Cada POST grava um ticket e uma linha de auditoria e manda um email ao encarregado.
  - Isso consome a cota do Resend, a mesma dos emails de cadastro e reset de senha.
- **Correção:** limitador persistido no banco ou regra no Vercel Firewall, captcha (Turnstile) e um resumo periódico
  por email em vez de um email por ticket.

### Low

| ID | Achado | CVSS | CWE | Local | Status |
|---|---|---|---|---|---|
| L-1 | Advisories da better-auth 1.6.16: GHSA-965c (critical), -r4xp, -q84f e -qq9h. **Não alcançáveis**: exigem os plugins magic-link, email-OTP, oauth-proxy ou deviceAuthorization, e o app só usa `admin`. Ficou na 1.6.16 de propósito: a 1.6.17+ introduz GHSA-44jh (rate limit do Postgres furável com requisições concorrentes), que **afeta** este app, e a 1.7.x exige a coluna `session.impersonatedBy` (migração em produção, e liga a personificação do L-13). | 3.1 `AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L` | CWE-1395 | `package.json` | Aberto, aceito. Fazer issue para a 1.7.x com migração e bloqueio da personificação. |
| L-2 | zod 4.4.3 (GHSA-mrhx, memória esgotada com coleções grandes) e undici 6.27 dentro do `@vercel/blob` | 3.7 `AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L` | CWE-1395 | `package.json` | **Corrigido**: zod 4.6.6, `@vercel/blob` 2.8.1 e `overrides` para undici 6.29.1 e para o zod aninhado em `@vercel/cli-config` |
| L-3 | CSP só em Report-Only e sem `report-uri`, então ninguém vê as violações. É a única segunda linha de defesa contra XSS. | 3.7 `AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N` | CWE-693 | `next.config.ts:32-58` | Aberto: apontar `report-uri` para `/api/client-errors` e depois aplicar, com hash para o script do tema |
| L-4 | Actions fixadas por tag (inclusive a `neondatabase/delete-branch-action`, que segura o `NEON_API_KEY`) e workflow de limpeza sem bloco `permissions:` | 4.2 `AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N` | CWE-829 | `.github/workflows/ci.yml:59,61,91,93,107,128`, `cleanup-neon-preview-branch.yml:27` | **Corrigido**: SHAs fixados e `permissions: {}` |
| L-5 | Denúncia de avaliação sem dedup e sem limite diário (a de receita tem os dois desde o #605) | 4.3 `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N` | CWE-799 | `src/server/recipe/report.ts:~103-137` | Aberto |
| L-6 | Seguir e deixar de seguir em loop gera uma notificação `new_follower` nova a cada vez | 4.3 `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N` | CWE-799 | `src/server/user/follow.ts:79-97`, `src/server/notification.ts` | Aberto |
| L-7 | Campos de texto sem tamanho máximo: `name` em `PATCH /api/me` e `/update-user`; título, descrição, passos, notas e ingredientes em `PATCH /api/recipes/[id]` e em `derive` | 5.4 `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L` | CWE-1284 | `src/app/api/me/route.ts`, `src/app/api/recipes/[id]/route.ts` | Aberto |
| L-8 | Lacunas na blocklist anti-SSRF: 192.0.0.0/24, 198.18/15, multicast, 240/4, 6to4 2002::/16 e Teredo. Mitigado: o import só busca domínios da allowlist, e o probe é só para admin. | 3.7 `AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N` | CWE-918 | `src/server/import/probe-url.ts:16-29,76-108` | Aberto: trocar por "só unicast global" |
| L-9 | Descoberta web: o limite por IP é por instância, então uma conta sozinha esgota o orçamento mensal global do Brave | 3.1 `AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L` | CWE-770 | `src/app/api/discovery/web/route.ts:48-77` | Aberto |
| L-10 | O nome do cadastro vai no email de confirmação enviado a qualquer endereço, o que permite injetar texto. Mitigado: HTML escapado, 40 caracteres, 3 envios por 15 min. | 4.3 `AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N` | CWE-451 | `src/server/auth/account-email.ts:33-36` | Aberto: não usar o nome antes de o email ser confirmado |
| L-11 | `NODE_ENV==='test'` sozinho tira a exigência de secret, desliga o rate limit, liga `testUtils`, usa um HMAC fixo e libera a varredura de blobs. Não há trava (no build da Vercel, `NODE_ENV` vira `production`). | 1.9 `AV:L/AC:H/PR:H/UI:N/S:U/C:L/I:N/A:N` | CWE-489 | `src/lib/auth.ts:43,276,575`, `avatar-blob.ts:39` | Aberto: concentrar numa guarda como `e2eFakesActive` |
| L-12 | O tipo de conteúdo da imagem do Gemini é gravado como veio, sem re-encode. A checagem de mesma origem só existe em 3 rotas. Limites em memória em `/api/client-errors` e na rota de retirada. | 3.7 `AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N` | CWE-20 | `src/server/recipe/image.ts:406-410`, `same-origin.ts` | Aberto |
| L-13 | Os endpoints do plugin admin (`/api/auth/admin/impersonate-user`, `remove-user`, `set-user-password`, `update-user`) passam por cima das salvaguardas da app: sessão recente, pipeline de eliminação e auditoria. Exige papel admin. | 2.7 `AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:L` (impacto pleno dentro de PR:H) | CWE-863 | `src/lib/auth.ts:574-584` | Aberto: bloquear `/admin/*` num `hooks.before`, menos o que a app usa |
| L-14 | O log de erro padrão do Next pode levar PII (`DETAIL: Key (email)=(…)` do postgres-js) | 1.9 `AV:L/AC:H/PR:H/UI:N/S:U/C:L/I:N/A:N` | CWE-532 | `src/instrumentation.ts:38-48` | Aberto |
| L-15 | Advisories que restaram só em ferramentas de dev: vite 8.0.16, esbuild (via drizzle-kit), undici 7 (jsdom/testcontainers), source-map-js, brace-expansion e minimatch. A `vitest` foi para a 4.1.12. | 2.7 `AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:L` | CWE-1395 | `package-lock.json` | Aberto, aceito: só rodam em dev e CI, não vão para o bundle |

### Info

| ID | Achado | Local |
|---|---|---|
| I-1 | HSTS sem `preload` | `next.config.ts:57` |
| I-2 | Apagar uma receita derivada libera o slot da quota de derivação (só o embedding custa) | `src/server/quota/atomic.ts` |
| I-3 | O autor pode reescrever uma avaliação já moderada; a avaliação continua escondida, mas o texto que serve de evidência se perde | `src/server/recipe/review.ts:~186-205` |
| I-4 | Curador consegue aplicar ou tirar a restrição de geração de imagem de qualquer usuário, inclusive admins e ele mesmo | `src/server/curate/restriction.ts:33-74` |
| I-5 | A linha `.env*` acrescentada ao `.gitignore`, ainda fora de commit, anula o `!.env.example`: mudanças no `.env.example` somem do `git status`. Não entrou neste PR. | `.gitignore:62` |
| I-6 | Restrição de saúde marcada num pedido avulso vai para a IA sem registro de consentimento. Está documentado como escolha no parecer de 2026-10-22; fica a confirmação jurídica. | ADR-0041 §5 |
| I-7 | Não há Dependabot ou Renovate, nem `npm audit` no CI (o workflow `security.yml` deste PR cobre parte disso) | `.github/` |

## Achados de ferramenta rejeitados (falsos positivos)

| Ferramenta | Regra | Local | Motivo |
|---|---|---|---|
| semgrep | unsafe-formatstring (×3) | `src/server/claude/client.ts:219,237,252` | `method` é constante de código; o especificador só afeta o console |
| semgrep | timeout em unknown-value-with-script-tag | `src/db/schema.ts` | A regra estourou o tempo; não gerou achado. É um arquivo de definição de tabelas do Drizzle, sem renderização. |
| CodeQL | js/xss-through-dom | `src/components/meal-plan/meal-plan-recipe-picker.tsx:364` | `href` interno vindo de `createForMealSlotHref` (constante de i18n + dia e refeição tipados), num `Link` do React |
| CodeQL | js/xss-through-dom | `src/components/recipe/recipe-review-section.tsx:517` | `img src` é `URL.createObjectURL` ou a URL do Blob gravada pelo servidor; não é HTML |
| CodeQL | js/incomplete-sanitization (×2), js/file-system-race | `scripts/restore-overstrip.ts:376`, `scripts/seed-catalog.ts:205` | Scripts offline do operador, fora do alcance da app |
| CodeQL | js/regex/missing-regexp-anchor, js/incomplete-url-substring-sanitization, js/incomplete-sanitization (×10) | `test/**` | Asserções de teste, não guardas de runtime |
| gitleaks | generic-api-key / jwt (×9) | `test/ui/error-report.test.ts`, `test/integration/*.test.ts`, `e2e/harness/constants.ts` | Fixtures do teste de redação, senhas de teste e o secret descartável do harness E2E (só loopback). Fingerprints em `.gitleaksignore`. |
| trivy | jwt-token | `.env.local:42` | Arquivo local fora do git (`git log --all -- .env.local` vazio). A preocupação de verdade com esse arquivo é a H-3. |
| trivy / osv | vários | `.claude/worktrees/**` | Worktrees antigas de agentes, fora do git |

## Verificado e ok (cobertura)

- **Autorização:**
  - Todas as 137 rotas foram checadas, método por método.
  - Escritas de dono checam o dono na leitura **e** no `WHERE`.
  - Ids aninhados também são conferidos: um item de lista de compras é checado contra a lista **e** contra o
    usuário; coleções, cardápio e despensa são escopados por `userId`.
  - Rotas de curadoria ficam presas ao catálogo (`owner_id IS NULL`).
  - `admin/roles` impede trocar o próprio papel.
- **Crons:** as 7 rotas usam `isAuthorizedCron`, que falha fechado sem `CRON_SECRET` e compara digests SHA-256 com
  `timingSafeEqual`.
- **Modo fake do E2E:** falha fechado. Exige a flag igual a `'1'`, lança com qualquer marcador `VERCEL*` e exige
  banco e URLs em loopback. A guarda roda no build, no boot e em cada getter, e há uma guarda de fetch só para
  loopback.
- **SQL:** os `sql.raw` só recebem constantes de código. LIKE é escapado. Não existe `sql.unsafe`.
- **SSRF do import:** só http(s); DNS resolvido uma vez e IP fixado no Agent do undici; até 3 redirects, cada um
  revalidado; 5 s; 2 MB.
- **Uploads:**
  - Allowlist de MIME e limite de 2 MB.
  - Re-encode para WebP com `limitInputPixels`, que remove o EXIF.
  - Caminho do Blob gerado pelo servidor, com `allowOverwrite: false`.
  - `users.image` bloqueado para escrita pelo cliente.
- **XSS:**
  - O JSON-LD escapa `<`, e o script do tema é constante.
  - Não há renderização de markdown ou HTML.
  - Links de perfil passam por `safeHttpUrl`, e os templates de email são escapados.
- **Open redirect:** `safeInternalPath` recusa `//`, `\` e caracteres de controle. Os links de email usam a origem
  confiável da env, nunca o `Host`.
- **better-auth:**
  - Secret obrigatório.
  - Vínculo implícito de conta desligado, o que bloqueia o sequestro prévio de conta via Google.
  - O 403 de email não confirmado é reescrito para 401 genérico.
  - Rate limit guardado no banco e chaveado em `x-real-ip`.
  - Reset de senha expira em 1 h e revoga as sessões.
- **Segredos:** não existe `NEXT_PUBLIC_*`. Componentes de cliente importam `@/server/*` só para tipos. Nenhum
  segredo verificado no histórico.
- **CI:** só gatilhos `pull_request` e `push`, sem `pull_request_target`; nenhum `${{ github.event.* }}` dentro de
  `run:`; `ci.yml` e `db-backup.yml` com permissões mínimas.
- **Lockfile:** íntegro, todo do registry oficial. Na produção não há GPL nem AGPL; o LGPL da libvips é usado só no
  servidor e não é distribuído.

## Correções deste PR

| Achado | Mudança |
|---|---|
| H-1 | `next` / `eslint-config-next` 16.2.9 → 16.4.2 |
| H-2 | `sharp` 0.34.5 → 0.35.5; tipos `Metadata` importados do pacote em `image-derivatives.ts` e `blob-sweep.ts` |
| H-3 (parcial) | Trava `assertNotProductionTestDb` no harness, mais o teste `test/unit/production-db-guard.test.ts` |
| L-2 | `zod` 4.6.6, `@vercel/blob` 2.8.1, `overrides` (undici 6.29.1 no Blob, zod no `@vercel/cli-config`) |
| L-4 | Actions fixadas por SHA; `permissions: {}` no workflow de limpeza |
| L-15 (parte) | `vitest` 4.1.12 |
| §7 | `.github/workflows/security.yml` (commit separado): semgrep e gitleaks bloqueando, osv-scanner só reportando, ZAP baseline passivo no Preview |

Verificação: `npm run typecheck`, `npm run lint` (0 erros), `next build` e `npm test` completo contra Postgres
descartável via Testcontainers. `npm audit --omit=dev` depois do upgrade: só restam os itens L-1 e L-15. semgrep
e gitleaks reexecutados na branch: limpos.
