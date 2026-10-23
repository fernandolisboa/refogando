/**
 * Encerramento de conta PELA EQUIPE (#606, ADR-0051 P1 e P3): o admin elimina, pelo Console → Usuários, a conta de
 * alguém com menos de 16 anos (Termos, item 2) ou encerrada por violação grave ou repetida dos Termos (item 8). É uma
 * decisão do controlador, não um pedido do titular: o registro vai para `account_closure` (motivo, se o conteúdo
 * público saiu, se a pessoa foi avisada por e-mail, quem decidiu), nunca para a auditoria DSAR. PURO: sem DB, sem IO.
 *
 * NOMES: "encerramento" é a DECISÃO da equipe (Termos, item 8: "encerrar a conta"; a tabela `account_closure`, o
 * `closeAccountByAdmin`); "eliminação" é o EFEITO, o mesmo núcleo do self-service (`eraseAccount`, LGPD art. 18, VI):
 * anonimizar e apagar o privado. Todo encerramento elimina; nem toda eliminação é encerramento. O botão do Console
 * diz "Eliminar conta" porque é o que o admin vê acontecer.
 *
 * O motivo é uma LISTA FECHADA (vira o pgEnum `account_closure_reason`): nada de texto livre, para o registro não
 * guardar dado pessoal além do fato. Trocar a lista é migração e muda o diálogo do Console e os Termos.
 */
export const ACCOUNT_CLOSURE_REASONS = ['menor_16', 'violacao_grave'] as const

export type AccountClosureReason = (typeof ACCOUNT_CLOSURE_REASONS)[number]

/** Guard de borda: um valor cru (corpo da requisição) é um motivo da lista? */
export function isAccountClosureReason(v: unknown): v is AccountClosureReason {
  return typeof v === 'string' && (ACCOUNT_CLOSURE_REASONS as readonly string[]).includes(v)
}

/**
 * As receitas públicas e as avaliações saem junto só na conta de menor de 16, e SEMPRE (Termos, item 2: "eliminamos a
 * conta e o que ela publicou"): a licença de quem é absolutamente incapaz é nula (Código Civil, arts. 3º e 166, I). Na
 * violação grave o conteúdo público fica anonimizado, como em toda eliminação (o que foi retirado pela moderação já
 * saiu pela fila).
 */
export function canRemovePublicContent(reason: AccountClosureReason): boolean {
  return reason === 'menor_16'
}

/**
 * Só a violação grave leva o e-mail de encerramento (Termos, item 8). No menor de 16 a pessoa já foi avisada pelo
 * e-mail da conta antes (P1) e o aviso de encerramento não é prometido.
 */
export function closureEmailApplies(reason: AccountClosureReason): boolean {
  return reason === 'violacao_grave'
}

/**
 * Confirmação digitada: o @ da conta. Aceita com ou sem o `@` e ignora espaços nas pontas e maiúsculas (o handle é
 * sempre minúsculo), mas o resto tem de ser igual.
 */
export function confirmsHandle(typed: string, handle: string): boolean {
  const t = typed.trim().replace(/^@/, '').toLowerCase()
  return t.length > 0 && t === handle.toLowerCase()
}
