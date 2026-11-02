import { createHmac } from 'node:crypto'
import { and, eq, gt, inArray, lte } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { EMBEDDING_DIMENSIONS, searchQueryEmbedding } from '@/db/schema'
import { canonicalSearchQuery } from '@/domain/search-query-key'
import { GLOBAL_LIMIT_KEY } from '@/domain/rate-limit-rules'
import { EMBEDDING_VERSION, type Embedder } from '@/server/embedding/embedder'
import { ipRateKey } from '@/server/http/ip-burst-limit'
import { MAX_QUERY_LEN } from '@/server/recipe/search'
import { consumeRateLimits, limiterKey, type RateLimitRule } from '@/server/rate-limit/window'

/**
 * Vetor da CONSULTA de busca (#14) com cache e limitador (#643, ADR-0057). A busca é aberta a visitante e cada
 * consulta nova chamava o embedding pago do Gemini, com a mesma chave das imagens e do vetor das receitas.
 *
 * Ordem (mais barato primeiro), e NUNCA lança: qualquer falha vira `null`, que a rota trata como antes (só a parte
 * textual da busca, FTS + trigram):
 *  1. forma canônica (`canonicalSearchQuery`); vazia ⇒ `null` sem tocar nada;
 *  2. cache (`search_query_embedding`, chave HMAC, vale `SEARCH_QUERY_EMBEDDING_TTL_MS`): achou ⇒ devolve, SEM
 *     limitador e sem embedder. Roda em paralelo com a leitura da sessão;
 *  3. limitador persistido: por conta (logado) ou por IP (visitante; sem IP, pula), depois o teto global por minuto.
 *     Bloqueado (ou erro do banco no limitador) ⇒ `null`: a busca segue só textual, sem erro para a pessoa;
 *  4. embedder; saída malformada (dimensão errada, NaN/Infinity) ⇒ `null`, como o embedder lançando;
 *  5. grava no cache (best-effort: falha de escrita não muda a resposta).
 *
 * O cache não guarda o texto: só o HMAC da forma canônica (+ versão da geometria, dimensão e tarefa) e o vetor.
 * Ainda assim o vetor deriva do que a pessoa digitou, então vale pouco (12 h) e não liga a ninguém: a chave é a
 * mesma para todo mundo que busca o mesmo termo.
 */

/** Validade de um vetor no cache. A limpeza de hora em hora tira os vencidos (no máximo ~13 h; política: 24 h). */
export const SEARCH_QUERY_EMBEDDING_TTL_MS = 12 * 60 * 60 * 1000

/** Tarefa da consulta (par assimétrico com `RETRIEVAL_DOCUMENT` do índice). Entra na chave do cache. */
const QUERY_TASK = 'RETRIEVAL_QUERY' as const

/** Segredo do HMAC da chave do cache: o do auth, como o limitador (`limiterKey`). */
function cacheSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'test') return 'refogando-test-search-cache-secret'
  throw new Error('BETTER_AUTH_SECRET obrigatório (fora de teste)')
}

/**
 * Chave do cache: HMAC-SHA256 de `search-query:<versão>:<dimensão>:<tarefa>:<consulta canônica>`, em base64url
 * inteiro (256 bits: chave primária, sem colisão prática). Trocar o modelo, a dimensão ou a tarefa troca a chave,
 * então um vetor da geometria antiga nunca é servido. Com HMAC (e não um hash simples), quem lê o banco não confere
 * um dicionário de termos contra as chaves sem o segredo.
 */
export function searchQueryCacheKey(canonical: string): string {
  return createHmac('sha256', cacheSecret())
    .update(`search-query:${EMBEDDING_VERSION}:${EMBEDDING_DIMENSIONS}:${QUERY_TASK}:${canonical}`)
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

async function writeCache(db: Database, key: string, vector: number[], now: Date): Promise<void> {
  try {
    await db
      .insert(searchQueryEmbedding)
      .values({ queryKey: key, embedding: vector, model: EMBEDDING_VERSION, createdAt: now })
      .onConflictDoUpdate({
        // Linha vencida (ou de outra versão) com a mesma chave: renova no lugar.
        target: searchQueryEmbedding.queryKey,
        set: { embedding: vector, model: EMBEDDING_VERSION, createdAt: now },
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
}

/** Regras do limitador para esta consulta: conta OU IP (o que houver), depois o teto global. */
function rulesFor(viewerId: string | undefined, ip: string | null): RateLimitRule[] {
  const rules: RateLimitRule[] = []
  if (viewerId !== undefined) rules.push({ bucket: 'search_embed_user', key: limiterKey('search_embed_user', viewerId) })
  else if (ip) rules.push({ bucket: 'search_embed_ip', key: limiterKey('search_embed_ip', ipRateKey(ip)) })
  rules.push({ bucket: 'search_embed_global', key: GLOBAL_LIMIT_KEY })
  return rules
}

export async function resolveSearchQueryVector(db: Database, input: QueryVectorInput): Promise<number[] | null> {
  const viewer = input.viewerId.catch(() => undefined)
  const canonical = canonicalSearchQuery(input.q, MAX_QUERY_LEN)
  if (canonical.length === 0) return null
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

  await writeCache(db, key, vector, now)
  return vector
}

/**
 * Apaga UM lote de vetores vencidos (`created_at <= now - TTL`) e devolve quantos saíram. Quem chama repete em
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
