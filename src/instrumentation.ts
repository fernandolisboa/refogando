import type { Instrumentation } from 'next'
import { formatServerErrorLine } from './domain/error-report'

/**
 * Ganchos de servidor do Next. `register` roda uma vez por processo, antes do 1º request; `onRequestError`
 * roda a cada erro que o Next captura num request, em TODO runtime (nodejs e edge). Cada gancho no seu
 * bloco, sem acoplar um ao outro.
 */

/**
 * MODO FAKE do E2E (#589): só no runtime nodejs.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Import DENTRO do ramo nodejs: o bundle do edge não leva o guarda (nem o `process.env` de servidor).
    const { e2eFakesActive } = await import('./server/e2e/mode')
    // Lança fora do harness (Vercel, banco/URL fora de loopback): o processo nem sobe. Sem a flag, `false`.
    if (e2eFakesActive()) {
      const { installLoopbackFetchGuard } = await import('./server/e2e/fetch-guard')
      installLoopbackFetchGuard()
      console.warn('[e2e] MODO FAKE ATIVO — provedores externos trocados por dublês; fetch só para loopback.')
    }
  }
}

/**
 * Erro de servidor ⇒ UMA linha `[erro] origem=servidor …` (#590, ADR-0048; catálogo em
 * `docs/observabilidade.md`). FORA do ramo nodejs: o hook vale para todo runtime, e o formatador é TS puro.
 *
 * Da requisição só lê o MÉTODO: `request.path` traz a query (o token do reset de senha) e `headers` traz
 * cookie — nenhum dos dois entra. A rota é a definição (`context.routePath`). O Next já loga a mensagem e a
 * stack do mesmo erro; esta linha é o índice pesquisável, ligado a elas pelo digest. `notFound()`,
 * `redirect()` e o bailout de render dinâmico o Next filtra antes de chegar aqui.
 *
 * Síncrono e blindado: um erro aqui não pode virar outro erro no request (o Next só loga
 * "Error in instrumentation.onRequestError", mas nem isso queremos).
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  try {
    console.error(formatServerErrorLine(err, request.method, context))
  } catch {
    try {
      console.error('[erro] origem=servidor formato=falhou')
    } catch {
      // console indisponível: nada a fazer.
    }
  }
}
