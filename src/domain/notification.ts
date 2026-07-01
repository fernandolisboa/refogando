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
  // #374: NOTA (1–5) da avaliação-sujeito, para os eventos de avaliação. É DADO VIVO — hidratado por
  // `loadNotifications` via LEFT JOIN em `recipe_review` (sem coluna nova); reflete edições posteriores
  // da nota (ADR-0028 "dado vivo"). `null` quando não há avaliação/rating (ex.: `new_follower`).
  rating?: number | null
}

/**
 * #374: renderiza a NOTA (1–5) como número + ★ (ex.: "4★") — casa o display de estrelas da página
 * (`recipe-review-section`) sem a ambiguidade de glifos cheios/vazios num texto de uma linha. PURO e
 * defensivo: `null`/`undefined`/não-finito → string vazia (o template só mostra os parênteses vazios;
 * a notificação NÃO some por uma nota ausente).
 */
export function renderStars(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating)) return ''
  return `${rating}★`
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
    // Evento N3 (#374): NOVA avaliação na sua receita → mostra o ATOR (avaliador) + as estrelas da
    // nota VIVA. Ator degradado (soft-deletado, nome null/vazio) → variante anônima (a notificação
    // NÃO some). As estrelas vêm de `refs.rating` (hidratado pelo join vivo).
    case 'review_on_recipe': {
      const name = refs.actorName?.trim()
      const stars = renderStars(refs.rating)
      return name
        ? msgs.avaliacaoNaReceita.replace('{name}', name).replace('{stars}', stars)
        : msgs.avaliacaoNaReceitaAnon.replace('{stars}', stars)
    }
    // Evento N3 (#374): sua avaliação foi removida pelo Curador — IMPESSOAL (sem ator; não expõe o
    // Curador), mostra as estrelas da nota removida (informativo). Nota via `refs.rating` (join vivo).
    case 'review_moderated':
      return msgs.avaliacaoModerada.replace('{stars}', renderStars(refs.rating))
    // Eventos N2 (#373): mensagens genéricas localizadas, impessoais (ação de Curador/sistema — sem
    // ator interpolado) e sem o motivo livre embutido (não localizável; surfacing deferido).
    case 'cuisine_suggestion_resolved':
      return msgs.sugestaoCozinhaResolvida
    case 'recipe_moderated':
      return msgs.receitaModerada
    case 'image_moderated':
      return msgs.imagemModerada
    case 'account_restricted':
      return msgs.contaRestringida
    default:
      // Tipos ainda não ligados a um render específico → texto genérico seguro (tracer bullet).
      return msgs.generico
  }
}
