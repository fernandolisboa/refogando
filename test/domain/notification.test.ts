import { describe, expect, it } from 'vitest'
import {
  isNotificationType,
  renderNotification,
  notificationHref,
  renderStars,
  NOTIFICATION_TYPES,
} from '@/domain/notification'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'

/**
 * Render PURO e localizado da Notificação (#371, ADR-0028 dec 3). O texto NÃO é persistido — é montado
 * do dado estruturado no locale de quem lê. Testamos com as SEÇÕES i18n REAIS dos dois locales, então
 * uma regressão de string bilíngue (o defeito que o dado-estruturado quer evitar) aqui aparece.
 */
describe('renderNotification (#371) — texto localizado do dado estruturado', () => {
  it('new_follower com nome do ator interpola {name} nos dois locales', () => {
    expect(renderNotification(ptBR.notifications, 'new_follower', { actorName: 'Ana' })).toBe(
      'Ana começou a seguir você',
    )
    expect(renderNotification(enUS.notifications, 'new_follower', { actorName: 'Ana' })).toBe(
      'Ana started following you',
    )
  })

  it('new_follower com ator degradado (nome null/vazio) usa a variante anônima', () => {
    expect(renderNotification(ptBR.notifications, 'new_follower', { actorName: null })).toBe(
      'Alguém começou a seguir você',
    )
    expect(renderNotification(ptBR.notifications, 'new_follower', { actorName: '  ' })).toBe(
      'Alguém começou a seguir você',
    )
    expect(renderNotification(enUS.notifications, 'new_follower', { actorName: undefined })).toBe(
      'Someone started following you',
    )
  })

  it('cuisine_suggestion_resolved → mensagem genérica localizada (sem interpolação de ator)', () => {
    expect(renderNotification(ptBR.notifications, 'cuisine_suggestion_resolved', {})).toBe(
      'Sua sugestão de cozinha foi analisada',
    )
    expect(renderNotification(enUS.notifications, 'cuisine_suggestion_resolved', {})).toBe(
      'Your cuisine suggestion was reviewed',
    )
  })

  it('recipe_moderated → mensagem genérica localizada (sem interpolação de ator)', () => {
    expect(renderNotification(ptBR.notifications, 'recipe_moderated', {})).toBe(
      'Uma receita sua foi removida da descoberta por um moderador',
    )
    expect(renderNotification(enUS.notifications, 'recipe_moderated', {})).toBe(
      'One of your recipes was removed from discovery by a moderator',
    )
  })

  it('image_moderated → mensagem genérica localizada (sem interpolação de ator)', () => {
    expect(renderNotification(ptBR.notifications, 'image_moderated', {})).toBe(
      'Uma imagem sua foi moderada',
    )
    expect(renderNotification(enUS.notifications, 'image_moderated', {})).toBe(
      'One of your images was moderated',
    )
  })

  it('account_restricted → mensagem genérica localizada (sem interpolação de ator)', () => {
    expect(renderNotification(ptBR.notifications, 'account_restricted', {})).toBe(
      'Sua conta foi restringida (geração de imagem bloqueada)',
    )
    expect(renderNotification(enUS.notifications, 'account_restricted', {})).toBe(
      'Your account was restricted (image generation is blocked)',
    )
  })

  // Eventos N3 de avaliação (#374): review_on_recipe interpola ATOR (o avaliador) + estrelas da nota
  // VIVA; review_moderated é impessoal (sem ator — não expõe o Curador) e mostra as estrelas da nota.
  it('review_on_recipe com ator + nota interpola {name} e {stars} nos dois locales', () => {
    expect(
      renderNotification(ptBR.notifications, 'review_on_recipe', { actorName: 'Ana', rating: 4 }),
    ).toBe('Ana avaliou sua receita (4★)')
    expect(
      renderNotification(enUS.notifications, 'review_on_recipe', { actorName: 'Ana', rating: 4 }),
    ).toBe('Ana rated your recipe (4★)')
  })

  it('review_on_recipe: nome do avaliador contendo o token literal "{stars}" NÃO corrompe a renderização', () => {
    // Nome livre do usuário = "{stars}". Como interpolamos {stars} (confiável) ANTES de {name}, o nome
    // aparece literal e a nota renderiza correta (a ordem inversa deixaria o nome injetar o token).
    expect(
      renderNotification(ptBR.notifications, 'review_on_recipe', { actorName: '{stars}', rating: 4 }),
    ).toBe('{stars} avaliou sua receita (4★)')
    expect(
      renderNotification(enUS.notifications, 'review_on_recipe', { actorName: '{stars}', rating: 4 }),
    ).toBe('{stars} rated your recipe (4★)')
  })

  it('review_on_recipe com ator degradado (soft-deletado, nome null/vazio) usa a variante anônima', () => {
    expect(
      renderNotification(ptBR.notifications, 'review_on_recipe', { actorName: null, rating: 5 }),
    ).toBe('Sua receita recebeu uma avaliação (5★)')
    expect(
      renderNotification(enUS.notifications, 'review_on_recipe', { actorName: '  ', rating: 5 }),
    ).toBe('Your recipe received a rating (5★)')
  })

  it('review_moderated → mensagem impessoal (sem ator) com as estrelas da nota removida, nos dois locales', () => {
    expect(renderNotification(ptBR.notifications, 'review_moderated', { rating: 3 })).toBe(
      'Sua avaliação (3★) foi removida por um moderador',
    )
    expect(renderNotification(enUS.notifications, 'review_moderated', { rating: 3 })).toBe(
      'Your review (3★) was removed by a moderator',
    )
  })

  it('renderStars: 1..5 → "N★"; null/undefined → string vazia (defensivo, PURO)', () => {
    expect(renderStars(1)).toBe('1★')
    expect(renderStars(2)).toBe('2★')
    expect(renderStars(3)).toBe('3★')
    expect(renderStars(4)).toBe('4★')
    expect(renderStars(5)).toBe('5★')
    expect(renderStars(null)).toBe('')
    expect(renderStars(undefined)).toBe('')
  })

  it('isNotificationType aceita os tipos do catálogo e rejeita desconhecidos', () => {
    for (const t of NOTIFICATION_TYPES) expect(isNotificationType(t)).toBe(true)
    expect(isNotificationType('new_follower')).toBe(true)
    expect(isNotificationType('curtida')).toBe(false)
    expect(isNotificationType('')).toBe(false)
  })
})

