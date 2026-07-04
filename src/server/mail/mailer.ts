/**
 * Seam ÚNICO e mockável para ENVIO DE E-MAIL transacional (#413). Espelha os outros seams da fundação
 * (`web-search-provider.ts`, `embedder.ts`): interface + impl REAL + dublê FAKE no MESMO arquivo, injetado
 * via `getMailer()/setMailer()` em `deps.ts`.
 *
 * Uso v1: ALERTAR o Encarregado (DPO) quando um ticket de takedown/DSAR entra em nível 'red'/'overdue'
 * (`notifyDpoRedTickets`) e, best-effort, avisar da chegada de um novo ticket. O provedor é o Brevo
 * (`api.brevo.com/v3/smtp/email`) — detalhe trocável atrás do seam, sem SDK (só `fetch` nativo).
 *
 * GATE HUMANO de deploy (como a `WEB_SEARCH_API_KEY` / a Gemini key): sem `BREVO_API_KEY` OU sem
 * `DSAR_MAIL_FROM` (remetente verificado) OU sem destinatário, o Real se comporta como DESLIGADO (retorna
 * `{ sent: false }` SEM tocar a rede, nunca lança). A feature só "acende" quando a credencial existe.
 */

/** Um e-mail transacional a enviar. `html` é opcional (o texto puro basta para os alertas de SLA). */
export type MailInput = {
  /** Destinatário (o e-mail do Encarregado, `DSAR_DPO_EMAIL`). */
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
}

/** Endpoint transacional do Brevo (v3). Provedor é detalhe trocável atrás do seam. */
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
/** Timeout por requisição: o alerta é best-effort — não pode pendurar o cron. */
const BREVO_TIMEOUT_MS = 8_000

/**
 * Impl REAL — Brevo transactional email (#413, gate humano de deploy). `BREVO_API_KEY` e `DSAR_MAIL_FROM`
 * são lidas PREGUIÇOSAMENTE no uso (como `RealWebSearchProvider`); ausentes ⇒ DESLIGADO (`{ sent: false }`,
 * sem tocar a rede). NUNCA lança: qualquer erro (rede/timeout/HTTP/erro do provedor) vira `{ sent: false }`.
 */
export class RealBrevoMailer implements Mailer {
  async sendDpoAlert(input: MailInput): Promise<{ sent: boolean }> {
    // Fail-closed: sem credencial, sem remetente verificado OU sem destinatário ⇒ no-op. NÃO toca a rede.
    const key = process.env.BREVO_API_KEY
    const from = process.env.DSAR_MAIL_FROM
    const to = input.to?.trim()
    if (!key || !from || !to) return { sent: false }

    try {
      const res = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': key,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: from },
          to: [{ email: to }],
          subject: input.subject,
          textContent: input.text,
          ...(input.html ? { htmlContent: input.html } : {}),
        }),
        signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
      })
      // Não-2xx (401/4xx/5xx) ⇒ degrada sem lançar, sem vazar corpo. O ticket segue não-notificado.
      if (!res.ok) return { sent: false }
      return { sent: true }
    } catch {
      // Rede, DNS, timeout (AbortSignal), TLS — tudo vira { sent: false }.
      return { sent: false }
    }
  }
}

/**
 * Dublê determinístico para testes: NÃO toca a rede, guarda os enviados em `sent` (lista pública) para
 * asserts e retorna `{ sent: true }`. Cada teste injeta UMA instância via `setMailer`.
 */
export class FakeMailer implements Mailer {
  /** E-mails "enviados" nesta instância, na ordem — inspecionável pelos testes. */
  readonly sent: MailInput[] = []

  async sendDpoAlert(input: MailInput): Promise<{ sent: boolean }> {
    this.sent.push(input)
    return { sent: true }
  }
}
