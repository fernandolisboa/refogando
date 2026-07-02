# Handoff — Engenharia LGPD (#394–#401) mergeada; próximos passos: e-mail do encarregado + follow-ups

**Data:** 2026-07-02 · **Branch deste doc:** `docs/handoff-lgpd-engenharia` · **Contexto:** continuação do gate jurídico da Descoberta na web (#276).

## TL;DR (pro dono ler de manhã)

- ✅ **As 8 issues de engenharia LGPD (#394–#401) estão TODAS implementadas, revisadas, mergeadas e FECHADAS.** Não sobra código dessa leva — está tudo na `main`. Não é "continuar nessas issues" amanhã; elas acabaram.
- 🔒 **Nada foi ao ar.** Tudo nasce gated: a Descoberta web depende de `WEB_SEARCH_API_KEY`; as páginas de privacidade/direitos são `noindex` e sem link; o cron de SLA precisa de `CRON_SECRET`.
- 👉 **O que resta é majoritariamente HUMANO** (não dev): o sign-off do advogado (#276) + 3 tarefas suas abaixo. E 3 issues de follow-up abertas (#411/#412/#413), sendo 2 tocáveis por agente e 1 travada num mailer.

## O que cada issue entregou (referência — não vou repetir o diff)

Issues (todas CLOSED): https://github.com/fernandolisboa/refogando/issues/394 … /401. PRs #402–#410.

| Issue | Entregou | Migração |
|---|---|---|
| #394 | Denylist de domínios vetados por ToS (guard em `src/domain/web-search-config.ts`) | — |
| #395 | Tabela append-only `dsar_audit_event` + `recordDsarEvent`/hash | 0043 |
| #396 | Remoção de atribuição pelo **operador** (rota `/api/admin/attribution/clear`) — atende o autor externo sem conta | — |
| #397 | Escalada além do nome (`/api/admin/attribution/escalate`): desvincular URL / apagar importada (destrutivo, com prévia) | — |
| #398 | Página `/privacidade` **gated** (rascunho de `docs/legal/politica-de-privacidade-secao-descoberta-web.md`) | — |
| #399 | Canal público `/seus-direitos` + form `/api/legal/takedown` + tabela `takedown_ticket` + rate-limit por IP | 0044 |
| #400 | Cron `/api/cron/dsar-sla` (SLA 10/13/15d → `sla_level`), fail-closed em `CRON_SECRET` | 0045 |
| #401 | `/api/me/export` (sem PII de terceiros) + `/api/me/erasure` (anonimiza+bloqueia+desloga, **mantém conteúdo anonimizado**) | 0046 |

Migrações **0043–0046** aplicam **on-deploy** (`vercel.json` → `npm run db:migrate && npm run build`). Fundamento jurídico: `docs/legal/` (PR #393) + ADR-0019.

## Tarefas HUMANAS suas (independem de dev)

### 1. Criar o e-mail do encarregado — `privacidade@refogando.com` (grátis)
DNS está na Vercel, que **não hospeda e-mail nem forwarding**. Use um forwarding grátis e aponte os MX no DNS da Vercel:
1. Conta grátis no **ImprovMX** (ou **ForwardEmail.net**, open-source), adiciona `refogando.com`.
2. Ele dá 2 MX (`mx1/mx2.improvmx.com`, prioridades 10/20) + 1 TXT SPF (`v=spf1 include:spf.improvmx.com ~all`).
3. **Vercel → domínio refogando.com → DNS Records** → adiciona os 2 MX + o TXT.
4. No ImprovMX, alias `privacidade` → encaminha pro teu e-mail pessoal.
- **Receber é grátis.** Pra *responder como* privacidade@ precisaria de SMTP (pago/config Gmail "send as") — no início, responde do teu e-mail normal; legalmente basta o canal receber e você atender no prazo (15 dias).
- **Destrava:** de-placeholder das páginas `/privacidade` e `/seus-direitos` (hoje têm `{e-mail do encarregado}` como TODO visível) + o critério "contato de takedown publicado" da #276.
- Nuance: se o Refogando for **ATPP** (Res. ANPD 2/2022), talvez nem precise *nomear* encarregado formal — só manter o canal. Call do advogado.

### 2. Confirmar o deploy da Vercel (eu NÃO verifiquei)
Mergeei 8 PRs seguidos; o deploy PROD precisa ter aplicado as migrações 0043–0046 em ordem. Confirme o último deployment PROD verde (a memória registra o gotcha da fila da Vercel prender merge-commit sem status "Vercel"; mergear o próximo destrava). Checagem rápida: as colunas novas existem em `takedown_ticket` (sla_level, sla_alerted_at, received_at, status) e `users.anonymized_at`.

### 3. CRON_SECRET
Você já setou (`.env.local` + Vercel). Só garanta que houve um **deploy DEPOIS** de setar (env nova na Vercel só vale em deployment novo) — aí o cron de SLA acende no schedule (`0 9 * * *`).

## Trabalho que RESTA (issues abertas)

- **#411** (ready-for-agent) — Expurgo físico pós-retenção + reap de blobs órfãos (avatar/fotos). Depende do **prazo de retenção** (Art. 16, decisão jurídica → parametrizar).
- **#412** (ready-for-agent) — UI admin dos níveis de SLA. **Gotcha travado na issue:** filtrar `status NOT IN ('fulfilled','rejected')` senão ticket resolvido aparece como pendente.
- **#413** (needs-triage + blocked) — Canal real de notificação (mailer). **Decidido:** usar **Brevo ou MailerSend (free tier)** — NÃO Resend (teto 1 domínio, já no palpiteiro), NÃO Postmark (pago), NÃO SES (setup+volume não justifica). Bloqueado até: mailer escolhido + e-mail do encarregado real.
- **#276** — o **sign-off do advogado** (o gate que ninguém automatiza) + decisões jurídicas abaixo.

## Decisões travadas (2026-07-02)
- **Conteúdo do usuário eliminado: MANTER ANONIMIZADO, sem cascata/despublicar** — já é o default do #401, então zero código.
- Mailer (#413) = Brevo/MailerSend free tier.
- Encarregado = alias `privacidade@refogando.com` via forwarding grátis.
- `CRON_SECRET` setado.

## Decisões que ainda dependem do advogado (pro sign-off da #276)
- O sign-off da postura (ADR-0019) em si.
- Disposição do conteúdo do eliminado (dono já prefere anonimizar; advogado confirma; comentários livres podem ter dado auto-identificável).
- SLA por **dia-calendário** vs janelas de 24h (o cron hoje usa 24h → pode atrasar ~1 dia o "vencido"; nit registrado no review do #400).
- Confirmação **verbatim** do ToS dos 7 domínios "revisar manual" (`docs/legal/revisao-tos-allowlist.md` §4.5).

## Gotchas / landmines (aprendidos nesta leva)
- **Vercel DNS não faz e-mail** — precisa forwarding externo (ImprovMX/ForwardEmail).
- **Migrações aplicam on-deploy** — NUNCA `db:migrate` local.
- **Env nova na Vercel só vale em deployment novo** (redeploy).
- **Neon flaka sob testes node concorrentes** — os agentes rodam só typecheck/lint/ui local e confiam na CI pro node/DB. Rode focado, nunca a suíte node completa em paralelo.
- **Worktrees de agente vão sob `.claude/worktrees/`** (excluídas do vitest); `db:generate` SEMPRE dentro da worktree (cwd).
- **Bug de watcher de CI:** `jq '.conclusion // .status'` é furado — enquanto roda, `conclusion` é `""` (string vazia = truthy pro `//`), nunca cai no fallback. Use `[.statusCheckRollup[]?|select((.name//.context)=="checks")][0].conclusion` e trate `""`/null como PENDING.
- **`gh pr merge --delete-branch`** falha no git LOCAL (branch checked-out na worktree) mas o merge REMOTO acontece — confirme `state=MERGED` e limpe branch/worktree à mão.
- API 529/classificador pode cair no meio (derrubou 3 agentes sem commit numa das ondas); worktrees ficam intactas e o trabalho é retomável.

## Suggested skills (pra próxima sessão)
- **`/run`** ou verificação manual pra confirmar o deploy PROD (tarefa 2) — ou só checar o dashboard da Vercel.
- **`/to-issues`** NÃO é preciso (as 3 follow-ups já existem).
- Quando for pegar #411/#412: fluxo padrão do repo (subagentes por passo; `tdd` → review adversarial multi-lente → `verify`), via Workflow em worktrees, como nesta leva.
- **`/triage`** no #413 quando o mailer for escolhido (hoje está needs-triage/blocked).

## Referências
- Issues: #394–#401 (fechadas), #411/#412/#413 (abertas), #276 (aberta, gate humano). PRs #402–#410.
- Pacote jurídico: `docs/legal/*` (PR #393, não mergeado — é rascunho pro advogado).
- Postura/domínio: `docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`.
- Skills LGPD (prateleira): `~/tools/lgpd-skills` (instala sob demanda, remove no fim; NUNCA fixo no global).

---

### Prompt de kickoff (copiar/colar amanhã)

Continuar a iniciativa LGPD do Refogando. Leia docs/handoffs/49-engenharia-lgpd-394-401-mergeada-proximos-email-encarregado-followups.md para o contexto completo. Estado: as 8 issues de engenharia #394–#401 estão TODAS mergeadas e fechadas (migrações 0043–0046 na main), tudo gated (WEB_SEARCH_API_KEY + CRON_SECRET). Meu foco agora: (1) confirmar que o deploy PROD da Vercel aplicou as migrações 0043–0046; (2) eu (dono) vou criar o alias privacidade@refogando.com via ImprovMX/ForwardEmail + MX no DNS da Vercel — me guie se travar; (3) decidir se seguimos com as issues de follow-up #411 (expurgo físico, ready-for-agent) e #412 (UI admin de SLA, ready-for-agent) via o fluxo de worktrees+review adversarial desta leva. O #413 (mailer) está bloqueado até eu escolher Brevo/MailerSend e ter o e-mail do encarregado. O #276 segue esperando o sign-off do advogado. Decisões já travadas: manter conteúdo do usuário eliminado anonimizado (sem cascata), mailer = Brevo/MailerSend free tier.
