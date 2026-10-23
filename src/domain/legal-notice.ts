/**
 * Versão publicada dos textos legais e o aviso de mudança no app (ADR-0051). PURO: sem React, sem DB.
 *
 * `DATA_PUBLICACAO_TERMOS_V1` é a FONTE ÚNICA, no código, da data em que os Termos de Uso v1 e a Política v3.1
 * foram publicados (o dia do merge do PR). As strings i18n a importam (a linha v1 de `termos.s10Historico` e a
 * linha v3.1 de `privacidade.s10Historico`), e o aviso a usa para decidir o público. Depois do merge ela fica
 * CONGELADA: cada versão seguinte ganha constante própria, e os rodapés usam a da versão mais nova de cada texto
 * (hoje `DATA_POLITICA_V3_2` e `DATA_TERMOS_V1_2`).
 *
 * O aviso (`LegalChangeNotice`, no layout) é o mecanismo do item 10 dos Termos: mudança relevante só vale 15
 * dias depois de avisar no app. Cada mudança RELEVANTE ganha uma `AVISO_LEGAL_VERSAO` nova (a chave do
 * localStorage muda junto, então quem dispensou o aviso anterior vê o novo) e o seu próprio público. Mudança a
 * favor da pessoa ou só de redação ganha versão e data próprias, mas não aviso (critério no ADR-0051, #605).
 */

/** Dia da publicação dos Termos v1 e da Política v3.1 (AAAA-MM-DD): o dia do merge em UTC, como as outras datas dos textos legais. */
export const DATA_PUBLICACAO_TERMOS_V1 = '2026-10-23'

/**
 * Termos v1.1 (#605): a denúncia de receita pública passa a ser pelo botão Reportar (item 8). A mudança é a favor
 * do usuário (uma via a mais, nada retirado), então não é "relevante" no sentido do item 10: vale na publicação, sem o
 * aviso de 15 dias e sem trocar `AVISO_LEGAL_VERSAO`. O dia do merge em UTC; congelada depois do merge.
 */
export const DATA_TERMOS_V1_1 = '2026-10-23'

/**
 * Política v3.2 e Termos v1.2 (#599): a fila de revisão de imagens da curadoria passa a mostrar só imagens de receitas
 * publicadas, então o conteúdo privado deixa de ter essa exceção (política item 3.3 e seção 4, Termos item 5). É
 * menos tratamento, a favor da pessoa: vale na publicação, sem aviso e sem trocar `AVISO_LEGAL_VERSAO`. O dia do
 * merge em UTC; congelada depois do merge. É a data dos rodapés da política e de Seus direitos; a dos Termos v1.2 é
 * a mesma (`DATA_TERMOS_V1_2`), porque as duas saem no mesmo PR.
 */
export const DATA_POLITICA_V3_2 = '2026-10-23'
export const DATA_TERMOS_V1_2 = DATA_POLITICA_V3_2

/** Versão do aviso em vigor: o que a pessoa precisa ler. Trocar a versão faz o aviso voltar para todos. */
export const AVISO_LEGAL_VERSAO = 'termos-v1+politica-v3.1'

const AVISO_LEGAL_STORAGE_PREFIX = 'refogando:aviso-legal:'

/** Chave do localStorage que lembra o "Entendi" — por versão e por conta (um navegador pode ter várias). */
export function avisoLegalStorageKey(userId: string, versao: string = AVISO_LEGAL_VERSAO): string {
  return `${AVISO_LEGAL_STORAGE_PREFIX}${versao}:${userId}`
}

/** Um dia em ms. Brasília não tem horário de verão desde 2019, então o dia tem sempre 24 h em UTC−3. */
const UM_DIA_MS = 24 * 60 * 60 * 1000

/**
 * Público da v1: contas criadas ANTES do começo do dia SEGUINTE ao da publicação — meia-noite de Brasília
 * (UTC−3) que abre o dia depois de `DATA_PUBLICACAO_TERMOS_V1`. Como a data é a do merge em UTC, esse corte cai
 * sempre depois do deploy, e entra também quem se cadastrou antes dele no mesmo dia (e não viu a linha dos
 * Termos). O custo, aceito no ADR-0051 (e): quem se cadastra nesse dia depois do deploy também vê o aviso, de algo
 * que acabou de aceitar.
 */
export const AVISO_LEGAL_CONTAS_ANTES_DE_MS = Date.parse(`${DATA_PUBLICACAO_TERMOS_V1}T00:00:00-03:00`) + UM_DIA_MS

/**
 * O aviso aparece? Só com sessão, conta anterior ao corte e sem "Entendi" guardado. `dismissed` `undefined`
 * = storage ilegível (navegação privada, bloqueio): mostra, e o "Entendi" vale só até a próxima carga.
 * `createdAt` ilegível ⇒ não mostra (sem a data não dá para saber se a pessoa já viu os Termos no cadastro).
 */
export function shouldShowLegalNotice(input: {
  authed: boolean
  createdAt: Date | string | number | null | undefined
  dismissed: boolean | undefined
  cutoffMs?: number
}): boolean {
  const { authed, createdAt, dismissed, cutoffMs = AVISO_LEGAL_CONTAS_ANTES_DE_MS } = input
  if (!authed || dismissed === true) return false
  if (createdAt == null) return false
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return false
  return created < cutoffMs
}
