/**
 * Guarda anti open-redirect (#308): devolve `raw` SÓ se for um caminho INTERNO seguro (mesma origem,
 * relativo) — começa com UMA `/`, não `//` (protocol-relative → outra origem), sem `\` (alguns browsers
 * normalizam pra `/`), sem control chars, e dentro de um teto de tamanho. Qualquer outra coisa → `/`.
 *
 * Usado pelo `?returnTo=` do sign-in: um atacante não pode fazer o login redirecionar pra um host
 * externo (phishing) nem pra um esquema (`javascript:`); só caminhos da própria app passam.
 */
/**
 * #470 (B2) — o destino pós-confirmação vindo do LOGIN. Passar `callbackURL` ao `/sign-in/email` faria o cliente
 * do Better Auth dar um redirect de página inteira no sucesso (`redirect: true` + `url`), então a tela de entrar
 * manda o destino neste header; o servidor o lê (sempre por `safeInternalPath`) só para montar o link de
 * confirmação reenviado no login. Aqui (módulo puro) porque cliente e servidor o compartilham.
 */
export const RETURN_TO_HEADER = 'x-refogando-return-to'

export function safeInternalPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 512) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (raw.includes('\\')) return '/'
  if ([...raw].some((ch) => ch.charCodeAt(0) < 0x20)) return '/'
  return raw
}
