import type { Messages } from '@/i18n/messages'
import { recipeDetailPath } from '@/domain/recipe-detail-route'

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
  // #460: UUID da receita-sujeito, quando há (eventos de receita/avaliação). Alimenta o LINK do item
  // no painel (`notificationHref` → detalhe canônico). É a coluna `notification.recipe_id` que JÁ existe
  // (sem schema novo); `null` p/ eventos sem receita (`new_follower`, `account_restricted`, sugestão de
  // cozinha). NUNCA vira TEXTO. Não é capability: o GET do detalhe reimpõe os gates de leitura, então
  // expor o UUID a quem já interagiu com a receita (dono, ou avaliador em `review_moderated`) não vaza.
  recipeId?: string | null
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
      // Interpola `{stars}` (valor CONFIÁVEL) ANTES de `{name}` (nome livre do usuário): a string
      // de estrelas nunca contém `{name}`, então fazer o nome por último impede injeção de token
      // (um avaliador chamado literalmente "{stars}" não corrompe a renderização).
      return name
        ? msgs.avaliacaoNaReceita.replace('{stars}', stars).replace('{name}', name)
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

/**
 * #460: resolve o ALVO clicável de uma notificação a partir do tipo + refs estruturadas — PURO
 * (sem DB/I/O), no locale de quem lê. Devolve o caminho interno ou `null` (o item vira texto puro,
 * sem link). Fecha o beco-sem-saída: abrir o painel marca tudo como lido, então "avaliou sua receita"
 * / "começou a seguir você" precisam LEVAR ao alvo.
 *
 * Mapeamento (ADR-0028):
 *  - `new_follower` → perfil público do ator `/u/<handle>` (sem prefixo de locale — o proxy prefixa,
 *    igual ao `CookCard`/`AuthSlot`). Ator soft-deletado (handle degradado a null) ⇒ SEM link (o item
 *    degrada a texto, coerente com a variante anônima do render — não linka `/u/undefined`).
 *  - eventos de RECEITA (`review_on_recipe`, `review_moderated`, `recipe_moderated`, `image_moderated`)
 *    → detalhe canônico via `recipeDetailPath(locale, <uuid>)` = `/{locale}/recipes/<uuid>`, que 308a
 *    pro slug do locale (link legado por UUID, ADR-0020). Destinatário: o DONO da receita
 *    (`review_on_recipe`/`recipe_moderated`/`image_moderated`) — lê a própria mesmo removida/moderada
 *    (caminho do dono, cookie); ou o AVALIADOR (`review_moderated`) — a receita é pública (ele a avaliou),
 *    então o UUID 308a normalmente. Borda leak-safe: se a receita virou não-pública depois, o avaliador
 *    cai no 404 do caminho do dono (não vaza slug/existência) em vez de num link morto silencioso. Sem
 *    `recipeId` (dado legado) ⇒ SEM link.
 *  - `cuisine_suggestion_resolved` / `account_restricted` → SEM alvo natural (informativos): texto puro.
 */
export function notificationHref(
  type: NotificationType,
  refs: NotificationRefs,
  locale: string,
): string | null {
  switch (type) {
    case 'new_follower': {
      const handle = refs.actorHandle?.trim()
      return handle ? `/u/${handle}` : null
    }
    case 'review_on_recipe':
    case 'review_moderated':
    case 'recipe_moderated':
    case 'image_moderated': {
      const id = refs.recipeId?.trim()
      return id ? recipeDetailPath(locale, id) : null
    }
    default:
      return null
  }
}
