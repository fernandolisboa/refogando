import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'
import { recordDsarEvent } from '@/server/legal/dsar-audit'
import { hasRemovableSourceName } from '@/server/recipe/clear-attribution'
import { reapOrphanImage, deleteOrphanBlob } from '@/server/recipe/image'

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

/** Valores DISTINTOS não-nulos (ordenados), para escopo/prévia e hash estáveis. Usado pela escalada. */
function distinctNonNull(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => v != null && v !== ''))).sort()
}

/**
 * Critérios de SELEÇÃO por fonte, fonte ÚNICA para clear (#396) E escalada (#397): `source_name` casa
 * case/espaço-insensível (`lower(trim(...))`); `source_url` casa EXATO. Retorna os ramos presentes
 * (o chamador exige ao menos um — nunca varre tudo). NÃO inclui o filtro `origin`/null: cada fluxo
 * compõe o `where` com as suas próprias restrições (clear exige nome+url não-nulos; escalada não).
 */
function matchCriteria(name: string, url: string): SQL[] {
  const criteria: SQL[] = []
  if (name !== '') criteria.push(sql`lower(trim(${recipe.sourceName})) = ${name.toLowerCase()}`)
  if (url !== '') criteria.push(eq(recipe.sourceUrl, url))
  return criteria
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
  const criteria = matchCriteria(name, url)
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

/**
 * ESCALADA além do nome — #397/GAP-3 (`docs/legal/takedown-e-remocao-titular.md` §4.1). Só o MECANISMO:
 * a POLÍTICA de QUANDO escalar (a atribuição obrigatória do ADR-0019 cede? em que hipóteses?) aguarda o
 * sign-off jurídico do #276 — este código NÃO decide sozinho, só executa a ordem do operador. Duas ações:
 *  - `url_unlink`       — DESVINCULA a atribuição por completo: zera `source_url` E `source_name` (→ null)
 *                         da(s) importada(s) casada(s). Cabe quando a própria URL carrega o nome do titular
 *                         (`blog-da-maria-silva.com/...`) e "só zerar o nome" (#396) não basta.
 *  - `record_deletion`  — APAGA a receita importada inteira (hard-delete; cascateia filhos / set-null nas
 *                         refs fracas, como `deleteOwnRecipe` #21). Cabe na eliminação integral.
 *
 * Diferente do clear (#396), NÃO há distinção host×humano nem exigência de nome+url não-nulos: basta ser
 * `web_imported` e casar o critério (nome OU url). O campo casado é não-nulo por construção, então toda
 * linha casada tem algo a remover — e, como a remoção zera/apaga esse campo, uma 2ª execução com o mesmo
 * critério casa 0 (IDEMPOTENTE). Efeito + `DSAR_FULFILLED` gravam na MESMA transação (GAP-5): ou faz-e-
 * audita, ou nada. A auditoria usa um `requestType` DISTINTO por ação (`url_unlink`/`record_deletion`) e
 * captura no HASH os `source_name` E `source_url` que existiam (a URL pode conter o nome) — nunca em claro.
 */

export type OperatorEscalateAction = 'url_unlink' | 'record_deletion'

export type OperatorEscalateResult = {
  /** `true` quando `apply` foi pedido (mutou/apagou + auditou); `false` = prévia (só escopo, sem efeito). */
  applied: boolean
  action: OperatorEscalateAction
  /** web_imported que CASARAM o critério (= o que será/foi desvinculado ou apagado). */
  matched: number
  /** ids afetados — desvinculados/apagados (apply) ou que SERIAM (prévia). */
  recipeIds: string[]
  /** Nomes de fonte DISTINTOS (ordenados, não-nulos) do escopo — para o operador CONFERIR na prévia. */
  distinctSourceNames: string[]
  /**
   * URLs de origem DISTINTAS (ordenadas, não-nulas) do escopo. A prévia as EXPÕE porque a própria URL é o
   * alvo da escalada (pode conter o nome do titular — §4.1); o operador precisa ver o que será removido.
   */
  distinctSourceUrls: string[]
}

export async function operatorEscalateSource(input: {
  db: Database
  actorId: string
  query: OperatorClearQuery
  action: OperatorEscalateAction
  apply: boolean
  caseId?: string | null
  /** Necessário só no `apply` de `record_deletion`: limpa blobs de imagem órfãos (#146). */
  store?: ImageStore | null
}): Promise<OperatorEscalateResult> {
  const { db, actorId, action, apply, caseId } = input
  const name = input.query.sourceName?.trim() ?? ''
  const url = input.query.sourceUrl?.trim() ?? ''
  const empty: OperatorEscalateResult = {
    applied: false,
    action,
    matched: 0,
    recipeIds: [],
    distinctSourceNames: [],
    distinctSourceUrls: [],
  }
  // Sem critério ⇒ no-op (nunca varre a base inteira). A rota já devolve 400; defesa em profundidade.
  if (name === '' && url === '') return empty

  // Só web_imported + casa o critério. SEM os filtros nome/url não-nulos do clear: a escalada remove a
  // atribuição INTEIRA (ou a receita), não decide sobre host×humano.
  const where = and(eq(recipe.origin, 'web_imported'), or(...matchCriteria(name, url)))
  const columns = {
    id: recipe.id,
    sourceName: recipe.sourceName,
    sourceUrl: recipe.sourceUrl,
    imageId: recipe.imageId,
  }

  // Prévia: só lê e conta — sem transação, sem mutar, sem evento. Expõe nomes E urls distintos do escopo.
  if (!apply) {
    const rows = await db.select(columns).from(recipe).where(where)
    return {
      applied: false,
      action,
      matched: rows.length,
      recipeIds: rows.map((r) => r.id),
      distinctSourceNames: distinctNonNull(rows.map((r) => r.sourceName)),
      distinctSourceUrls: distinctNonNull(rows.map((r) => r.sourceUrl)),
    }
  }

  // Aplicação: SELECT → efeito → auditoria, tudo na MESMA transação (atomicidade). Blobs órfãos saem
  // pós-commit (best-effort, sem rollback de blob), como em `deleteOwnRecipe`.
  const orphanBlobUrls: string[] = []
  const result = await db.transaction(async (tx) => {
    const rows = await tx.select(columns).from(recipe).where(where)
    if (rows.length === 0) return { ...empty, applied: true }

    const ids = rows.map((r) => r.id)
    const ts = new Date()
    const distinctSourceNames = distinctNonNull(rows.map((r) => r.sourceName))
    const distinctSourceUrls = distinctNonNull(rows.map((r) => r.sourceUrl))

    if (action === 'url_unlink') {
      await tx
        .update(recipe)
        .set({ sourceUrl: null, sourceName: null, updatedAt: ts }) // DESVINCULA a atribuição INTEIRA
        .where(and(inArray(recipe.id, ids), eq(recipe.origin, 'web_imported')))
    } else {
      // Hard-delete: cascateia filhos / set-null nas refs fracas (mesmas FKs de deleteOwnRecipe #21).
      const deleted = await tx
        .delete(recipe)
        .where(and(inArray(recipe.id, ids), eq(recipe.origin, 'web_imported')))
        .returning({ imageId: recipe.imageId })
      // #146: a receita já saiu NESTA tx ⇒ o COUNT do reap só conta OUTRAS versões que compartilham o
      // blob; zero ⇒ apaga recipe_image e devolve o blob p/ deleção pós-commit. (Importada raramente tem
      // imagem, mas o estúdio pode ter derivado uma — robusto e barato.)
      for (const d of deleted) {
        const blobUrl = await reapOrphanImage(tx, d.imageId, null)
        if (blobUrl) orphanBlobUrls.push(blobUrl)
      }
    }

    // `removedSourceName`/`removedSourceUrl`: DISTINTOS de fato afetados, juntos por ' | '. Entram SÓ no
    // HASH do payload (minimização — a URL pode conter o nome; nunca em claro). `details` leva só ids
    // internos + a ação (não-sensíveis).
    await recordDsarEvent(tx, {
      eventType: 'DSAR_FULFILLED',
      actorId, // operador/Encarregado que executou a escalada do titular B
      caseId: caseId ?? null,
      channel: 'operator',
      requestType: action, // 'url_unlink' | 'record_deletion' — distingue da remoção-de-nome (#396)
      fulfillment: {
        recipeIds: ids,
        removedSourceName: distinctSourceNames.join(' | '),
        removedSourceUrl: distinctSourceUrls.join(' | '),
        ts: ts.toISOString(),
      },
      details: { recipeIds: ids, action },
    })
    return {
      applied: true,
      action,
      matched: rows.length,
      recipeIds: ids,
      distinctSourceNames,
      distinctSourceUrls,
    }
  })

  // Blobs órfãos DEPOIS do commit (best-effort; só apaga se for NOSSO — store.owns).
  if (input.store) {
    for (const blobUrl of orphanBlobUrls) await deleteOrphanBlob(input.store, blobUrl)
  }
  return result
}
