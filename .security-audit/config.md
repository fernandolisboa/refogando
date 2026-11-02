# Config da skill security-audit — refogando

Lido pela skill `/security-audit` no começo de cada rodada (os argumentos da invocação têm precedência).
Gerado na auditoria de 2026-11-01 (SAST apenas). Ver `REPORT.md`.

## Perfil

- `web`: Next.js 16 App Router na Vercel (projeto `refogando`, região `gru1`). Repo único, um deployable.
- Banco: Neon. **Produção = projeto `misty-lake-71917023`, branch `main`, host `ep-gentle-morning-…`.** Nunca rode
  reset, drop, truncate ou DAST ativo contra ele.

## Alvo de DAST

- **Preview NÃO serve para varredura ativa.** A integração Neon↔Vercel cria `preview/<branch>` a partir de `main`,
  ou seja, uma cópia dos dados reais, e o Preview tem chaves reais de IA, email e Blob (REPORT M-7). Contra o
  Preview, só passivo (ZAP baseline e headers).
- Ativo: `localhost` com `next build && next start`, apontado para uma branch **vazia** do Neon (schema e seed) ou,
  mais simples, para o harness do E2E: `e2e/harness/server.ts` sobe Postgres via Testcontainers, migra, semeia e
  serve em `http://localhost:3100` no modo fake (provedores trocados por dublês, ver `docs/e2e.md`). A partir do
  container do ZAP: `--network host`, ou `http://host.docker.internal:3100`.

## Usuários de teste

- Ainda não existe login de teste não-interativo para DAST. O harness do E2E semeia usuários próprios (ver
  `e2e/harness/`). Reuse esse mecanismo antes de criar outro.
- Se for criar: `audit-a@audit.test` e `audit-b@audit.test`, com senha aleatória em `.security-audit/.env.local`
  (fora do git pelo padrão `.env*.local`) e só na base descartável. O plugin `testUtils` da better-auth já é
  restrito a `NODE_ENV=test` (`src/lib/auth.ts:575`).

## Ferramentas

semgrep 1.183.0 (pipx), CodeQL 2.27.3 (bundle em `~/.local/share/codeql`), gitleaks 8.30.1, trufflehog 3.99.7,
osv-scanner 2.7.0, trivy 0.76.1 (todos em `~/.local/bin`, com checksum conferido). Docker disponível (Testcontainers).

## Exclusões de escopo

- `.claude/worktrees/**` (worktrees antigas de agentes; aparecem no trivy e no osv como ruído), `node_modules`,
  `.next`, `.security-audit/raw`.
- Para a suíte rodar só no Testcontainers: rode a partir de um shell **sem** `DATABASE_URL`/`TEST_DATABASE_URL`,
  porque o `.env.local` aponta para produção (REPORT H-3). Desde esta auditoria, o harness recusa esse host.

## Riscos aceitos (revisar a cada rodada)

- better-auth 1.6.16: os advisories GHSA-965c, -r4xp, -q84f e -qq9h dependem de plugins que o app não usa. A 1.6.17+
  traz GHSA-44jh, que afeta o app (rate limit no Postgres), e a 1.7.x exige migrar `session.impersonatedBy`
  (REPORT L-1).
- Advisories só de ferramentas de dev (vite, esbuild, undici 7, source-map-js…) (REPORT L-15).
