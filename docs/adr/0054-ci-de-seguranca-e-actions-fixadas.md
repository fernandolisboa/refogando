# ADR-0054 — CI de segurança: scanners no PR, DAST só passivo e Actions fixadas por SHA

Status: aceito (2026-11-02)

Origem: auditoria de segurança SAST de 2026-11-01 (`.security-audit/REPORT.md`, PR #639), pedida pelo Fernando. O
relatório propôs um workflow de segurança contínua; o painel de revisores do PR ajustou o desenho antes do merge.

## Contexto

- Não havia scanner de segurança no CI, nem Dependabot/Renovate, nem `npm audit` (REPORT I-7). As Actions eram
  referenciadas por tag mutável, inclusive uma de terceiro que segurava o `NEON_API_KEY` (REPORT L-4).
- O Preview da Vercel aponta para `preview/<branch>` do Neon, criado a partir de `main`: é **cópia dos dados reais**,
  com as chaves reais de IA, e-mail e Blob (REPORT M-7, issue #646). E tem Deployment Protection (login da Vercel).
- O repo é público. Os PRs são squash-merged (o SHA em `main` não é o da branch).

## Decisão

1. **`.github/workflows/security.yml`, job `sast`** em todo PR para `main`, toda segunda e sob demanda:
   - **semgrep** (regras do registry: default, OWASP Top 10, secrets, Next.js, TypeScript, React) e **gitleaks**
     (histórico inteiro) **reprovam** o job com achado novo. Falso positivo triado sai por linha
     (`// nosemgrep: <regra> -- motivo`) ou por caminho no `.gitleaks.toml`, nunca desligando a regra no repo e
     nunca por fingerprint (o fingerprint leva o SHA do commit e o squash-merge o invalida).
   - **osv-scanner** sobre o `package-lock.json` só **reporta** por enquanto: sobram advisories de ferramentas de dev
     e os da better-auth 1.6 aceitos (REPORT L-1, L-15). Passa a reprovar quando a lista zerar ou ganhar um
     `osv-scanner.toml` com cada exceção justificada.
   - Os binários (gitleaks, osv-scanner) vêm das releases com o **SHA-256 fixado no workflow**. O job não recebe
     secret nenhum (`contents: read`), então roda igual em PR de fork.
   - Não é check obrigatório do `main` (o gate continua `checks` + `e2e`), mas PR com `sast` vermelho não entra
     sem triagem. As regras do registry mudam sozinhas: vermelho sem mudança de código é regra nova, triar.
2. **DAST só passivo, só no Preview, só com bypass.** Job `zap-baseline` no `deployment_status` de sucesso do
   ambiente `Preview` criado pelo `vercel[bot]`: ZAP baseline (passivo), sem abrir issue e sem reprovar. Só roda com
   o secret `VERCEL_AUTOMATION_BYPASS_SECRET` (header `x-vercel-protection-bypass`); sem ele, pula com aviso, porque
   sem bypass o ZAP só enxerga a tela de login. **Varredura ativa contra o Preview fica proibida** enquanto o Preview
   tiver dados reais (#646): ativa só contra `localhost` com o harness do E2E (banco descartável, modo fake).
3. **Todo `uses:` fixado pelo SHA do commit**, com a tag num comentário. Atualizar = `git ls-remote` na tag nova e
   trocar SHA e comentário juntos. Action de terceiro que segura secret dá lugar a chamada direta à API quando for
   simples (o `cleanup-neon-preview-branch.yml` virou `curl` na API do Neon: a action instalava `neonctl@v2`
   flutuante com a chave no ambiente e interpolava o nome da branch no bash). Valor de evento do GitHub
   (`github.head_ref`, `github.event.*`) nunca entra direto num `run:`: vai por `env:`.

## Alternativas rejeitadas

- **Varredura ativa semanal no Preview** (o que a skill de auditoria propõe): atacaria uma cópia dos dados reais e
  gastaria IA paga. Volta à mesa se o #646 der ao Preview banco vazio e chaves de teste.
- **`.gitleaksignore` por fingerprint**: quebraria o PR seguinte a cada squash-merge.
- **Desligar `unsafe-formatstring` no repo inteiro**: escondia achados futuros; o `nosemgrep` por linha é cirúrgico.
- **Dependabot para as Actions agora**: resolveria o envelhecimento dos SHAs, mas abre PRs sozinho no repo. Fica
  como follow-up (handoff 94), para o Fernando decidir.

## Consequências

- Os SHAs fixados envelhecem sem Dependabot: alguém precisa revisá-los de tempos em tempos (a próxima rodada da
  auditoria, `.security-audit/config.md`, é o gatilho natural).
- O semgrep vem do PyPI só com a versão fixada (sem hash das dependências) e a imagem do ZAP é `stable`. Como o job
  não tem secret nem escrita, o pior caso de um scanner adulterado é esconder achado. Aceito.
- Teste com segredo falso fica em `test/` ou em `e2e/harness/constants.ts`; fora deles, o gitleaks reprova.
