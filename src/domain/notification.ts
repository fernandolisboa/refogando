import type { Messages } from '@/i18n/messages'

/**
 * Kernel de domínio das Notificações (#371, ADR-0028). A Notificação guarda DADO ESTRUTURADO
 * (tipo + ator + referências), NUNCA frase pronta: o texto é renderizado e localizado na hora,
 * no locale de quem lê (ADR-0028 dec 3). Isto molda o schema (sem coluna de texto) e mantém a
 * notificação correta se o ator trocar de @handle ou a receita for renomeada/moderada.
 *
 * Os 7 tipos do catálogo v1 (ADR-0028 dec 4) entram no enum de uma vez (completude do pgEnum),
 * mas só `new_follower` é EMITIDO e renderizado nesta fatia (tracer bullet) — os demais caem no
 * texto genérico até a fatia que os liga.
 */
export const NOTIFICATION_TYPES = [
  'review_on_recipe',
  'new_follower',
  'cuisine_suggestion_resolved',
  'recipe_moderated',
  'review_moderated',
  'image_moderated',
  'account_restricted',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/** Guard de borda: um `type` cru (de DB/entrada) é um NotificationType conhecido? */
export function isNotificationType(v: string): v is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(v)
}

/**
 * Referências RESOLVIDAS/estruturadas de uma notificação — o dado VIVO do qual o texto é montado
 * na renderização (nunca persistido como frase). `actorName`/`actorHandle` degradam a `null` quando
 * o ator foi soft-deletado (ADR-0028 dec — "degrada, não some"); `recipeTitle` é null p/ eventos
 * sem receita (ex.: `new_follower`).
 */
export type NotificationRefs = {
  actorName?: string | null
  actorHandle?: string | null
  recipeTitle?: string | null
}

/**
 * Render PURO e localizado (ADR-0028 dec 3): recebe a SEÇÃO i18n já resolvida (`messages.notifications`,
 * no locale de quem lê) + o dado estruturado, devolve o texto. Sem DB/I/O. O mapa `type → mensagem`
 * mora no i18n (as strings viram folhas cobertas pelo teste de paridade bilíngue), aqui só se escolhe
 * a chave e se interpola `{name}` por `String.replace` (mesmo padrão de `aviso.contradicao`).
 *
 * `new_follower`: com nome do ator → "{name} começou a seguir você"; ator degradado (nome null/vazio)
 * → variante anônima. Tipos ainda não implementados nesta fatia → texto genérico seguro.
 */
export function renderNotification(
  msgs: Messages['notifications'],
  type: NotificationType,
  refs: NotificationRefs,
): string {
  switch (type) {
    case 'new_follower': {
      const name = refs.actorName?.trim()
      return name ? msgs.novoSeguidor.replace('{name}', name) : msgs.novoSeguidorAnon
    }
    default:
      // Os outros 6 tipos do enum ainda não são emitidos nesta fatia (tracer bullet): texto genérico.
      return msgs.generico
  }
}
