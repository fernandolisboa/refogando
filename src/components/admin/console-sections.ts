/**
 * Mapa das seções do Console — fonte ÚNICA da barra lateral (`SectionNav`) e do cabeçalho de cada página
 * (`ConsoleShell`). Seção nova = uma entrada aqui (rota em `/admin/<x>` + rótulo `nav*` + descrição `desc*`).
 *
 * `min` é só AFORDÂNCIA (esconde o link de quem não tem o papel): o gate de verdade é o `SectionGate` de cada
 * `page.tsx` + o `requireRole` das rotas de API. Pessoas e Plataforma são admin-only; Curadoria vale para
 * curador e admin.
 */
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Columns2,
  Compass,
  CreditCard,
  Globe,
  Languages,
  Library,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import type { Messages } from '@/i18n/messages/pt-BR'

type AdminMessages = Messages['admin']
type KeyOf<P extends string> = Extract<keyof AdminMessages, `${P}${string}`>

export type ConsoleSection = {
  href: string
  label: KeyOf<'nav'>
  description: KeyOf<'desc'>
  icon: LucideIcon
}

export type ConsoleGroup = {
  key: 'pessoas' | 'plataforma' | 'curadoria'
  label: KeyOf<'grupo'>
  min: 'admin' | 'curador'
  sections: ConsoleSection[]
}

export const CONSOLE_GROUPS: readonly ConsoleGroup[] = [
  {
    key: 'pessoas',
    label: 'grupoPessoas',
    min: 'admin',
    sections: [
      { href: '/admin/users', label: 'navUsuarios', description: 'descUsuarios', icon: Users },
      { href: '/admin/plano', label: 'navPlano', description: 'descPlano', icon: CreditCard },
    ],
  },
  {
    key: 'plataforma',
    label: 'grupoPlataforma',
    min: 'admin',
    sections: [
      { href: '/admin/ia', label: 'navIa', description: 'descIa', icon: Sparkles },
      { href: '/admin/descoberta', label: 'navDescoberta', description: 'descDescoberta', icon: Compass },
      { href: '/admin/comparador', label: 'navComparador', description: 'descComparador', icon: Columns2 },
      { href: '/admin/vocabulario', label: 'navVocabulario', description: 'descVocabulario', icon: BookOpen },
      { href: '/admin/site', label: 'navSite', description: 'descSite', icon: Globe },
    ],
  },
  {
    key: 'curadoria',
    label: 'grupoCuradoria',
    min: 'curador',
    sections: [
      { href: '/admin/moderation', label: 'navModeracao', description: 'descModeracao', icon: ShieldCheck },
      { href: '/admin/translations', label: 'navTraducoes', description: 'descTraducoes', icon: Languages },
      { href: '/admin/catalog', label: 'navCatalogo', description: 'descCatalogo', icon: Library },
    ],
  },
]

/** Grupos que o papel enxerga (admin vê tudo; curador só a Curadoria). */
export function groupsForRole(role: 'admin' | 'curador'): readonly ConsoleGroup[] {
  return role === 'admin' ? CONSOLE_GROUPS : CONSOLE_GROUPS.filter((g) => g.min === 'curador')
}

/** Seção da rota atual (path SEM o prefixo de locale), com o grupo dela. `null` fora de uma seção. */
export function findConsoleSection(
  path: string,
): { group: ConsoleGroup; section: ConsoleSection } | null {
  for (const group of CONSOLE_GROUPS) {
    for (const section of group.sections) {
      if (path === section.href || path.startsWith(`${section.href}/`)) return { group, section }
    }
  }
  return null
}
