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
 * As Restrições que a PESSOA escolheu neste pedido (tocou e deixou alguma marcada)? Só isso conta como
 * substância/critério por conta própria: o default do perfil, intocado, nunca tira a home do repouso
 * (ADR-0041 dec.3) nem sozinho torna um briefing não-vazio (gastaria uma geração só com restrições que a
 * pessoa nem escolheu agora).
 */
export function restricaoEhCriterio(sel: SelecaoRestricoes): boolean {
  return sel.tocada && sel.escolhidas.length > 0
}

/**
 * Caminhos que só OFERECEM as salvas (Prompt aberto e Conversa): as que valem agora, restritas às do perfil.
 * A interseção protege contra um toque herdado do ramo estruturado (alternar de modo preserva o estado).
 */
export function restricoesDoPedido(sel: SelecaoRestricoes, perfil: readonly Restricao[] | null): Restricao[] {
  if (perfil == null) return []
  return restricoesEfetivas(sel, perfil).filter((r) => perfil.includes(r))
}

// ── Busca (ADR-0041 dec.3) ──────────────────────────────────────────────────────────────────────

/**
 * Parâmetro de `/api/search` que pede "aplique as minhas Restrições salvas" — SEM valores: a lista nunca vai
 * para URL nenhuma (nem a barra de endereço nem a da API). O servidor lê `users.restricoes` da sessão;
 * Visitante ⇒ ignorado.
 */
export const PARAM_RESTRICAO_PERFIL = 'restricaoPerfil'

/**
 * As Restrições que a pessoa escolheu À MÃO na Busca — as únicas que vão para a URL (`?restricao=`) e contam
 * como faceta explícita (suprimem a lente de Perfil culinário, como qualquer faceta).
 */
export function restricoesExplicitasDaBusca(sel: SelecaoRestricoes): Restricao[] {
  return sel.tocada ? [...sel.escolhidas] : []
}

/**
 * A Busca pede o default do perfil ao servidor? Só quando a pessoa REFINA (`outroCriterio`: termo, cozinha
 * ou categoria) e não mexeu na faceta de restrição. No repouso nada muda: o feed é o mesmo para todos.
 */
export function buscaUsaPerfil(sel: SelecaoRestricoes, outroCriterio: boolean): boolean {
  return !sel.tocada && outroCriterio
}

/**
 * Servidor: as Restrições do perfil se SOMAM às da busca (explícitas ou resolvidas pela lente) — o filtro é
 * "declara todas" (`@>`), então somar é o mesmo que aplicar as duas. Forma canônica.
 */
export function somarRestricoes(base: readonly Restricao[], perfil: readonly Restricao[]): Restricao[] {
  return ordenarRestricoes([...base, ...perfil])
}
