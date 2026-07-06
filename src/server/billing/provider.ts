/**
 * Seam ÚNICO e mockável para o PROVEDOR DE PAGAMENTO (PSP) — Fase 2 de billing, ainda FLAG-OFF.
 *
 * Espelha os outros seams da fundação (`mail/mailer.ts`, `web-search/web-search-provider.ts`): interface +
 * dublê FAKE no MESMO arquivo, injetado via `getBillingProvider()/setBillingProvider()` em `deps.ts`. A
 * escolha concreta de gateway (Mercado Pago, Asaas, Stripe, …) fica ADIADA e trocável atrás desta
 * interface — a integração real será um adapter fino que só implementa `BillingProvider`. Ver decisão em
 * `docs/reports/fase2-billing-decisao.md` §6 item 4.
 *
 * FONTE DA VERDADE: o plano efetivo de um Usuário é `users.plan` (coluna NOT NULL default 'free', eixo
 * COMERCIAL ortogonal ao `role`). O provider NÃO é dono do estado — ele só EMITE FATOS do domínio
 * (`BillingFact`) que uma camada de aplicação futura reconcilia para dentro de `users.plan`. Ler o status
 * aqui é conveniência/consulta; a decisão de teto (`recipe-gen-config`/`image-gen-config`/…) continua
 * lendo `users.plan`.
 *
 * Modelo HÍBRIDO (assinatura + crédito avulso): `createCheckout` recebe uma entrada NEUTRA que serve os
 * dois casos (`kind: 'subscription' | 'credit'`), pra não travar a estratégia comercial nesta fase.
 *
 * NADA nesta fatia toca a rede, ativa cobrança ou expõe UI. Sem SDK, sem rota real de checkout/webhook.
 */
import { isPlan, type Plan } from '@/domain/plan'

/** Estado de assinatura normalizado do domínio (independente do vocabulário do PSP). */
export type SubscriptionStatus = 'active' | 'none' | 'past_due' | 'canceled'

/**
 * Entrada NEUTRA de checkout — serve tanto assinatura recorrente quanto compra avulsa de crédito (híbrido).
 * A camada de aplicação decide `kind`; o adapter do PSP traduz para a chamada específica do gateway.
 */
export type CheckoutInput = {
  /** Dono da compra (id do Usuário no nosso domínio). */
  userId: string
  /** O que está sendo comprado: assinatura recorrente OU pacote avulso de crédito. */
  kind: 'subscription' | 'credit'
  /** Plano-alvo da assinatura. Relevante quando `kind === 'subscription'` (hoje só existe 'pro'). */
  plan?: Plan
  /** Quantidade de crédito comprado (unidade do nosso domínio). Relevante quando `kind === 'credit'`. */
  creditAmount?: number
  /** URL de retorno após sucesso (opcional; o adapter pode ter um default). */
  successUrl?: string
  /** URL de retorno após cancelamento (opcional). */
  cancelUrl?: string
}

/** Sessão de checkout aberta pelo PSP — a única coisa que a UI precisa é para onde redirecionar. */
export type CheckoutSession = {
  /** URL hospedada pelo PSP para o Usuário concluir o pagamento. */
  checkoutUrl: string
}

/**
 * FATO do domínio destilado de um evento do PSP (`handleWebhook`). É o que a camada de aplicação usa para
 * reconciliar `users.plan`. Deliberadamente pequeno: quem é, qual plano e em que estado ficou.
 */
export type BillingFact = {
  userId: string
  plan: Plan
  status: SubscriptionStatus
}

export interface BillingProvider {
  /**
   * Abre uma sessão de checkout no PSP e devolve a URL para redirecionar o Usuário. NÃO muda `users.plan`
   * — a mudança só vale quando o pagamento é confirmado, via `handleWebhook`.
   */
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>

  /**
   * Consulta o estado de assinatura do Usuário no PSP. É CONSULTA — a fonte da verdade do teto continua
   * sendo `users.plan`. O default de conta sem assinatura é `{ plan: 'free', status: 'none' }`.
   */
  getSubscriptionStatus(userId: string): Promise<{ plan: Plan; status: SubscriptionStatus }>

  /**
   * Normaliza um evento cru do PSP num `BillingFact` do domínio. Retorna `null` para evento IRRELEVANTE
   * (ruído, tipo que não afeta plano, payload malformado). Um adapter real DEVE verificar `signature`
   * antes de confiar no payload; o fake ignora a assinatura por ser determinístico e offline.
   */
  handleWebhook(payload: unknown, signature?: string): Promise<BillingFact | null>
}

/** Prefixo determinístico das URLs de checkout do dublê — obviamente falso, nunca navegável em produção. */
const FAKE_CHECKOUT_BASE = 'https://checkout.fake.local'

/** Guard estreito para o envelope de webhook de TESTE que o fake reconhece. Sem libs, sem rede. */
function isFakeWebhookEnvelope(
  payload: unknown,
): payload is { userId: unknown; plan: unknown; status: unknown } {
  return typeof payload === 'object' && payload !== null && 'userId' in payload && 'plan' in payload
}

/**
 * Dublê determinístico do PSP — o default flag-off (`getBillingProvider()` o devolve enquanto não existe
 * adapter real). SEM I/O externo: `createCheckout` sintetiza uma URL falsa, `getSubscriptionStatus`
 * devolve o estado de conta sem assinatura, e `handleWebhook` parseia um envelope de teste simples.
 */
export class FakeBillingProvider implements BillingProvider {
  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    // URL sintética e estável (determinística a partir da entrada) — nada de rede.
    return {
      checkoutUrl: `${FAKE_CHECKOUT_BASE}/${input.kind}/${encodeURIComponent(input.userId)}`,
    }
  }

  // Assinatura mais estreita que a interface (sem params): satisfaz `BillingProvider` e evita param morto.
  async getSubscriptionStatus(): Promise<{ plan: Plan; status: SubscriptionStatus }> {
    // Conta sem assinatura = comportamento de hoje (todo mundo é `free`).
    return { plan: 'free', status: 'none' }
  }

  // `signature` é ignorada pelo dublê (offline/determinístico); um adapter real DEVE verificá-la.
  async handleWebhook(payload: unknown): Promise<BillingFact | null> {
    // Reconhece um envelope de teste mínimo `{ userId, plan, status? }`. Qualquer outra coisa é ruído.
    if (!isFakeWebhookEnvelope(payload)) return null

    const { userId, plan, status } = payload
    if (typeof userId !== 'string' || userId.length === 0) return null
    if (typeof plan !== 'string' || !isPlan(plan)) return null

    // `status` é opcional no payload de teste: default = 'active' (o webhook típico confirma um pagamento).
    const normalized: SubscriptionStatus = isSubscriptionStatus(status) ? status : 'active'
    return { userId, plan, status: normalized }
  }
}

/** Guard puro do vocabulário de estado — mantém `handleWebhook` fechado a valores fora do domínio. */
function isSubscriptionStatus(v: unknown): v is SubscriptionStatus {
  return v === 'active' || v === 'none' || v === 'past_due' || v === 'canceled'
}
