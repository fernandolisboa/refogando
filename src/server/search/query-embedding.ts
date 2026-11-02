import { createHmac } from 'node:crypto'
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { EMBEDDING_DIMENSIONS, searchQueryEmbedding } from '@/db/schema'
import { canonicalSearchQuery, embeddableSearchQuery } from '@/domain/search-query-key'
import { GLOBAL_LIMIT_KEY } from '@/domain/rate-limit-rules'
import { EMBEDDING_VERSION, type Embedder } from '@/server/embedding/embedder'
import { ipRateKey } from '@/server/http/ip-burst-limit'
import { MAX_QUERY_LEN } from '@/server/recipe/search'
import { e2eFakesActive } from '@/server/e2e/mode'
import { consumeRateLimits, derivedSubkey, limiterKey, type RateLimitRule } from '@/server/rate-limit/window'

/**
 * Vetor da CONSULTA de busca (#14) com cache e limitador (#643, ADR-0057). A busca é aberta a visitante e cada
 * consulta nova chamava o embedding pago do Gemini, com a mesma chave das imagens e do vetor das receitas.
 *
 * Ordem (mais barato primeiro), e NUNCA lança: qualquer falha vira `null`, que a rota trata como antes (só a parte
 * textual da busca, FTS + trigram):
 *  1. forma canônica (`canonicalSearchQuery`); vazia, com menos de 3 caracteres ou sem letra nem dígito
 *     (`embeddableSearchQuery`) ⇒ `null` sem tocar nada: fica só a parte textual. Corta os prefixos curtos que a
 *     digitação dispara (a rota busca a cada pausa de 300 ms) antes de gastarem o limite e o cache;
 *  2. cache (`search_query_embedding`, chave HMAC, vale `SEARCH_QUERY_EMBEDDING_TTL_MS`): achou ⇒ devolve, SEM
 *     limitador e sem embedder. Roda em paralelo com a leitura da sessão;
 *  3. limitador persistido: por conta (logado) ou por IP (visitante; sem IP, pula), depois o teto global por minuto
 *     do grupo (logados e visitantes têm baldes separados). Bloqueado (ou erro do banco no limitador) ⇒ `null`: a
 *     busca segue só textual, sem erro para a pessoa;
 *  4. embedder; saída malformada (dimensão errada, NaN/Infinity) ⇒ `null`, como o embedder lançando;
 *  5. grava no cache (best-effort: falha de escrita não muda a resposta), salvo se a tabela já passou de
 *     `SEARCH_QUERY_EMBEDDING_MAX_ROWS` linhas (o vetor ainda serve a resposta; só não fica guardado).
 *
 * O cache não guarda o texto: só o HMAC da forma canônica (+ versão da geometria, dimensão e tarefa) e o vetor, em
 * `halfvec` (meia precisão, ~3 KB por linha). Ainda assim o vetor deriva do que a pessoa digitou (quem tem o modelo
 * público pode embedar um termo candidato e comparar), então é tratado como dado pessoal: vale pouco (6 h), e a hora
 * de gravação é arredondada para a hora cheia, para não casar com o horário de outro registro. A chave é a mesma para
 * todo mundo que busca o mesmo termo; a linha não leva conta nem IP.
 */

/**
 * Validade de um vetor no cache, contada da HORA CHEIA em que foi gravado (`created_at` arredondado para baixo): na
 * prática, entre 5 e 6 h. A limpeza de hora em hora tira os vencidos (no máximo ~7 h; política: até 24 h).
 */
export const SEARCH_QUERY_EMBEDDING_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Teto de linhas do cache. Com `halfvec(1536)` cada linha pesa ~3 KB (TOAST), então o cache não passa de ~15–20 MB
 * no plano grátis do Neon (0,5 GB), por mais consultas distintas que um laço mande. Acima do teto, só não grava.
 */
export const SEARCH_QUERY_EMBEDDING_MAX_ROWS = 5000

const HORA_MS = 60 * 60 * 1000

/** `created_at` do cache: a hora cheia (sem minutos, segundos nem ms), para não correlacionar com outro registro. */
export function cacheCreatedAt(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HORA_MS) * HORA_MS)
}

/** Tarefa da consulta (par assimétrico com `RETRIEVAL_DOCUMENT` do índice). Entra na chave do cache. */
const QUERY_TASK = 'RETRIEVAL_QUERY' as const

/**
 * Chave do cache: HMAC-SHA256 (subchave HKDF `refogando/search-query` do segredo do auth) de
 * `search-query:<versão>:<dimensão>:<tarefa>[:e2e-fake]:<consulta canônica>`, em base64url inteiro (256 bits: chave
 * primária, sem colisão prática). Trocar o modelo, a dimensão ou a tarefa troca a chave, então um vetor da geometria
 * antiga nunca é servido. No modo fake do E2E a chave leva um marcador, e um vetor do `FakeEmbedder` nunca divide
 * chave com um vetor real. Sem a chave secreta, quem lê o banco não confere uma lista de termos contra as CHAVES; o
 * VETOR, porém, pode ser comparado com o de um termo candidato (ver o cabeçalho).
 */
export function searchQueryCacheKey(canonical: string): string {
  const fake = e2eFakesActive() ? ':e2e-fake' : ''
  return createHmac('sha256', derivedSubkey('refogando/search-query'))
    .update(`search-query:${EMBEDDING_VERSION}:${EMBEDDING_DIMENSIONS}:${QUERY_TASK}${fake}:${canonical}`)
    .digest('base64url')
}

function validVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS && v.every((x) => typeof x === 'number' && Number.isFinite(x))
}

