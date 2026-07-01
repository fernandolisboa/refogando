import { describe, expect, it } from 'vitest'
import {
  isNotificationType,
  renderNotification,
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

  it('tipo ainda não implementado nesta fatia cai no texto genérico', () => {
    expect(renderNotification(ptBR.notifications, 'recipe_moderated', {})).toBe(
      'Você tem uma nova notificação',
    )
    expect(renderNotification(enUS.notifications, 'account_restricted', {})).toBe(
      'You have a new notification',
    )
  })

  it('isNotificationType aceita os tipos do catálogo e rejeita desconhecidos', () => {
    for (const t of NOTIFICATION_TYPES) expect(isNotificationType(t)).toBe(true)
    expect(isNotificationType('new_follower')).toBe(true)
    expect(isNotificationType('curtida')).toBe(false)
    expect(isNotificationType('')).toBe(false)
  })
})
