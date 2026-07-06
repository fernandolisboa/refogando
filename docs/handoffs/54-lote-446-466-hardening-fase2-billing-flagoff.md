# Handoff 54 — Lote #446–#466 + review/hardening de segurança + Fase 2 billing (scaffold flag-off)

**Sessão:** 2026-07-05/06. **Main:** verde em `c9f34eb`. **Migrações:** 0054 → 0063 (entram no próximo deploy — single Neon, migrate-on-deploy).

Este documento é auto-suficiente: resume o que foi entregue, e traz o **passo a passo do que depende do dono** + como **retomar o desenvolvimento**.

---

## 1. O que foi entregue nesta sessão

### 1a. Lote de 18 issues (#446–#466, varredura Fable 5) — TODAS mergeadas
- **Segurança:** #446 (teto atômico TOCTOU, `pg_advisory_xact_lock`, `src/server/quota/atomic.ts`), #447 (cap de extração), #448 (SSRF importer via `web-fetch.ts`), #449 (rate-limit auth persistente).
- **Custo/infra:** #463 (ledger de custo de texto) + #465 (aba admin de custo) + #464 (teto Brave `web_search_usage_daily`) + #466 (scaffold do eixo `plan`).
- **UX/features:** #452/#453/#454/#455 (detalhe), #458/#460/#461/#462 (returnTo/notif/a11y/polish), #456 (PWA), #457 (receita-da-semana).
- Detalhes: memória `lote-18-issues-seguranca-ux-custo`.

### 1b. Correções de infra que o lote exigiu
- **#487** — baseline da main estava vermelha (o #450/#480 quebrou 3 testes de gate); consertada.
- **#515** — teste flaky `discovery-home > "LIMPAR a busca"` (causa-raiz: mock do router não atualizava `window.location`); corrigido de vez.

### 1c. Review de segurança dos 4 PRs críticos + hardening
Review adversarial (4 lentes). #446 saiu **limpo**. Achados corrigidos:
- **#518** (ALTA): IP era forjável via 1º hop de `X-Forwarded-For` → derrotava o rate-limit do #449 e do #464. Fix: `x-real-ip` (não-forjável na Vercel), em `clientIpFromHeaders` + config do better-auth. + NAT64 `64:ff9b::/96` no `isBlockedV6`, guard do fresh-INSERT, teto Brave 2000→400, `/api/discovery/web` exigindo sessão, reaperto forget/reset-password, TTL da tabela `rate_limit` via cron.
- **#522**: DNS-rebind TOCTOU do #448 (fetch re-resolvia o hostname); fix = pinar o IP no connect.

