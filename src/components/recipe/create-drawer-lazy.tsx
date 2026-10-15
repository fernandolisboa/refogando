'use client'
/**
 * Gaveta "Nova receita" SOB DEMANDA no header (achado G da auditoria de performance, handoff 70).
 * A gaveta (`CreateDrawer` + as três experiências de criação) era um chunk de ~55 KB bruto / 14 KB
 * gzip no JS de TODA página, porque o header a importava direto. Agora o header monta este wrapper,
 * e o código da gaveta vem de um `import()` (o primeiro chunk lazy do app):
 *  - pré-carga no ocioso (`requestIdleCallback`, com `setTimeout` onde não existe) logo depois da
 *    hidratação, e no hover/foco/pointerdown do "Criar" e ao abrir o menu mobile. Com
 *    `navigator.connection.saveData` (modo economia de dados), o ocioso não pré-carrega; o
 *    hover/foco/pointerdown seguem pré-carregando;
 *  - o clique abre a gaveta na hora quando o chunk já chegou (o caso normal: o ocioso já o trouxe).
 *    Se ainda não chegou, o clique pede a abertura e a gaveta abre assim que ele chega (o botão
 *    fica `aria-busy` nesse meio-tempo). O pedido pendente se desfaz como a gaveta aberta se
 *    desfaria antes: Escape, um clique/pointerdown fora do "Criar" (o overlay modal de antes
 *    cobria a página toda), um 2º clique no "Criar" (cairia no overlay) e a troca de rota;
 *  - se o chunk NÃO carrega (aba antiga depois de um deploy, rede caída), o clique navega para
 *    `/{locale}/create` com navegação DURA (`location.assign`): a rota busca o HTML novo e abre a
 *    mesma gaveta, já com o bundle atual.
 *  - a rota `/create` já traz a gaveta no próprio bundle (`CreateShellClient`) e a registra aqui
 *    (`registerCreateDrawer`): o store nasce `ready`, sem `import()`, e nada é baixado duas vezes.
 *
 * Por que não `next/dynamic`/`React.lazy`: no Next 16.2.9 o `next/dynamic` é um `React.lazy`, e
 * os dois jogam a rejeição do `import()` no RENDER. O `SiteHeader` renderiza no
 * `[locale]/layout.tsx`, FORA da error boundary de `[locale]/error.tsx` (que só embrulha a página),
 * e não há `global-error.tsx`: o erro iria para a tela de erro padrão da raiz do Next, que derruba
 * o app inteiro, sem reload e sem fallback. Aqui a promessa é nossa: a rejeição é tratada no
 * `.then(…, onRejected)`, então nunca vira `unhandledrejection` e o `AppUpdateGuard` não recarrega
 * a página. A falha do `<script>` do chunk também chega ao listener de captura do guard, mas como
 * `Event` de recurso, sem `error` nem `message`; `isChunkLoadError` não a reconhece (ver o
 * comentário do guard). E o store dá o que o `lazy` não dá: um "já carregou?" SÍNCRONO (o clique
 * abre no mesmo render e o botão sabe quando ficar `aria-busy`), a falha vira navegação em vez de
 * erro, e não há dialog provisório no `fallback` do Suspense. O SSR já não renderizava nada da
 * gaveta fechada (o Radix só porta o conteúdo aberto); aqui o servidor vê o estado `idle` e não
 * renderiza nada, como um `ssr: false`.
 *
 * Por que sem "casca" provisória: trocar uma casca (outro Radix Dialog) pela gaveta real repetiria
 * a animação de entrada e perderia o alvo de volta do foco (o botão "Criar"). Abrir só quando o
 * código chegou mantém o foco, o Escape e os atributos de a11y exatamente os de antes.
 *
 * Estado por documento, num store de módulo (`useSyncExternalStore`): o header persiste entre
 * navegações, e a falha é definitiva até a próxima carga de página (o runtime do Turbopack guarda a
 * promessa rejeitada do chunk; tentar de novo falharia na hora). TROCA CONSCIENTE: isso vale também
 * para uma pré-carga do OCIOSO que falhou (rede oscilando no 1º segundo, bloqueador): sem a pessoa
 * ter clicado em nada, todo "Criar" daquele documento passa a ser navegação dura para `/create`.
 * A rota abre a mesma gaveta, então a pessoa chega ao mesmo lugar (com uma carga de página a mais);
 * repetir o `import()` não adiantaria. A rota `/create` importa a gaveta direto
 * (`CreateShellClient`), então ela é o fallback natural.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { localePrefixedPath } from '@/i18n/locale-path'
import type { Locale } from '@/i18n/locale'
import type { CreateDrawer as CreateDrawerComponent } from './create-drawer'

export type CreateDrawerLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

type Snapshot = { status: CreateDrawerLoadStatus; Drawer: typeof CreateDrawerComponent | null }

/**
 * Atributo que marca o botão "Criar" do header. Um pointerdown/clique NELE não desfaz o pedido
 * pendente (o `onClick` do botão decide: abre ou, se já está pendente, cancela).
 */
