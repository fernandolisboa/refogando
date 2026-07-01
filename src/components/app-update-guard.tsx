'use client'
/**
 * Rede de segurança da atualização graceful (issue #372, ADR-0028 dec 5-A2). Componente sem DOM
 * (retorna null) montado uma vez na raiz — inclusive pra visitante anônimo (AC: "Visitante
 * também se beneficia"). Instala listeners globais que fazem UM reload quieto quando um
 * ChunkLoadError escapa do React (ex.: um `import()` de event handler que rejeita SEM ser
 * capturado). Erros de chunk jogados em RENDER são tratados pela error boundary
 * (`src/app/[locale]/error.tsx`) — este guard cobre só o que não passa por lá.
 *
 * Sem toast, sem timer, sem /api/version, sem generateBuildId (ADR-0028 rejeita o nudge).
 */
import { useEffect } from 'react'
import { isChunkLoadError, reloadForAppUpdate } from '@/lib/app-update-reload'

export function AppUpdateGuard() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error, e.message)) reloadForAppUpdate()
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) reloadForAppUpdate()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
