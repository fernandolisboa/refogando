'use client'
/**
 * Rede de segurança da atualização graceful (issue #372, ADR-0028 dec 5-A2). Componente sem DOM
 * (retorna null) montado uma vez na raiz — inclusive pra visitante anônimo (AC: "Visitante
 * também se beneficia"). Instala listeners globais que fazem UM reload quieto quando um
 * ChunkLoadError escapa do React (ex.: um `import()` de event handler que rejeita SEM ser
 * capturado). Erros de chunk jogados em RENDER são tratados pela error boundary
 * (`src/app/[locale]/error.tsx`) — este guard cobre só o que não passa por lá.
 *
 * Escopo × invariante do ADR-0028 ("reload só na fronteira de navegação, nunca no meio de uma
 * tela"): o caminho PRIMÁRIO — chunk de rota jogado em render — passa pela error boundary, que
 * JÁ é uma fronteira de navegação. Este guard é belt-and-suspenders pro que escapa (rejeição de
 * `import()` não-capturada / falha de <script> de chunk). Hoje é praticamente inerte: a base NÃO
 * tem nenhum `next/dynamic`/`React.lazy`/`await import(...)` que possa estourar no meio de uma
 * tela. Se um lazy-import mid-screen for adicionado, revisitar aqui (guard de nav-em-voo ou a
 * persistência de rascunho que o #372 registra como direção) pra não recarregar perdendo tela.
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
    // `capture: true` no 'error': falha de carga de RECURSO (um <script> de chunk que não existe
    // mais pós-deploy) dispara na fase de CAPTURA e NÃO borbulha até window — sem capture, este
    // handler não a veria. As rejeições de `import()` seguem via 'unhandledrejection'.
    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
