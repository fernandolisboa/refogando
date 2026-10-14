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
 * JÁ é uma fronteira de navegação. Este guard é belt-and-suspenders pro que escapa: a rejeição de
 * `import()` não-capturada (a falha de <script> de chunk ele não reconhece, ver abaixo). Hoje é
 * praticamente inerte. O único lazy-import do app é a gaveta "Criar" (`create-drawer-lazy.tsx`,
 * handoff 70), que trata a própria rejeição (vira estado `failed`; o clique navega para `/create`)
 * e por isso nunca chega aqui como `unhandledrejection`. Quem acrescentar outro `import()`
 * mid-screen: capture a rejeição e dê um fallback próprio, ou aceite o reload daqui (e revisite o
 * guard de nav-em-voo ou a persistência de rascunho que o #372 registra como direção, pra não
 * recarregar perdendo tela).
 *
 * Falha de <script> de chunk: o listener de captura abaixo a vê, mas como `Event` de recurso, sem
 * `error` nem `message`, e `isChunkLoadError` não a reconhece (o erro com nome `ChunkLoadError` só
 * existe na rejeição da promessa do Turbopack). A gaveta depende disso: se este guard passar a
 * reconhecer falha de <script> (pelo `e.target`), ele recarregaria a página antes do fallback da
 * gaveta. Nesse caso, ignore o chunk da gaveta ou deixe a decisão para quem fez o `import()`.
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
    // `capture: true` no 'error': a falha de carga de RECURSO (um <script> de chunk que não existe
    // mais pós-deploy) não borbulha até window, só passa por ela na CAPTURA. O handler a VÊ, mas
    // não a RECONHECE: é um `Event` de recurso, sem `error` nem `message`, e `isChunkLoadError`
    // devolve `false` (ver o parágrafo do topo). O que o guard pega na prática é o `ErrorEvent` de
    // um erro de chunk jogado e não capturado, e as rejeições de `import()` via 'unhandledrejection'.
    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