/**
 * #460: `notificationHref` — alvo clicável PURO por tipo + refs, no locale de quem lê. Fecha o
 * beco-sem-saída (abrir o painel marca tudo como lido). Testa os dois alvos (perfil / detalhe da
 * receita), a degradação (ator/receita ausente → sem link) e os tipos sem alvo natural.
 */
describe('notificationHref (#460) — alvo clicável por tipo', () => {
  const RID = '11111111-1111-4111-8111-111111111111'

  it('new_follower → perfil público do ator /u/<handle> (sem prefixo de locale)', () => {
    expect(notificationHref('new_follower', { actorHandle: 'ana' }, 'pt-BR')).toBe('/u/ana')
    // O locale não prefixa o perfil (o proxy prefixa) — independe do locale do leitor.
    expect(notificationHref('new_follower', { actorHandle: 'ana' }, 'en-US')).toBe('/u/ana')
  })

  it('new_follower com ator degradado (handle null/vazio) → SEM link (texto puro)', () => {
    expect(notificationHref('new_follower', { actorHandle: null }, 'pt-BR')).toBeNull()
    expect(notificationHref('new_follower', { actorHandle: '  ' }, 'pt-BR')).toBeNull()
    expect(notificationHref('new_follower', {}, 'pt-BR')).toBeNull()
  })

  it('eventos de receita → detalhe canônico /{locale}/recipes/<uuid> (308a pro slug)', () => {
    for (const t of ['review_on_recipe', 'review_moderated', 'recipe_moderated', 'image_moderated'] as const) {
      expect(notificationHref(t, { recipeId: RID }, 'pt-BR')).toBe(`/pt-BR/recipes/${RID}`)
      expect(notificationHref(t, { recipeId: RID }, 'en-US')).toBe(`/en-US/recipes/${RID}`)
    }
  })

  it('evento de receita sem recipeId (legado) → SEM link', () => {
    expect(notificationHref('review_on_recipe', { recipeId: null }, 'pt-BR')).toBeNull()
    expect(notificationHref('review_on_recipe', {}, 'pt-BR')).toBeNull()
  })

  it('tipos informativos (sugestão de cozinha / conta restringida) → SEM link', () => {
    expect(notificationHref('cuisine_suggestion_resolved', { recipeId: RID }, 'pt-BR')).toBeNull()
    expect(notificationHref('account_restricted', {}, 'pt-BR')).toBeNull()
  })
})
