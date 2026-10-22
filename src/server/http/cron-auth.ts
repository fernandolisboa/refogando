import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Gate dos crons (`src/app/api/cron/*`, Vercel Cron — `vercel.json`), fonte ÚNICA (hardening #588): exige
 * `Authorization: Bearer ${CRON_SECRET}`. FAIL-CLOSED: sem `CRON_SECRET` no ambiente (deploy-gate humano) OU
 * header ausente/errado ⇒ `false` (a rota responde o 401 `Unauthorized` de sempre, sem corpo/detalhe).
 *
 * Por que não `auth === \`Bearer ${secret}\``: a comparação de string para no 1º byte diferente, então o
 * tempo de resposta vaza quanto do prefixo bate (oráculo de timing, byte a byte). Aqui comparamos o SHA-256
 * dos dois lados com `timingSafeEqual`: os digests têm tamanho FIXO (32 bytes), então nem o comprimento do
 * secret vaza (um `timingSafeEqual` direto lançaria em tamanhos diferentes — e o atalho de checar o tamanho
 * antes vazaria exatamente o tamanho). Lê só `process.env` e o header; sem DB, sem log.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth === null) return false
  return timingSafeEqual(sha256(auth), sha256(`Bearer ${secret}`))
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}
