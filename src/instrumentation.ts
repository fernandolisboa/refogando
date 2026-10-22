/**
 * Gancho de inicialização do servidor do Next (roda uma vez por processo, antes do 1º request).
 *
 * Hoje só cuida do MODO FAKE do E2E (#589); fica de pé para outros ganchos de processo (ex.: o
 * `onRequestError` da #590) — cada um no seu bloco, sem acoplar ao modo fake.
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
