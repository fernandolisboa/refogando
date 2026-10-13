/**
 * Kernel PURO das Restrições alimentares SALVAS no perfil (ADR-0041) — sem DB, sem I/O. O Usuário guarda
 * uma lista de Restrições (o mesmo vocabulário `RESTRICOES` de `recipe.restricoes`) e ela entra como
 * DEFAULT, pré-marcada, nos pedidos: criação (Estruturado, Prompt aberto, Conversa), Sugestão de cardápio e
 * Busca. Cada pedido pode mudar; o perfil só decide o ponto de partida.
 *
 * Aqui vive: a validação da lista (zod, contra o vocabulário), a forma canônica gravada (sem repetição, na
 * ordem do vocabulário) e a regra de "seleção com default" que todas as superfícies usam — enquanto a
 * pessoa não mexe, vale o que está no perfil; no primeiro toque, a seleção passa a ser dela (inclusive
 * vazia). O efeito (rota `/api/me/restricoes`) e a UI moram fora.
 *
 * Dado SENSÍVEL (pode revelar saúde ou crença — LGPD Art. 5 II/11): nada aqui loga ou serializa a lista.
 */
import { z } from 'zod'
import { RESTRICOES, isRestricao, type Restricao } from '@/domain/vocabulary'

/**
 * Teto de itens no corpo, ANTES do dedup: recusa payload inflado sem rejeitar quem mandou a mesma restrição
 * duas vezes. Depois do dedup a lista nunca passa de `RESTRICOES.length`.
 */
export const RESTRICOES_INPUT_MAX = 32

const listaSchema = z.array(z.enum(RESTRICOES)).max(RESTRICOES_INPUT_MAX)

/** Forma canônica: sem repetição e na ORDEM do vocabulário (gravação e comparação estáveis). */
export function ordenarRestricoes(lista: readonly Restricao[]): Restricao[] {
  const set = new Set(lista)
  return RESTRICOES.filter((r) => set.has(r))
}

export type ListaRestricoesParse = { ok: true; restricoes: Restricao[] } | { ok: false }

/**
 * Validação ESTRITA de uma lista vinda do cliente (corpo do PUT do perfil e o campo `restricoes` dos pedidos
 * de geração): array de valores do vocabulário, até `RESTRICOES_INPUT_MAX`. Qualquer valor fora do
 * vocabulário recusa a lista INTEIRA (não descarta em silêncio — a pessoa veria uma restrição sumir).
 * Ausente (`undefined`/`null`) NÃO é tratado aqui: cada borda decide o que ausente significa.
 */
export function parseListaRestricoes(raw: unknown): ListaRestricoesParse {
  const parsed = listaSchema.safeParse(raw)
  if (!parsed.success) return { ok: false }
  return { ok: true, restricoes: ordenarRestricoes(parsed.data) }
}

/**
 * Leitura TOLERANTE (cliente lendo a resposta da rota): mantém só os valores do vocabulário. Nunca lança.
 * Um valor desconhecido (deploy novo × aba antiga) some em vez de quebrar a tela.
 */
export function normalizarRestricoes(raw: unknown): Restricao[] {
  if (!Array.isArray(raw)) return []
  return ordenarRestricoes(raw.filter((v): v is Restricao => typeof v === 'string' && isRestricao(v)))
}

// ── Seleção com default (a regra das superfícies) ───────────────────────────────────────────────

/**
 * Estado de uma seleção de Restrições que nasce do perfil. `tocada=false` ⇒ vale o default do perfil;
 * `tocada=true` ⇒ vale `escolhidas` (o que a pessoa marcou neste pedido, possivelmente vazio). O default
 * chega DEPOIS da montagem (fetch), então não se copia o perfil pro estado: ele é lido na hora.
 */
export type SelecaoRestricoes = { readonly tocada: boolean; readonly escolhidas: readonly Restricao[] }

export const SELECAO_INICIAL: SelecaoRestricoes = { tocada: false, escolhidas: [] }

/** As Restrições que valem AGORA: as escolhidas, ou (sem toque) as do perfil. `null` = perfil ausente/Visitante. */
export function restricoesEfetivas(
  sel: SelecaoRestricoes,
  perfil: readonly Restricao[] | null,
): Restricao[] {
  return [...(sel.tocada ? sel.escolhidas : (perfil ?? []))]
}

/** Alterna uma Restrição partindo do que vale agora; a seleção passa a ser da pessoa. */
export function alternarRestricao(
  sel: SelecaoRestricoes,
  perfil: readonly Restricao[] | null,
  r: Restricao,
): SelecaoRestricoes {
  const atual = restricoesEfetivas(sel, perfil)
  const escolhidas = atual.includes(r) ? atual.filter((v) => v !== r) : [...atual, r]
  return { tocada: true, escolhidas }
}

/** "Mostrar tudo"/limpar: a pessoa tirou todas, inclusive as do perfil, neste pedido. */
export const SELECAO_LIMPA: SelecaoRestricoes = { tocada: true, escolhidas: [] }

/**
 * A seleção que vale agora veio do perfil (e há algo nele)? É o que acende a indicação visível ("marcadas a
 * partir do seu perfil" / "filtrando pelas suas restrições") — o default nunca age sem aviso.
 */
export function vemDoPerfil(sel: SelecaoRestricoes, perfil: readonly Restricao[] | null): boolean {
  return !sel.tocada && (perfil?.length ?? 0) > 0
}

/**
 * Busca (ADR-0041 dec.4): as restrições do perfil SOZINHAS não tiram a home do repouso (o feed indexável fica
 * igual para todos). Só uma restrição escolhida pela pessoa conta como critério; quando há OUTRO critério
 * (termo, cozinha, categoria), a busca usa as efetivas — o default do perfil incluído, visível na trilha e
 * no aviso acima dos resultados.
 */
export function restricaoEhCriterio(sel: SelecaoRestricoes): boolean {
  return sel.tocada && sel.escolhidas.length > 0
}

/**
 * Busca (ADR-0041 dec.4): as Restrições APLICADAS agora. Escolha da pessoa (`tocada`) vale sempre; sem toque,
 * o perfil só entra quando há OUTRO critério (`outroCriterio`: termo, cozinha ou categoria) — no repouso a
 * home mostra o feed sem filtro, e a trilha mostra exatamente o que está aplicado (nada marcado "de enfeite").
 */
export function restricoesDaBusca(
  sel: SelecaoRestricoes,
  perfil: readonly Restricao[] | null,
  outroCriterio: boolean,
): Restricao[] {
  if (sel.tocada) return [...sel.escolhidas]
  return outroCriterio ? [...(perfil ?? [])] : []
}
