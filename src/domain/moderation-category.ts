/**
 * Categoria do motivo de uma retirada pela curadoria (#609, ADR-0028 adendo, ADR-0051). LISTA FECHADA: o Curador
 * escolhe uma ao retirar uma receita, uma avaliação ou uma imagem, e o dono a vê na notificação (localizada no
 * locale de quem lê, como o resto da notificação). O texto livre do Curador (`moderation_reason`/`moderated_reason`)
 * continua obrigatório: não aparece na notificação, mas é dado da própria pessoa e sai na exportação dos dados dela
 * (`account-export.ts`), então não deve citar terceiros (quem denunciou, por exemplo). Quem decidiu não chega ao dono.
 *
 * Cada categoria aponta para uma regra que os Termos de Uso afirmam (seção `termos` de `src/i18n/messages/`):
 *  - `direitos_autorais` → item 5 (só publique o que é seu; não copie texto nem foto de outras pessoas), item 7
 *    (violar direitos autorais) e item 4 (imagem que imita a marca ou o trabalho de outra pessoa).
 *  - `pessoa_real` → item 4 (imagem de pessoa real identificável) e item 7 (direitos de imagem e de privacidade;
 *    coletar dados de outras pessoas).
 *  - `conteudo_ofensivo` → item 7 (ofensivo, discriminatório, de assédio ou de ódio) e item 4 (imagem de ódio).
 *  - `spam` → item 7 (spam, propaganda, golpes).
 *  - `conteudo_ilegal` → item 7 (conteúdo ilegal) e item 8 (retirada do manifestamente ilegal).
 *  - `outro` → outra regra dos Termos; sempre por último. Cobre, por exemplo, a imagem sexual ou violenta pedida à
 *    IA (item 4): os Termos só proíbem esse conteúdo nos pedidos de imagem, não no que a pessoa escreve ou envia,
 *    então ele não vira categoria própria.
 *
 * Os códigos são snake_case ASCII e viram o pgEnum `moderation_category` (`notification.moderation_category`).
 * Trocar a lista é migração (ADD VALUE; remover valor pede recriar o tipo) e muda os rótulos de
 * `categoriaModeracaoDono` e `categoriaModeracaoLabel` junto. Mudar o que uma categoria quer dizer pede revisar o item
 * 8 dos Termos.
 */
export const MODERATION_CATEGORIES = [
  'direitos_autorais',
  'pessoa_real',
  'conteudo_ofensivo',
  'spam',
  'conteudo_ilegal',
  'outro',
] as const

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number]

/** Guard de borda: um valor cru (corpo da requisição, linha do banco) é uma categoria da lista? */
export function isModerationCategory(v: unknown): v is ModerationCategory {
  return typeof v === 'string' && (MODERATION_CATEGORIES as readonly string[]).includes(v)
}
