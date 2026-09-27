/**
 * Seam ÚNICO e mockável para ENVIO DE E-MAIL transacional (#413). Espelha os outros seams da fundação
 * (`web-search-provider.ts`, `embedder.ts`): interface + impl REAL + dublê FAKE no MESMO arquivo, injetado
 * via `getMailer()/setMailer()` em `deps.ts`.
 *
 * Uso v1: ALERTAR o Encarregado (DPO) quando um ticket de takedown/DSAR entra em nível 'red'/'overdue'
 * (`notifyDpoRedTickets`) e, best-effort, avisar da chegada de um novo ticket. O provedor é o Resend
 * (`POST api.resend.com/emails`) — detalhe trocável atrás do seam, sem SDK (só `fetch` nativo).
 *
 * Uso v2 (#469): e-mails de CONTA ao próprio Usuário (link de redefinição de senha) via
 * `sendAccountEmail`. Remetente próprio `AUTH_MAIL_FROM` (caixa "não-responda", separada da do Encarregado);
 * sem ela, cai no `DSAR_MAIL_FROM` — domínio já verificado no Resend — para o fluxo funcionar sem env nova.
 *
 * GATE HUMANO de deploy (como a `WEB_SEARCH_API_KEY` / a Gemini key): sem `RESEND_API_KEY` OU sem
 * remetente verificado OU sem destinatário, o Real se comporta como DESLIGADO (retorna
 * `{ sent: false }` SEM tocar a rede, nunca lança). A feature só "acende" quando a credencial existe.
 */

/** Um e-mail transacional a enviar. `html` é opcional (o texto puro basta para os alertas de SLA). */
export type MailInput = {
  /** Destinatário (o Encarregado, `DSAR_DPO_EMAIL`, nos alertas; o próprio Usuário nos e-mails de conta). */
  to: string
  /** Assunto — curto, sem PII de terceiros. */
  subject: string
  /** Corpo em texto puro (o essencial para agir: protocolo/idade/tipo). */
  text: string
  /** Corpo em HTML (opcional). */
  html?: string
}

export interface Mailer {
  /**
   * Envia um alerta ao Encarregado. NUNCA lança: falta de credencial / remetente / destinatário, erro de
   * rede / timeout / HTTP não-ok ⇒ `{ sent: false }` (degradação graciosa — o alerta de estado no ticket
   * segue de pé; o cron reenvia no próximo dia). `{ sent: true }` só quando o provedor aceitou o envio.
   */
  sendDpoAlert(input: MailInput): Promise<{ sent: boolean }>
  /**
   * Envia um e-mail de CONTA ao próprio Usuário (#469 — link de redefinição de senha). Mesma garantia:
   * NUNCA lança; sem credencial / remetente / destinatário ou erro do provedor ⇒ `{ sent: false }`.
   */
  sendAccountEmail(input: MailInput): Promise<{ sent: boolean }>
  /**
   * Os e-mails de CONTA podem de fato sair? (#470) — credencial + remetente presentes. NÃO toca a rede nem
   * garante entrega; é o que decide se o cadastro EXIGE confirmação de email (`src/lib/auth.ts`): sem canal de
   * e-mail, exigir a confirmação trancaria toda conta nova.
   */
  canSendAccountEmail(): boolean
}

/** Endpoint de envio do Resend. Provedor é detalhe trocável atrás do seam. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'
/** Timeout por requisição: o alerta é best-effort — não pode pendurar o cron. */
const RESEND_TIMEOUT_MS = 8_000

/**
 * Impl REAL — Resend (#413, gate humano de deploy). `RESEND_API_KEY` e `DSAR_MAIL_FROM`
 * são lidas PREGUIÇOSAMENTE no uso (como `RealWebSearchProvider`); ausentes ⇒ DESLIGADO (`{ sent: false }`,
 * sem tocar a rede). NUNCA lança: qualquer erro (rede/timeout/HTTP/erro do provedor) vira `{ sent: false }`.
 */
export class RealResendMailer implements Mailer {
  async sendDpoAlert(input: MailInput): Promise<{ sent: boolean }> {
    return sendViaResend(process.env.DSAR_MAIL_FROM, input)
  }

  async sendAccountEmail(input: MailInput): Promise<{ sent: boolean }> {
    return sendViaResend(accountMailFrom(), input)
  }

  /** Lido PREGUIÇOSAMENTE (na chamada), como os envios: mesma regra de "desligado" do `sendViaResend`. */
  canSendAccountEmail(): boolean {
    return Boolean(process.env.RESEND_API_KEY && accountMailFrom())
  }
}

/** Remetente dos e-mails de conta. `||` (não `??`): env vazia no painel da Vercel chega como '' e deve cair no fallback. */
function accountMailFrom(): string | undefined {
  return process.env.AUTH_MAIL_FROM || process.env.DSAR_MAIL_FROM || undefined
}

/**
 * POST único ao Resend. `from` resolvido pelo chamador (cada tipo de e-mail tem seu remetente) e repassado COMO
 * ESTÁ: o Resend aceita o endereço puro (`nao-responda@dominio`) ou `"Nome <nao-responda@dominio>"` — o domínio
 * precisa estar verificado na conta. Sucesso = 200 com `{ id }`; basta o `res.ok`.
 */
async function sendViaResend(from: string | undefined, input: MailInput): Promise<{ sent: boolean }> {
  // Fail-closed: sem credencial, sem remetente verificado OU sem destinatário ⇒ no-op. NÃO toca a rede.
  const key = process.env.RESEND_API_KEY
  const to = input.to?.trim()
  if (!key || !from || !to) return { sent: false }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    })
    // Não-2xx (401/403 domínio não verificado/422/429/5xx) ⇒ degrada sem lançar. Loga SÓ o status — nada do
    // corpo da resposta nem do destinatário (sem PII).
    if (!res.ok) {
      console.warn(`[mail] Resend recusou o envio: HTTP ${res.status}`)
      return { sent: false }
    }
    return { sent: true }
  } catch {
    // Rede, DNS, timeout (AbortSignal), TLS — tudo vira { sent: false }.
    return { sent: false }
  }
}

/**
 * Dublê determinístico para testes: NÃO toca a rede, guarda os enviados em `sent` (lista pública) para
 * asserts e retorna `{ sent: true }`. Cada teste injeta UMA instância via `setMailer`.
 */
export class FakeMailer implements Mailer {
  /** Alertas ao Encarregado "enviados" nesta instância, na ordem — inspecionável pelos testes. */
  readonly sent: MailInput[] = []
  /** E-mails de conta (#469) "enviados" nesta instância, na ordem. Lista à parte: não polui `sent`. */
  readonly accountSent: MailInput[] = []
  /**
   * #470 — o que `canSendAccountEmail` responde. Default `true` (e-mail de conta "configurado", confirmação de
   * email ligada); `new FakeMailer({ accountEmailConfigured: false })` simula produção sem Resend.
   */
  accountEmailConfigured: boolean

  constructor(options: { accountEmailConfigured?: boolean } = {}) {
    this.accountEmailConfigured = options.accountEmailConfigured ?? true
  }

  async sendDpoAlert(input: MailInput): Promise<{ sent: boolean }> {
    this.sent.push(input)
    return { sent: true }
  }

  async sendAccountEmail(input: MailInput): Promise<{ sent: boolean }> {
    this.accountSent.push(input)
    return { sent: true }
  }

  canSendAccountEmail(): boolean {
    return this.accountEmailConfigured
  }
}
