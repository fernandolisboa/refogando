import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe } from '@/db/schema'
import { recordDsarEvent } from '@/server/legal/dsar-audit'
import { hasRemovableSourceName } from '@/server/recipe/clear-attribution'

/**
 * Atendimento ao autor EXTERNO (titular B, sem conta) pelo operador/Encarregado — #396/GAP-4
 * (`docs/legal/takedown-e-remocao-titular.md` §4.2). O self-service (`clearSourceAttribution`) só
 * atende o DONO logado; aqui o operador zera `source_name` em LOTE por `source_name`/`source_url`,
 * SEM exigir ownership (inclui receitas PRIVADAS de qualquer usuário).
 *
 * A REGRA do que é removível é a MESMA do self-service: o núcleo puro `hasRemovableSourceName`
 * (web_imported + com URL + nome ≠ host). `source_url` NUNCA é tocado (a atribuição obrigatória cai
 * pro host — ADR-0019); receitas cujo `source_name` já é o host são no-op (⇒ idempotência: rodar 2x
 * não faz nada na 2ª). A remoção efetiva + o `DSAR_FULFILLED` gravam na MESMA transação (GAP-5, #395):
 * ou remove-e-audita, ou nada.
 *
 * MATCHING (seleção): `source_name` casa por igualdade case/espaço-insensível (`lower(trim(...))`);
 * `source_url` casa EXATO. Match por URL não vaza pra outros autores do mesmo host (multi-autor):
 * a mesma URL = a mesma fonte = o mesmo nome. Ao menos um critério (nome OU url) é obrigatório —
 * a rota valida 400; aqui é cinto-e-suspensório (sem critério ⇒ no-op, nunca varre tudo).
 */

export type OperatorClearQuery = {
  sourceName?: string | null
  sourceUrl?: string | null
}

export type OperatorClearResult = {
  /** `true` quando `apply` foi pedido (mutou + auditou); `false` = prévia (só conta, sem efeito). */
  applied: boolean
  /** web_imported com atribuição que CASARAM o critério (inclui as já-host, que são no-op). */
  matched: number
  /** ids com nome HUMANO removível — o que foi zerado (apply) ou o que SERIA zerado (prévia). */
  recipeIds: string[]
  /**
   * Nomes de fonte DISTINTOS (ordenados) dos registros removíveis — o ESCOPO que será/foi zerado. A
   * prévia os expõe para o operador CONFERIR antes de aplicar: se preencher nome E url, o ramo de URL
   * pode arrastar OUTRO import da MESMA url com um `source_name` diferente (site trocou de marca entre
   * imports) — o operador precisa ver esse nome, não só a contagem. Nunca inclui nomes já-host.
   */
  distinctSourceNames: string[]
}

/**
 * Nomes de fonte DISTINTOS (ordenados) dos registros removíveis. Derivado das linhas já lidas (o filtro
 * `hasRemovableSourceName` é JS puro — `sourceNameIsHost` não vive em SQL), então não precisa de query
 * extra. Ordenado para prévia e hash de auditoria estáveis.
 */
function distinctRemovableSourceNames(removable: { sourceName: string | null }[]): string[] {
  return Array.from(new Set(removable.map((r) => r.sourceName as string))).sort()
}

export async function operatorClearSourceAttribution(input: {
  db: Database
  actorId: string
  query: OperatorClearQuery
  apply: boolean
  caseId?: string | null
}): Promise<OperatorClearResult> {
  const { db, actorId, apply, caseId } = input
  const name = input.query.sourceName?.trim() ?? ''
  const url = input.query.sourceUrl?.trim() ?? ''
  // Sem critério ⇒ no-op (nunca varre a base inteira). A rota já devolve 400; defesa em profundidade.
  if (name === '' && url === '')
    return { applied: false, matched: 0, recipeIds: [], distinctSourceNames: [] }

  // Casa por nome (case/espaço-insensível) OU por URL (exato). Ao menos um dos dois está presente.
  const criteria: SQL[] = []
  if (name !== '') criteria.push(sql`lower(trim(${recipe.sourceName})) = ${name.toLowerCase()}`)
  if (url !== '') criteria.push(eq(recipe.sourceUrl, url))
  const where = and(
    eq(recipe.origin, 'web_imported'),
    // nome E url presentes: só assim há atribuição humana a remover (paridade com o núcleo).
    sql`${recipe.sourceName} is not null`,
    sql`${recipe.sourceUrl} is not null`,
    or(...criteria),
  )

  const columns = {
    id: recipe.id,
    origin: recipe.origin,
    sourceName: recipe.sourceName,
    sourceUrl: recipe.sourceUrl,
  }

  // Prévia: só lê e conta — sem transação, sem mutar, sem evento de auditoria. Expõe também os nomes
  // DISTINTOS que seriam zerados, para o operador conferir o escopo (ver `distinctSourceNames`).
  if (!apply) {
    const rows = await db.select(columns).from(recipe).where(where)
    const removable = rows.filter(hasRemovableSourceName)
    return {
      applied: false,
      matched: rows.length,
      recipeIds: removable.map((r) => r.id),
      distinctSourceNames: distinctRemovableSourceNames(removable),
    }
  }

  // Aplicação: SELECT → decisão → UPDATE → auditoria, tudo na MESMA transação (atomicidade).
  return db.transaction(async (tx) => {
    const rows = await tx.select(columns).from(recipe).where(where)
    const removable = rows.filter(hasRemovableSourceName)
    if (removable.length === 0)
      return { applied: true, matched: rows.length, recipeIds: [], distinctSourceNames: [] }

    const ids = removable.map((r) => r.id)
    const ts = new Date()
    await tx
      .update(recipe)
      .set({ sourceName: null, updatedAt: ts }) // SÓ sourceName; NUNCA toca origin/sourceUrl
      .where(and(inArray(recipe.id, ids), eq(recipe.origin, 'web_imported')))

    // `distinctSourceNames` = nomes DISTINTOS de fato removidos (ordenados). No caso comum (match por um
    // nome, ou por URL = uma fonte) é um só; junto por ' | ' vira o `removedSourceName` que NUNCA é
    // persistido em claro — só entra no HASH do payload (senão a auditoria copiaria o dado que se pediu
    // para apagar — #395 §5). Também vai na RESPOSTA (não-sensível para o operador que executou).
    const distinctSourceNames = distinctRemovableSourceNames(removable)
    const removedSourceName = distinctSourceNames.join(' | ')
    await recordDsarEvent(tx, {
      eventType: 'DSAR_FULFILLED',
      actorId, // operador/Encarregado que executou o takedown do titular B
      caseId: caseId ?? null,
      channel: 'operator',
      requestType: 'name_removal',
      fulfillment: { recipeIds: ids, removedSourceName, ts: ts.toISOString() },
      details: { recipeIds: ids }, // ids internos (não-sensíveis); o nome só existe no hash
    })
    return { applied: true, matched: rows.length, recipeIds: ids, distinctSourceNames }
  })
}
