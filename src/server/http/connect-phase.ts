/**
 * A falha de rede aconteceu ANTES de o pedido sair (ADR-0055)? Só nesse caso a chamada paga provadamente não
 * foi cobrada: o provedor nunca recebeu o corpo. Fonte ÚNICA da allowlist, usada pelo seam do Claude
 * (`isUnpaidProviderError` e o `fetch` instrumentado do `RealClaudeClient`) e pelo do Gemini
 * (`RealGeminiImageGenerator`).
 *
 * O `fetch` do Node (undici) rejeita com `TypeError: fetch failed` e põe o erro do socket em `cause`, com um
 * `code` constante de biblioteca. Entram só os códigos da fase de CONEXÃO: DNS (`ENOTFOUND`, `EAI_AGAIN`), rota
 * (`ENETUNREACH`, `EHOSTUNREACH`), recusa (`ECONNREFUSED`), o prazo de conectar do undici
 * (`UND_ERR_CONNECT_TIMEOUT`) e a verificação do certificado no handshake TLS (o pedido só é escrito depois
 * dele). Ficam FORA, e portanto cobrados: `ECONNRESET`, `UND_ERR_SOCKET` ("other side closed"), "terminated",
 * `EPIPE`, `ETIMEDOUT` e qualquer abort ou timeout do cliente, porque podem acontecer com o corpo já enviado.
 */
const CONNECT_PHASE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  // Handshake TLS: o certificado do outro lado foi recusado antes de qualquer byte do pedido.
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

/** Profundidade máxima da cadeia de `cause` (o SDK embrulha 2 níveis; o teto só evita laço num ciclo). */
const MAX_CAUSE_DEPTH = 6

/**
 * O erro (ou a cadeia de `cause` dele) mostra uma falha da fase de conexão? Decide o PRIMEIRO nó da cadeia que
 * traz um `code` string; sem nenhum, `false` (na dúvida, cobrado). Um `AggregateError` (o Node tenta IPv4 e IPv6)
 * só conta se TODAS as tentativas dentro dele forem da fase de conexão.
 */
export function isConnectPhaseFailure(err: unknown): boolean {
  let node: unknown = err
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && node !== null && typeof node === 'object'; depth++) {
    const errors = (node as { errors?: unknown }).errors
    if (Array.isArray(errors) && errors.length > 0) return errors.every((e) => isConnectPhaseFailure(e))
    const code = (node as { code?: unknown }).code
    if (typeof code === 'string') return CONNECT_PHASE_CODES.has(code)
    node = (node as { cause?: unknown }).cause
  }
  return false
}
