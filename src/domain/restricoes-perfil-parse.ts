/**
 * Validação ESTRITA (zod) da lista de Restrições salvas no perfil (ADR-0041) — o lado de SERVIDOR do kernel
 * `restricoes-perfil.ts`. Separado de propósito: o kernel é importado pelo `RestricoesPerfilProvider` do root
 * layout (client), e o schema zod no topo do módulo levava o zod inteiro para o bundle de toda página. Só as
 * rotas que recebem a lista do cliente importam daqui.
 */
import { z } from 'zod'
import { RESTRICOES, type Restricao } from '@/domain/vocabulary'
import { RESTRICOES_INPUT_MAX, ordenarRestricoes } from '@/domain/restricoes-perfil'

const listaSchema = z.array(z.enum(RESTRICOES)).max(RESTRICOES_INPUT_MAX)

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
