/**
 * Atualização graceful do cliente pós-deploy (issue #372, ADR-0028 dec 5-A). SEM toast, SEM
 * timer, SEM /api/version, SEM generateBuildId. Módulo PURO (sem React, sem `'use client'`):
 * detecta erro de chunk velho e faz UM reload quieto — reusado pela error boundary (caminho
 * primário: chunk de rota jogado em render) e pelo guard de janela (rede de segurança pra
 * rejeições de `import()` não-capturadas em event handler).
 */

// Um bundle velho pós-deploy some do CDN; ao pedir um chunk que não existe mais o webpack/Next
// joga um ChunkLoadError. Reconhecemos por `name` E por mensagem (o `name` some quando o erro
// atravessa serialização/boundary), tolerando maiúsculas/variações.
export function isChunkLoadError(err: unknown, message?: string): boolean {
  const msg = message ?? (err as { message?: string } | null)?.message ?? ''
  return (
    (err as { name?: string } | null)?.name === 'ChunkLoadError' ||
    /Loading chunk .* failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  )
}

// One-shot por janela de tempo (não por flag limpa no mount — uma flag permitiria um 2º chunk
// error recarregar na hora → loop infinito). Guardamos o timestamp do último reload em
// sessionStorage; dentro da janela, um novo chunk error NÃO recarrega de novo (deixa o erro
// aparecer, quebrando loops apertados).
const KEY = 'app-update-reload'
const WINDOW_MS = 10_000

export function reloadForAppUpdate(): void {
  try {
    // Tradeoff consciente da janela de tempo: no caso normal de deploy o reload busca o HTML
    // fresco e se auto-cura (recarrega exatamente uma vez); um chunk PERMANENTEMENTE quebrado
    // re-disparado após cada janela de 10s recarregaria uma vez por janela. Contagem-limitada é
    // a alternativa mais estrita, deliberadamente NÃO adotada no v1.
    const last = Number(window.sessionStorage.getItem(KEY) ?? '0')
    if (last && Date.now() - last < WINDOW_MS) return
    window.sessionStorage.setItem(KEY, String(Date.now()))
    window.location.reload()
  } catch {
    // sessionStorage desabilitado (Safari privado) → sem reload; degrada em silêncio.
  }
}