export const CREATE_DRAWER_TRIGGER_ATTR = 'data-create-drawer-trigger'

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
    (m) => {
      // Um `registerCreateDrawer` no meio do caminho já publicou `ready`: nada a fazer.
      if (snapshot.status === 'loading') publish({ status: 'ready', Drawer: m.CreateDrawer })
    },
    (err: unknown) => {
      // Idem: a gaveta registrada pela `/create` vale mais que a falha do chunk lazy.
      if (snapshot.status !== 'loading') return
      console.warn('[criar] a gaveta não carregou; o "Criar" vai abrir /create', err)
      publish({ status: 'failed', Drawer: null })
    },
  )
}

/**
 * Semeia o store com a gaveta que a página JÁ importou (a rota `/create`, via `CreateShellClient`):
 * publica `ready` sem `import()`, então o "Criar" do header abre na hora e a pré-carga do ocioso
 * não baixa os chunks lazy, que repetiriam os módulos do bundle da página. No servidor não faz
 * nada (o store de módulo seria compartilhado entre requisições; o SSR lê `getServerSnapshot`).
 */
export function registerCreateDrawer(Drawer: typeof CreateDrawerComponent): void {
  if (typeof window === 'undefined' || snapshot.status === 'ready') return
  publish({ status: 'ready', Drawer })
}

/** Estado do carregamento da gaveta, para o gatilho marcar `aria-busy` enquanto espera. */
export function useCreateDrawerStatus(): CreateDrawerLoadStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).status
}

/** A rota `/create` com o prefixo do locale atual (ADR-0020), destino do fallback. */
export function createPagePath(locale: Locale): string {
  return localePrefixedPath(locale, '/create')
}

/** Modo economia de dados (`Save-Data`): sem pré-carga especulativa no ocioso. */
function prefersSaveData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return nav.connection?.saveData === true
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
  const pathname = usePathname()
  const { status, Drawer } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  // Pedido pendente: a abertura foi pedida e o código ainda não chegou (nada na tela ainda).
  const pending = open && status !== 'ready'

  // Pré-carga no ocioso, uma vez por documento (a chamada é idempotente). Com `saveData`, não:
  // hover, foco, pointerdown e o clique seguem pré-carregando, já que aí a pessoa vai abrir.
  useEffect(() => {
    if (prefersSaveData()) return
    return scheduleIdle(preloadCreateDrawer)
  }, [])

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

  // O pedido pendente se desfaz como a gaveta aberta se desfaria antes. Com a `CreateDrawer`
  // sempre montada, o clique abria o dialog modal na hora: o overlay cobria a página, então
  // qualquer pointerdown fora do painel (num link, no hambúrguer do menu mobile, num 2º clique
  // no "Criar") a fechava, e o Escape também. Sem isso, a gaveta abriria minutos depois por cima
  // da página nova ou do menu mobile. Fase de captura: o cancelamento vem antes do handler do
  // alvo (um link navega, o hambúrguer abre o menu). O `click` cobre a ativação por teclado
  // (Enter num link ou no hambúrguer), que não gera pointerdown. O "Criar" fica de fora: o
  // `onClick` dele é que cancela (um pointerdown aqui o faria reabrir no clique seguinte). Toque
  // (`pointerType === 'touch'`) espera o `click`, como o `DismissableLayer` do Radix: um arrasto
  // para rolar a página não fechava a gaveta aberta, então também não desfaz o pedido.
  useEffect(() => {
    if (!pending) return
    const cancel = () => onOpenChange(false)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    const onPointerOrClick = (e: Event) => {
      const target = e.target
      if (target instanceof Element && target.closest(`[${CREATE_DRAWER_TRIGGER_ATTR}]`)) return
      if (e.type === 'pointerdown' && (e as PointerEvent).pointerType === 'touch') return
      cancel()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerOrClick, true)
    document.addEventListener('click', onPointerOrClick, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerOrClick, true)
      document.removeEventListener('click', onPointerOrClick, true)
    }
  }, [pending, onOpenChange])

  // Troca de rota com o pedido pendente (voltar/avançar do navegador, `router.push` de algum
  // fluxo): desfaz o pedido, para a gaveta não abrir por cima da página nova. Com a gaveta já
  // aberta, quem fecha é a própria `CreateDrawer` (`useFecharAoNavegar`, handoff 74).
  const lastPathnameRef = useRef(pathname)
  useEffect(() => {
    if (lastPathnameRef.current === pathname) return
    lastPathnameRef.current = pathname
    if (pending) onOpenChange(false)
  }, [pathname, pending, onOpenChange])

  // Montada fechada assim que o código chega, como o `<CreateDrawer>` sempre montado de antes.
  if (status !== 'ready' || !Drawer) return null
  return <Drawer open={open} onOpenChange={onOpenChange} />
}
