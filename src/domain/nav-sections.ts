/**
 * Seções da navegação (ADR-0043) — o kernel PURO da arquitetura de informação da chrome: o header
 * mostra 3 SEÇÕES (Explorar, Minhas receitas, Planejar) e cada seção abre uma tira de SUBABAS logo
 * abaixo do header. Sem React, sem DOM, sem storage: o header, a tira e o drawer mobile perguntam
 * tudo aqui (qual seção/aba está ativa, pra onde o link da seção leva) e só traduzem os ids em rótulos.
 *
 * Os hrefs são NUS (sem prefixo de locale): quem compara recebe o `rest` de `splitLocalePrefix`.
 * Nenhuma URL mudou com as seções: elas só agrupam rotas que já existiam.
 */

export type NavSectionId = 'explorar' | 'minhasReceitas' | 'planejar'

export type NavTabId =
  | 'descobrir'
  | 'seguindo'
  | 'cozinheiros'
  | 'criacoes'
  | 'salvos'
  | 'cardapio'
  | 'listas'
  | 'despensa'

export type NavTab = {
  id: NavTabId
  href: string
  /** Só aparece logado (o Visitante não tem o que ver ali). */
  authOnly: boolean
}

export type NavSection = {
  id: NavSectionId
  /** A seção inteira só existe logada (no header e no drawer). */
  authOnly: boolean
  /**
   * O link da seção no header leva à última subaba visitada (neste dispositivo) em vez da 1ª. Só nas
   * seções pessoais: "Explorar" é a home e leva sempre a `/`.
   */
  remembersLastTab: boolean
  /** A 1ª aba é o destino padrão do link da seção. */
  tabs: readonly NavTab[]
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'explorar',
    authOnly: false,
    remembersLastTab: false,
    tabs: [
      { id: 'descobrir', href: '/', authOnly: false },
      { id: 'seguindo', href: '/following', authOnly: true },
      { id: 'cozinheiros', href: '/cooks', authOnly: false },
    ],
  },
  {
    id: 'minhasReceitas',
    authOnly: true,
    remembersLastTab: true,
    tabs: [
      { id: 'criacoes', href: '/me/recipes', authOnly: true },
      { id: 'salvos', href: '/me/saved', authOnly: true },
    ],
  },
  {
    id: 'planejar',
    authOnly: true,
    remembersLastTab: true,
    tabs: [
      { id: 'cardapio', href: '/me/meal-plan', authOnly: true },
      { id: 'listas', href: '/me/shopping-lists', authOnly: true },
      { id: 'despensa', href: '/me/pantry', authOnly: true },
    ],
  },
]

/**
 * A rota `rest` (sem locale) cai dentro de `href`? A home (`/`) só casa com ela mesma; as demais casam
 * também com as subrotas (`/me/shopping-lists/<id>` é a aba "Listas de compras").
 */
export function matchesHref(rest: string, href: string): boolean {
  return href === '/' ? rest === '/' : rest === href || rest.startsWith(`${href}/`)
}

/** Seção e aba da rota atual, ou `null` fora das seções (receita, perfil, /create, /admin, /guia…). */
export function activeNav(rest: string): { section: NavSection; tab: NavTab } | null {
  for (const section of NAV_SECTIONS) {
    for (const tab of section.tabs) {
      if (matchesHref(rest, tab.href)) return { section, tab }
    }
  }
  return null
}

/** As seções que valem para quem está vendo. */
export function sectionsFor(authed: boolean): NavSection[] {
  return NAV_SECTIONS.filter((s) => authed || !s.authOnly)
}

/** As abas da seção que valem para quem está vendo. */
export function tabsFor(section: NavSection, authed: boolean): NavTab[] {
  return section.tabs.filter((t) => authed || !t.authOnly)
}

/**
 * Pra onde o link da seção leva: a última aba lembrada, se a seção lembra e o valor é MESMO uma aba
 * dela (o valor vem do localStorage, então nunca vira href sem passar por esta lista); senão a 1ª aba.
 */
export function sectionEntryHref(section: NavSection, remembered: string | null | undefined): string {
  if (section.remembersLastTab && remembered) {
    const tab = section.tabs.find((t) => t.href === remembered)
    if (tab) return tab.href
  }
  return section.tabs[0].href
}

/** Chave do localStorage com a última aba de cada seção (versão no nome, como a do tour). */
export const LAST_TAB_STORAGE_KEY = 'refogando:nav:ultima-aba:v1'

export type LastTabs = Partial<Record<NavSectionId, string>>

/**
 * Lê o JSON gravado, descartando o que não for um href de aba da própria seção. Nunca lança: storage
 * corrompido ou de outra versão vira `{}`.
 */
export function parseLastTabs(raw: string | null): LastTabs {
  if (!raw) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof data !== 'object' || data === null) return {}
  const out: LastTabs = {}
  for (const section of NAV_SECTIONS) {
    if (!section.remembersLastTab) continue
    const v = (data as Record<string, unknown>)[section.id]
    if (typeof v === 'string' && section.tabs.some((t) => t.href === v)) out[section.id] = v
  }
  return out
}
