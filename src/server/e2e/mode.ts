/**
 * MODO FAKE do E2E (#589) — o único interruptor que troca os provedores externos (Claude, Gemini,
 * Resend, Blob, busca na web, importador) pelos dublês de `./fakes.ts` num `next start` de verdade.
 *
 * SEGURO POR CONSTRUÇÃO: a flag `REFOGANDO_E2E_FAKES` só liga o modo quando TODO o resto do ambiente
 * prova que é o harness local (`e2e/harness/server.ts`). Qualquer combinação suspeita LANÇA — melhor
 * derrubar o processo do que servir receita enlatada (ou cadastro sem e-mail) em produção:
 *  - flag ausente ou '' ⇒ `false` ANTES de ler qualquer outra variável (o caminho de produção é só isto);
 *  - flag com outro valor que não '1' ⇒ lança (erro de digitação não vira "meio ligado");
 *  - qualquer marcador da Vercel NÃO vazio (VERCEL, VERCEL_ENV, VERCEL_URL, VERCEL_REGION,
 *    VERCEL_DEPLOYMENT_ID) ⇒ lança. Vazio não conta: o harness zera as chaves que um `.env*` local
 *    (ex. `vercel env pull`) traria, e o `@next/env` só preenche chave `undefined`;
 *  - `DATABASE_URL` ausente, inválida ou com host fora de loopback ⇒ lança (o E2E nunca fala com o Neon);
 *  - `BETTER_AUTH_URL` e `APP_URL` precisam ser `http:` em loopback (o harness serve em localhost:3100).
 *
 * SEM imports `@/`: este módulo é importado pelo `next.config.ts` (tripwire de build) e pelo
 * `instrumentation.ts`, fora do grafo com alias.
 */

export const E2E_FAKES_FLAG = 'REFOGANDO_E2E_FAKES'

/** Marcadores de "estou rodando na Vercel" (build, função ou preview). Presença NÃO vazia basta. */
export const VERCEL_MARKERS = [
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_REGION',
  'VERCEL_DEPLOYMENT_ID',
] as const

type Env = Record<string, string | undefined>

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** O host da URL é loopback? URL inválida ⇒ `false` (quem chama decide se lança). */
export function isLoopbackUrl(raw: string | undefined, protocols?: readonly string[]): boolean {
  if (!raw) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (protocols && !protocols.includes(u.protocol)) return false
  return LOOPBACK_HOSTS.has(u.hostname)
}

/**
 * O modo fake do E2E está ligado? `false` no caminho normal (flag ausente/vazia); `true` só no harness;
 * LANÇA em qualquer outro caso (ver o cabeçalho). Barato (só lê env): os getters de `deps.ts` chamam a
 * cada inicialização preguiçosa, sem cache — um teste pode trocar o env entre chamadas.
 */
export function e2eFakesActive(env: Env = process.env): boolean {
  const flag = env[E2E_FAKES_FLAG]
  if (flag === undefined || flag === '') return false
  if (flag !== '1') {
    throw new Error(`[e2e] ${E2E_FAKES_FLAG} só aceita '1' (recebido: ${JSON.stringify(flag.slice(0, 16))}).`)
  }
  const vercel = VERCEL_MARKERS.filter((k) => !!env[k])
  if (vercel.length > 0) {
    throw new Error(`[e2e] ${E2E_FAKES_FLAG} ligado num ambiente da Vercel (${vercel.join(', ')}): recusado.`)
  }
  if (!isLoopbackUrl(env.DATABASE_URL, ['postgres:', 'postgresql:'])) {
    throw new Error(`[e2e] ${E2E_FAKES_FLAG} exige DATABASE_URL postgres em loopback (localhost/127.0.0.1/::1).`)
  }
  for (const key of ['BETTER_AUTH_URL', 'APP_URL'] as const) {
    if (!isLoopbackUrl(env[key], ['http:'])) {
      throw new Error(`[e2e] ${E2E_FAKES_FLAG} exige ${key} http:// em loopback.`)
    }
  }
  return true
}
