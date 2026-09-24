import { describe, it, expect, afterEach } from 'vitest'
import {
  FakeBillingProvider,
  type BillingProvider,
} from '@/server/billing/provider'
import { getBillingProvider, setBillingProvider, resetDeps } from '@/server/deps'

/**
 * Seam do PSP (Fase 2 billing, flag-off). Contrato puro — SEM rede, SEM DB, SEM SDK. Garante que o dublê
 * satisfaz `BillingProvider`, que `handleWebhook` normaliza/rejeita eventos, e que `getBillingProvider()`
 * resolve o Fake por default (nenhum PSP real ativado).
 */
describe('FakeBillingProvider', () => {
  // Tipado pela INTERFACE de propósito: o teste exercita o contrato `BillingProvider`, não a classe.
  const provider: BillingProvider = new FakeBillingProvider()

  it('createCheckout devolve uma URL falsa determinística (subscription)', async () => {
    const a = await provider.createCheckout({ userId: 'u1', kind: 'subscription', plan: 'pro' })
    const b = await provider.createCheckout({ userId: 'u1', kind: 'subscription', plan: 'pro' })
    expect(a.checkoutUrl).toBe(b.checkoutUrl) // determinístico
    expect(a.checkoutUrl).toContain('checkout.fake.local')
    expect(a.checkoutUrl).toContain('subscription')
    expect(a.checkoutUrl).toContain('u1')
  })

  it('createCheckout serve o caso de crédito avulso (híbrido)', async () => {
    const { checkoutUrl } = await provider.createCheckout({
      userId: 'u2',
      kind: 'credit',
      creditAmount: 100,
    })
    expect(checkoutUrl).toContain('credit')
    expect(checkoutUrl).toContain('u2')
  })

  it('createCheckout escapa o userId na URL', async () => {
    const { checkoutUrl } = await provider.createCheckout({ userId: 'a/b c', kind: 'credit' })
    expect(checkoutUrl).toContain(encodeURIComponent('a/b c'))
  })

  it('getSubscriptionStatus devolve conta sem assinatura por default', async () => {
    await expect(provider.getSubscriptionStatus('qualquer')).resolves.toEqual({
      plan: 'free',
      status: 'none',
    })
  })

  it('handleWebhook normaliza um envelope de teste válido num BillingFact', async () => {
    await expect(
      provider.handleWebhook({ userId: 'u3', plan: 'pro', status: 'active' }),
    ).resolves.toEqual({ userId: 'u3', plan: 'pro', status: 'active' })
  })

  it('handleWebhook assume status=active quando o payload omite status', async () => {
    await expect(provider.handleWebhook({ userId: 'u4', plan: 'free' })).resolves.toEqual({
      userId: 'u4',
      plan: 'free',
      status: 'active',
    })
  })

  it('handleWebhook retorna null para evento irrelevante/malformado', async () => {
    await expect(provider.handleWebhook(null)).resolves.toBeNull()
    await expect(provider.handleWebhook('ruído')).resolves.toBeNull()
    await expect(provider.handleWebhook({ foo: 'bar' })).resolves.toBeNull()
    await expect(provider.handleWebhook({ userId: '', plan: 'pro' })).resolves.toBeNull()
    await expect(provider.handleWebhook({ userId: 'u5', plan: 'enterprise' })).resolves.toBeNull()
  })
})

describe('getBillingProvider (DI)', () => {
  afterEach(() => resetDeps())

  it('resolve o Fake por default (flag-off, sem PSP real)', () => {
    expect(getBillingProvider()).toBeInstanceOf(FakeBillingProvider)
  })

  it('setBillingProvider injeta um dublê e resetDeps limpa o override', () => {
    const stub: BillingProvider = {
      createCheckout: async () => ({ checkoutUrl: 'https://x' }),
      getSubscriptionStatus: async () => ({ plan: 'pro', status: 'active' }),
      handleWebhook: async () => null,
    }
    setBillingProvider(stub)
    expect(getBillingProvider()).toBe(stub)
    resetDeps()
    expect(getBillingProvider()).toBeInstanceOf(FakeBillingProvider)
  })
})