### 1d. Fase 2 de billing — scaffold FLAG-OFF (nada cobra; byte-idêntico por default)
- **#531** (migr 0062): coluna `app_config.pro_caps` + wiring plan-aware nos 5 call-sites e no gate atômico.
- **#534**: aba `/admin/plano` — editar proCaps + **conceder/reverter `pro` por @handle/email** (`POST /api/admin/user-plan`).
- **#524**: seam `BillingProvider` + fake (isola a escolha de PSP).
- **#533**: paywall estático no 429 + página `/plano` placeholder.
- **Doc de decisão:** `docs/reports/fase2-billing-decisao.md` (#521). Memória `fase2-billing-scaffold-flagoff`.

---

## 2. Passo a passo — o que depende do DONO

### PRIORIDADE 1 — Decisão comercial da Fase 2 (desbloqueia o billing real) · issue **#467**
1. Ler `docs/reports/fase2-billing-decisao.md` (recomendações + fontes jul/2026).
2. Decidir e anotar na #467:
   - **PSP** — recomendado: **Mercado Pago com CPF agora** → **Asaas com CNPJ** depois (Pix Automático é PJ-only; Asaas tem NFS-e nativa).
   - **Preço** — recomendado **R$24,90/mês** (faixa 19,90–29,90); custo real medido ~R$0,43/geração Opus, ~R$0,42/imagem.
   - **Modelo** — recomendado **híbrido** (assinatura `pro` + créditos Pix pré-pagos p/ o excedente).
   - **Fiscal** — PF (isenção até R$5k/mês, Lei 15.270/2025) → MEI → ME; **confirmar CNAE com um contador**.
3. (Já dá, sem esperar) Testar o concierge: entrar em **`/admin/plano`**, configurar a tabela `proCaps`, marcar seu usuário como `pro` e ver o teto subir.
4. Me chamar com as 4 decisões → eu implemento o **adapter real do PSP** (checkout + webhook → `users.plan`) atrás da interface que já existe, + apertar os defaults do free + ledger de créditos.

### PRIORIDADE 2 — Verificar limite de crons no Vercel
O `vercel.json` agora tem **3 crons** (`dsar-sla`, `account-purge`, `rate-limit-cleanup`). Confirmar no dashboard que o **plano permite 3** (o `CRON_SECRET` já está setado, mesmo dos outros). Se o plano capar em 2, me avisa → eu fundo a limpeza do `rate_limit` num cron existente (elimina o 3º).

### PRIORIDADE 3 — Confirmar o deploy
As migrações **0054–0063** + todo o código entram no **próximo deploy** (migrate-on-deploy no Neon único). Confirmar que o deploy rodou (ou disparar um).

### Pendências legais (bloqueiam o go-live COMERCIAL, não o técnico)
- **#276** — sign-off jurídico LGPD/PI + contato de takedown.
- **#473** — política de retenção pós-erasure.

### Decisões de produto já triadas (quando quiser priorizar — NÃO bloqueiam nada)
- **#468** (onde "Salvos" mora na nav), **#469** (esqueci-senha), **#470** (enumeração de conta no signup), **#471** (analytics privacy-first), **#472** (copy de valor na home), **#474** (lista de compras).

---

## 3. Princípios inegociáveis (não regredir)
- **Flag-off = byte-idêntico:** `pro_caps` NULL ou `plan=free` ⇒ tetos de hoje. Nada de Fase 2 ativa cobrança sem a decisão comercial.
- **Nunca "bilíngue":** não rotular o app como bilíngue nem enumerar idiomas em texto voltado ao usuário.
- **Fonte da verdade do plano = `users.plan`;** o `BillingProvider` só EMITE fatos (o adapter real DEVE verificar assinatura do webhook).
- **Não-vazamento:** superfícies públicas nunca surfam receita privada/moderada/pendente/web_imported (gates de pool).

## 4. Landmines de ambiente
- **CI:** gatear no check **"checks"** (~13min). O **preview Vercel FLAKA em PR com migração** — ignorar, esperar só o "checks".
- **Migração:** drizzle é sequencial; **1 migração em voo por vez**. Se colidir (há sessões concorrentes), rebase + delete o `.sql`/snapshot + reverte `_journal.json` + `db:generate` de novo (renumera).
- **DB de teste:** Neon único, flaka sob concorrência → NÃO rodar a suíte de integração local em paralelo; confiar na CI (isolada por run).
- **Merge:** repo SEM branch-protection; `--squash` mergeia na hora. Sempre branch → PR (nunca direto no main).
- **Review em Fable:** subagentes de review esgotam crédito → self-review dos diffs.

## 5. Critério de saída (já atingido nesta sessão)
Main verde; 18 issues fechadas; toda a superfície do review de segurança endereçada em código; Fase 2 flag-off completa e verificada; worktrees limpas; memórias e este handoff atualizados.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

Leia docs/handoffs/54-lote-446-466-hardening-fase2-billing-flagoff.md e o doc de decisão docs/reports/fase2-billing-decisao.md. Contexto: o lote #446-#466, o hardening de segurança e o scaffold flag-off da Fase 2 de billing já estão 100% mergeados na main (verde). O próximo passo depende de eu (dono) ter decidido na issue #467 o PSP, o preço, o modelo e a estrutura fiscal. Se essas decisões já estão na #467, implemente o adapter real do BillingProvider para o PSP escolhido (checkout + webhook que atualiza users.plan atrás da interface já existente em src/server/billing/provider.ts), some a UI de checkout ligada ao paywall estático (/plano e o quota-upsell-card), aperte os defaults do free conforme a tabela de proCaps decidida, e — se o modelo for híbrido — comece a ledger de créditos pré-pagos. Respeite os inegociáveis e as landmines do handoff (flag-off byte-idêntico até ligar, 1 migração em voo, gatear no check "checks"). Se as decisões da #467 ainda não estiverem lá, me pergunte só o que faltar e não codifique billing real antes disso.
