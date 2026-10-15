/**
 * Rótulos das seções e abas da navegação (ADR-0043): traduz os ids de `domain/nav-sections` para o
 * catálogo. Abas que já tinham rótulo em outra seção do catálogo reusam o dele (o "Salvos" da aba é o
 * mesmo `<h1>` da página, por exemplo), pra nunca divergirem.
 */
import type { Messages } from '@/i18n/messages'
import type { NavSectionId, NavTabId } from '@/domain/nav-sections'

export function sectionLabel(messages: Messages, id: NavSectionId): string {
  switch (id) {
    case 'explorar':
      return messages.nav.home
    case 'minhasReceitas':
      return messages.nav.minhasReceitas
    case 'planejar':
      return messages.nav.planejar
  }
}

export function tabLabel(messages: Messages, id: NavTabId): string {
  switch (id) {
    case 'descobrir':
      return messages.nav.descobrir
    case 'seguindo':
      return messages.nav.seguindo
    case 'cozinheiros':
      return messages.nav.cozinheiros
    case 'criacoes':
      return messages.nav.criacoes
    case 'salvos':
      return messages.colecoes.titulo
    case 'cardapio':
      return messages.nav.cardapio
    case 'listas':
      return messages.listaDeCompras.indiceTitulo
    case 'despensa':
      return messages.nav.despensa
  }
}
