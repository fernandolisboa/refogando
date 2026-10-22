/**
 * Kernel PURO do export LGPD da conta (#595; Art. 18, II e V): o nome do arquivo que o titular baixa, o
 * carimbo do prompt sem texto de admin, e o escritor do JSON em streaming. Sem DB, sem IO. A montagem das
 * seções mora em `src/server/legal/account-export.ts`.
 *
 * O nome leva a data para o titular distinguir dois exports na pasta de downloads. O servidor põe no
 * `Content-Disposition` o nome do MESMO `now` do `exportedAt`. A interface baixa por fetch + blob e dá ao
 * arquivo o nome pelo relógio do navegador, com esta mesma função: mesmo formato, mas a data pode não ser a
 * do `exportedAt` (relógio do aparelho adiantado ou atrasado, ou o download atravessando a meia-noite UTC).
 */
import type { PromptStamp } from './briefing'

export const ACCOUNT_EXPORT_FILENAME_PREFIX = 'refogando-meus-dados'

/** `refogando-meus-dados-YYYY-MM-DD.json`, data em UTC. */
export function accountExportFilename(now: Date): string {
  return `${ACCOUNT_EXPORT_FILENAME_PREFIX}-${now.toISOString().slice(0, 10)}.json`
}

/** O `promptStamp` como entra no export: só versão e rótulos dos eixos. */
export type ExportedPromptStamp = {
  version: number | null
  axes: {
    nivelChef?: string
    vozCozinha?: { nome: string }
    variacaoDivergente?: { poloA: string; poloB: string }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Carimbo do prompt de uma geração, pronto para o export: a versão, o nível, o NOME da cozinha e os rótulos
 * dos dois polos da variação. Nunca o texto de prompt escrito por admin ou Curador
 * (`variacaoDivergente.instrucao`, `vozCozinha.notaCurada`): não é dado do titular. O jsonb é lido como
 * `unknown` de propósito (linha antiga ou fora da forma vira só o que tiver o tipo certo); `null` passa.
 */
export function exportablePromptStamp(stamp: PromptStamp | null | undefined): ExportedPromptStamp | null {
  const raw: unknown = stamp
  if (!isRecord(raw)) return null
  const axesIn = isRecord(raw.axes) ? raw.axes : {}
  const axes: ExportedPromptStamp['axes'] = {}
  if (typeof axesIn.nivelChef === 'string') axes.nivelChef = axesIn.nivelChef
  const voz = axesIn.vozCozinha
  if (isRecord(voz) && typeof voz.nome === 'string') axes.vozCozinha = { nome: voz.nome }
  const variacao = axesIn.variacaoDivergente
  if (isRecord(variacao) && typeof variacao.poloA === 'string' && typeof variacao.poloB === 'string') {
    axes.variacaoDivergente = { poloA: variacao.poloA, poloB: variacao.poloB }
  }
  return { version: typeof raw.version === 'number' ? raw.version : null, axes }
}

/** Uma seção do export: a chave de topo e o valor dela. */
export type JsonObjectSection = readonly [key: string, value: unknown]

/**
 * Escreve um objeto JSON uma seção de cada vez, com o MESMO texto de
 * `JSON.stringify(Object.fromEntries(seções), null, 2)`: o export é transmitido em streaming (o corpo de uma
 * resposta de função da Vercel tem teto de 4,5 MB) sem nunca montar o dump inteiro numa string só.
 *
 * Cada pedaço é uma seção inteira, já indentada no 1º nível. Funciona porque a saída do `JSON.stringify`
 * só tem quebra de linha entre tokens (a quebra dentro de uma string sai escapada como `\n`), então
 * indentar cada linha da seção em 2 espaços é o mesmo que serializá-la dentro do objeto. Valor `undefined`
 * (ou função) é pulado, como o `JSON.stringify` faz com a chave.
 */
export async function* jsonObjectChunks(sections: AsyncIterable<JsonObjectSection>): AsyncGenerator<string> {
  let first = true
  for await (const [key, value] of sections) {
    const json = JSON.stringify(value, null, 2) as string | undefined
    if (json === undefined) continue
    yield `${first ? '{' : ','}\n  ${JSON.stringify(key)}: ${json.replace(/\n/g, '\n  ')}`
    first = false
  }
  yield first ? '{}' : '\n}'
}
