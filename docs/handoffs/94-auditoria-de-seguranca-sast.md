# Handoff 94 — Auditoria de segurança SAST (2026-11-01)

**Data:** 2026-11-02.
**PR:** #639 "Auditoria de segurança SAST (2026-11-01): upgrades de next/sharp, trava do harness contra produção,
Actions por SHA" (aberto pelo scan do Fernando; o painel de revisores corrigiu na mesma branch).
**Base:** `main` depois do #649 (inventário do `.env.example`).
**Migração:** nenhuma. **ADR:** ADR-0054 novo (CI de segurança); ADR-0047 ganha nota sobre a trava do harness.

## 1. Escopo

- **Relatório:** `.security-audit/REPORT.md` (achados, severidade, o que foi corrigido e a seção "Revisão do PR").
  Config da próxima rodada da skill `/security-audit`: `.security-audit/config.md`.
- **Dependências:** `next`/`eslint-config-next` 16.4.2 (H-1), `sharp` 0.35.5 (H-2), `zod` 4.6.6, `@vercel/blob` 2.8.1,
  `vitest` 4.1.12, `undici` 7.30.1 agora **declarado** (o `web-fetch.ts` importava o undici içado do jsdom).
- **Next 16.3+:** o `global-error.tsx` lê `retry` (o `unstable_retry` deixou de ser passado; o botão recarregava a
  página inteira). `images.remotePatterns` saiu do `next.config.ts`.
- **Trava do harness (H-3):** `test/helpers/production-db-guard.ts`; `createThrowawayDb` recusa o host de produção;
  `pickAdminUrl` não cai mais no banco da app.
- **CI:** `.github/workflows/security.yml` (ADR-0054), Actions fixadas por SHA, `cleanup-neon-preview-branch.yml`
  sem a action de terceiro, `.gitleaks.toml`.
- **Medium viraram issues #640–#648** (custo de IA sem limite, papel do banco, mailer, Preview, backup, retirada).

## 2. O que ler primeiro

1. `.security-audit/REPORT.md`: Resumo, Medium, tabela de Low e "Revisão do PR".
2. `docs/adr/0054-ci-de-seguranca-e-actions-fixadas.md`.
3. `test/helpers/production-db-guard.ts` e `test/helpers/throwaway-db.ts`.
4. `.github/workflows/security.yml` e `.github/workflows/cleanup-neon-preview-branch.yml`.

## 3. Princípios inegociáveis

- **Nenhum harness fala com o banco de produção.** A trava roda sobre a URL que vai ser usada, antes de conectar. Não
  reintroduza fallback do harness para `DATABASE_URL*`/`POSTGRES_URL*`.
- **DAST ativo nunca contra o Preview** enquanto ele tiver cópia dos dados reais (#646). Ativo só no `localhost` com o
  harness do E2E.
- **`uses:` sempre por SHA**, valor de evento do GitHub só por `env:` (ADR-0054).
- **Falso positivo de scanner sai por linha ou por caminho**, nunca desligando a regra nem por fingerprint.

## 4. Landmines

- **better-auth fica na 1.6.16 de propósito.** A 1.6.17 até a 1.7.6 traz GHSA-44jh (rate limit no Postgres furável),
  que afeta o app. A 1.7.7+ resolve tudo, mas exige a coluna `session.impersonatedBy` (migração) e liga a
  personificação do plugin admin (REPORT L-1, L-13). Subir = issue própria, com migração e bloqueio dos endpoints
  `/api/auth/admin/*` que a app não usa.
- **ZAP:** sem `VERCEL_AUTOMATION_BYPASS_SECRET` nos secrets do Actions, o job pula. Para ligar: Vercel → Settings →
  Deployment Protection → Protection Bypass for Automation, e gravar o valor como secret do repo.
- **semgrep vermelho sem mudança de código** = regra nova no registry. Triar: corrigir ou `// nosemgrep: <regra> --
  motivo` na linha.
- **sharp 0.35** instala `@img/sharp-wasm32` (~9 MB) como fallback; pode entrar no trace das funções que importam o
  sharp. Bem abaixo do limite de 250 MB da Vercel; vale olhar o tamanho das funções se algum dia apertar.
- O repo é **público**: issues de segurança abertas ficam visíveis. Próxima rodada: considere GitHub Security
  Advisories privados para achados ainda abertos.

## 5. Follow-ups (sem issue ainda)

- Dependabot só para `github-actions` (atualiza os SHAs fixados). Decisão do Fernando: abre PR sozinho.
- osv-scanner passar a reprovar quando a lista zerar (ou com `osv-scanner.toml` justificado).
- Os Low abertos do relatório (L-3 CSP aplicada, L-5 a L-14). Nenhum tem issue; o relatório tem local e correção.
- A mesma trava de produção nos `scripts/` (hoje leem `DATABASE_URL_UNPOOLED` de propósito, para rodar em produção
  quando o operador quer).

## 6. Critério de saída

- `checks`, `e2e` e `sast` verdes no PR.
- Em produção: tela de erro do layout raiz re-renderiza no "tentar de novo"; upload de avatar e foto de avaliação
  seguem funcionando (sharp 0.35); import por URL segue funcionando (undici 7.30.1).