async function readCache(db: Database, key: string, now: Date): Promise<number[] | null> {
  try {
    const [row] = await db
      .select({ embedding: searchQueryEmbedding.embedding })
      .from(searchQueryEmbedding)
      .where(
        and(
          eq(searchQueryEmbedding.queryKey, key),
          eq(searchQueryEmbedding.model, EMBEDDING_VERSION),
          gt(searchQueryEmbedding.createdAt, new Date(now.getTime() - SEARCH_QUERY_EMBEDDING_TTL_MS)),
        ),
      )
      .limit(1)
    return row && validVector(row.embedding) ? row.embedding : null
  } catch {
    return null // cache fora ⇒ segue como falta (o limitador ainda protege o embedder)
  }
}

/** A tabela já tem `max` linhas ou mais? Conta no máximo `max` (para no teto, não varre a tabela toda). */
async function cacheFull(db: Database, max: number): Promise<boolean> {
  const [row] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${searchQueryEmbedding} LIMIT ${max}) AS t`,
  )
  return Number(row?.n ?? 0) >= max
}

async function writeCache(db: Database, key: string, vector: number[], now: Date, maxRows: number): Promise<void> {
  try {
    if (await cacheFull(db, maxRows)) return // teto de armazenamento: o vetor serve esta resposta, sem guardar
    const createdAt = cacheCreatedAt(now)
    await db
      .insert(searchQueryEmbedding)
      .values({ queryKey: key, embedding: vector, model: EMBEDDING_VERSION, createdAt })
      .onConflictDoUpdate({
        // Linha vencida (ou de outra versão) com a mesma chave: renova no lugar.
        target: searchQueryEmbedding.queryKey,
        set: { embedding: vector, model: EMBEDDING_VERSION, createdAt },
      })
  } catch {
    // Best-effort: a resposta já tem o vetor; a próxima busca igual só paga de novo.
  }
}

export type QueryVectorInput = {
  /** Consulta efetiva (depois da lente), crua: a forma canônica é feita aqui. */
  q: string
  /** IP do pedido (`clientIpFromHeaders`), ou null (local/teste). */
  ip: string | null
  /** Id da conta logada, resolvido em paralelo com o cache. Rejeição vira visitante. */
  viewerId: Promise<string | undefined>
  embedder: Embedder
  now?: Date
  /** Default `SEARCH_QUERY_EMBEDDING_MAX_ROWS`. Os testes passam um teto pequeno. */
  cacheMaxRows?: number
}

/**
 * Regras do limitador para esta consulta: a conta e o teto global das pessoas logadas; ou o IP (se houver) e o teto
 * global dos visitantes. Baldes globais separados: um laço anônimo não tira a busca semântica de quem tem conta. Se o
 * global barrar, `consumeRateLimits` devolve a unidade da conta ou do IP (o vetor não saiu).
 */
function rulesFor(viewerId: string | undefined, ip: string | null): RateLimitRule[] {
  if (viewerId !== undefined) {
    return [
      { bucket: 'search_embed_user', key: limiterKey('search_embed_user', viewerId) },
      { bucket: 'search_embed_global_user', key: GLOBAL_LIMIT_KEY },
    ]
  }
  const rules: RateLimitRule[] = []
  if (ip) rules.push({ bucket: 'search_embed_ip', key: limiterKey('search_embed_ip', ipRateKey(ip)) })
  rules.push({ bucket: 'search_embed_global_anon', key: GLOBAL_LIMIT_KEY })
  return rules
}

export async function resolveSearchQueryVector(db: Database, input: QueryVectorInput): Promise<number[] | null> {
  const viewer = input.viewerId.catch(() => undefined)
  const canonical = canonicalSearchQuery(input.q, MAX_QUERY_LEN)
  if (!embeddableSearchQuery(canonical)) return null
  const now = input.now ?? new Date()
  let key: string
  try {
    key = searchQueryCacheKey(canonical)
  } catch {
    return null // sem segredo fora de teste: não há como chavear (nem cache nem limite) ⇒ só textual
  }

  const [cached, viewerId] = await Promise.all([readCache(db, key, now), viewer])
  if (cached) return cached

  try {
    const decision = await consumeRateLimits(db, rulesFor(viewerId, input.ip), now)
    if (!decision.allowed) return null
  } catch {
    return null // fail-closed: sem o limitador, a chamada paga não sai
  }

  let vector: number[]
  try {
    vector = await input.embedder.embed(canonical, QUERY_TASK)
  } catch {
    return null
  }
  if (!validVector(vector)) return null

  await writeCache(db, key, vector, now, input.cacheMaxRows ?? SEARCH_QUERY_EMBEDDING_MAX_ROWS)
  return vector
}

/**
 * Apaga UM lote de vetores vencidos (`created_at <= now - TTL`; `created_at` é a hora cheia da gravação) e devolve
 * quantos saíram. Quem chama repete em
 * lotes: a limpeza de hora em hora e a retenção diária (passo `searchQueryEmbeddings`).
 */
export async function deleteExpiredSearchQueryEmbeddings(db: Database, now: Date, limit: number): Promise<number> {
  const cutoff = new Date(now.getTime() - SEARCH_QUERY_EMBEDDING_TTL_MS)
  const due = db
    .select({ key: searchQueryEmbedding.queryKey })
    .from(searchQueryEmbedding)
    .where(lte(searchQueryEmbedding.createdAt, cutoff))
    .limit(limit)
  const removed = await db
    .delete(searchQueryEmbedding)
    .where(inArray(searchQueryEmbedding.queryKey, due))
    .returning({ key: searchQueryEmbedding.queryKey })
  return removed.length
}
