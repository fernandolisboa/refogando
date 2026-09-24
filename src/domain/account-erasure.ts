/**
 * Kernel de domínio da ELIMINAÇÃO de conta (issue #401, GAP-6; LGPD Art. 18 VI + Art. 16;
 * `docs/legal/takedown-e-remocao-titular.md` §6/§8). PURO/determinístico — sem DB, sem IO.
 *
 * A eliminação self-service do titular A é CONSERVADORA (bloqueio lógico + anonimização, NÃO um
 * hard-delete): a PII do usuário (email/name/handle/avatar/bio/links/locale) é substituída por uma
 * forma ANONIMIZADA e ESTÁVEL derivada do próprio `id` interno (opaco, nunca é a PII), e a conta é
 * bloqueada (`deletedAt`) + carimbada (`anonymizedAt`). O CONTEÚDO do usuário (receitas, avaliações
 * das quais terceiros dependem) é MANTIDO, atribuído à identidade anonimizada — nunca apagado em
 * cascata (ver o PR / doc §6 para a disposição de conteúdo e alternativas).
 *
 * Por que derivar do `id`:
 *  - ESTÁVEL: o mesmo usuário sempre gera os mesmos valores (idempotente — reprocessar não muda nada).
 *  - ÚNICO: o `id` é uuid único ⇒ email/handle anonimizados não colidem com a UNIQUE de outra conta.
 *  - SEM PII: o uuid interno não carrega dado pessoal (≠ derivar do email/nome, que vazaria a PII).
 */

/** Nome de exibição da conta eliminada. Constante neutra (não é PII — substitui o nome real). */
export const ERASED_ACCOUNT_NAME = 'Usuário removido'

/**
 * Domínio de e-mail SENTINELA das contas eliminadas. `.invalid` é um TLD RESERVADO (RFC 2606): nunca
 * resolve nem entrega — garante que o e-mail anonimizado não é endereçável (não vaza para envio).
 */
const ERASED_EMAIL_DOMAIN = 'deleted.refogando.invalid'

/** Identidade anonimizada e estável de uma conta eliminada, derivada só do `id` opaco. */
export type ErasedIdentity = {
  email: string
  name: string
  handle: string
}

/**
 * Deriva a identidade anonimizada ESTÁVEL de um usuário a partir do seu `id` interno.
 *  - email:  `deleted-<id>@deleted.refogando.invalid` — único (id é único) e não-endereçável.
 *  - handle: `removido-<id>` — o uuid é [a-z0-9-] (hex + hífens), então o handle continua no formato
 *            público válido e é único; o perfil de uma conta eliminada fica escondido (gate deletedAt),
 *            mas manter um handle válido evita qualquer surpresa em índices/URLs.
 *  - name:   constante neutra `Usuário removido`.
 */
export function erasedIdentity(userId: string): ErasedIdentity {
  return {
    email: `deleted-${userId}@${ERASED_EMAIL_DOMAIN}`,
    name: ERASED_ACCOUNT_NAME,
    handle: `removido-${userId}`,
  }
}
