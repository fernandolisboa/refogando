/**
 * Versão publicada dos textos legais e o aviso de mudança no app (ADR-0051). PURO: sem React, sem DB.
 *
 * `DATA_PUBLICACAO_TERMOS_V1` é a FONTE ÚNICA da data em que os Termos de Uso v1 e a Política v3.1 foram
 * publicados (o dia do merge do PR). As strings i18n a importam (`termos.rodapeData`, `termos.s10Historico`,
 * `privacidade.rodapeData` e a linha v3.1 de `privacidade.s10Historico`, `seusDireitos.rodapeData`), e o aviso
 * a usa para decidir o público. Se o merge escorregar de dia, troque SÓ aqui.
 *
 * O aviso (`LegalChangeNotice`, no layout) é o mecanismo do item 10 dos Termos: mudança relevante só vale 15
 * dias depois de avisar no app. Cada mudança nova ganha uma `AVISO_LEGAL_VERSAO` nova (a chave do
 * localStorage muda junto, então quem dispensou o aviso anterior vê o novo) e o seu próprio público.
 */

/** Dia da publicação dos Termos v1 e da Política v3.1 (AAAA-MM-DD, horário de Brasília). */
export const DATA_PUBLICACAO_TERMOS_V1 = '2026-10-23'

/** Versão do aviso em vigor: o que a pessoa precisa ler. Trocar a versão faz o aviso voltar para todos. */
export const AVISO_LEGAL_VERSAO = 'termos-v1+politica-v3.1'

const AVISO_LEGAL_STORAGE_PREFIX = 'refogando:aviso-legal:'

/** Chave do localStorage que lembra o "Entendi" — por versão e por conta (um navegador pode ter várias). */
export function avisoLegalStorageKey(userId: string, versao: string = AVISO_LEGAL_VERSAO): string {
  return `${AVISO_LEGAL_STORAGE_PREFIX}${versao}:${userId}`
}

/**
 * Público da v1: contas criadas ANTES do dia da publicação (meia-noite de Brasília, UTC−3). Quem se cadastrou
 * depois já viu a linha dos Termos no cadastro. As contas criadas no próprio dia, antes do deploy, ficam de
 * fora: janela de horas, aceita no ADR-0051 (a alternativa, o dia seguinte, avisaria também quem acabou de
 * aceitar os Termos).
 */
export const AVISO_LEGAL_CONTAS_ANTES_DE_MS = Date.parse(`${DATA_PUBLICACAO_TERMOS_V1}T00:00:00-03:00`)

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
