'use client'
/**
 * Gaveta "Nova receita" SOB DEMANDA no header (achado G da auditoria de performance, handoff 70).
 * A gaveta (`CreateDrawer` + as três experiências de criação) era um chunk de ~55 KB bruto / 14 KB
 * gzip no JS de TODA página, porque o header a importava direto. Agora o header monta este wrapper,
 * e o código da gaveta vem de um `import()` (o primeiro chunk lazy do app):
 *  - pré-carga no ocioso (`requestIdleCallback`, com `setTimeout` onde não existe) logo depois da
 *    hidratação, e no hover/foco/pointerdown do "Criar" e ao abrir o menu mobile;
 *  - o clique abre a gaveta na hora quando o chunk já chegou (o caso normal: o ocioso já o trouxe).
 *    Se ainda não chegou, o clique pede a abertura e a gaveta abre assim que ele chega (o botão
 *    fica `aria-busy` nesse meio-tempo);
 *  - se o chunk NÃO carrega (aba antiga depois de um deploy, rede caída), o clique navega para
 *    `/{locale}/create` com navegação DURA (`location.assign`): a rota busca o HTML novo e abre a
 *    mesma gaveta, já com o bundle atual.
 *
 * Por que não `next/dynamic`/`React.lazy`: os dois jogam a rejeição do `import()` no RENDER (cai
 * numa error boundary e, sendo chunk error, no reload do ADR-0028) e não dizem "já carregou?" a
 * quem abre. Aqui a promessa é nossa: a rejeição é tratada no `.then(…, onRejected)`, então nunca
 * vira `unhandledrejection` e o `AppUpdateGuard` não recarrega a página. A falha do `<script>` do
 * chunk também chega ao listener de captura do guard, mas como `Event` de recurso, sem `error` nem
 * `message`; `isChunkLoadError` não a reconhece (ver o comentário do guard). O SSR já não renderizava
 * nada da gaveta fechada (o Radix só porta o conteúdo aberto); aqui o servidor vê o estado `idle`
 * e não renderiza nada, como um `ssr: false`.
 *
 * Por que sem "casca" provisória: trocar uma casca (outro Radix Dialog) pela gaveta real repetiria
 * a animação de entrada e perderia o alvo de volta do foco (o botão "Criar"). Abrir só quando o
 * código chegou mantém o foco, o Escape e os atributos de a11y exatamente os de antes.
 *
 * Estado por documento, num store de módulo (`useSyncExternalStore`): o header persiste entre
 * navegações, e a falha é definitiva até a próxima carga de página (o runtime do Turbopack guarda a
 * promessa rejeitada do chunk; tentar de novo falharia na hora). A rota `/create` importa a gaveta
 * direto (`CreateShellClient`), então ela é o fallback natural.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { useLocale } from '@/i18n/provider'
import { localePrefixedPath } from '@/i18n/locale-path'
import type { Locale } from '@/i18n/locale'
import type { CreateDrawer as CreateDrawerComponent } from './create-drawer'

export type CreateDrawerLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

type Snapshot = { status: CreateDrawerLoadStatus; Drawer: typeof CreateDrawerComponent | null }

// Ocioso: o `timeout` garante a pré-carga mesmo numa página que nunca fica ociosa; o `setTimeout`
// cobre os navegadores sem `requestIdleCallback` (Safari).
const IDLE_TIMEOUT_MS = 3000
const IDLE_FALLBACK_MS = 1500

const IDLE: Snapshot = { status: 'idle', Drawer: null }
let snapshot: Snapshot = IDLE
const listeners = new Set<() => void>()

function publish(next: Snapshot) {
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => snapshot
const getServerSnapshot = () => IDLE

/**
 * Começa a baixar a gaveta (idempotente: só a primeira chamada faz o `import()`). Nunca rejeita:
 * a falha vira o estado `failed`, que o clique traduz em navegação para `/create`.
 */
export function preloadCreateDrawer(): void {
  if (snapshot.status !== 'idle') return
  publish({ status: 'loading', Drawer: null })
  import('./create-drawer').then(
    (m) => publish({ status: 'ready', Drawer: m.CreateDrawer }),
    (err: unknown) => {
      console.warn('[criar] a gaveta não carregou; o "Criar" vai abrir /create', err)
      publish({ status: 'failed', Drawer: null })
    },
  )
}

/** Estado do carregamento da gaveta, para o gatilho marcar `aria-busy` enquanto espera. */
export function useCreateDrawerStatus(): CreateDrawerLoadStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).status
}

/** A rota `/create` com o prefixo do locale atual (ADR-0020), destino do fallback. */
export function createPagePath(locale: Locale): string {
  return localePrefixedPath(locale, '/create')
}

function scheduleIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(cb, IDLE_FALLBACK_MS)
  return () => window.clearTimeout(id)
}

/**
 * O header passa o mesmo `open`/`onOpenChange` de antes. Sem deep-links (o nav abre limpo no
 * método-picker); a semeadura por `?q`/`?resume`/`?mode=conversa` segue sendo do shell `/create`.
 */
export function LazyCreateDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { locale } = useLocale()
  const { status, Drawer } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Pré-carga no ocioso, uma vez por documento (a chamada é idempotente).
  useEffect(() => scheduleIdle(preloadCreateDrawer), [])

  // Abertura pedida antes do código: garante o `import()` (qualquer caminho que abra, não só o
  // clique que já pré-carrega) e, se ele falhou, fecha o pedido e navega para a `/create`.
  useEffect(() => {
    if (!open) return
    if (status === 'idle') preloadCreateDrawer()
    else if (status === 'failed') {
      onOpenChange(false)
      window.location.assign(createPagePath(locale))
    }
  }, [open, status, locale, onOpenChange])

  // Montada fechada assim que o código chega, como o `<CreateDrawer>` sempre montado de antes.
  if (status !== 'ready' || !Drawer) return null
  return <Drawer open={open} onOpenChange={onOpenChange} />
}
