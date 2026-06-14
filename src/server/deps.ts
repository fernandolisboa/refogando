import { makeDb, makeSql, type Database } from '@/db/client'
import { RealClaudeClient, type ClaudeClient } from '@/server/claude/client'
import { RealEmbedder, type Embedder } from '@/server/embedding/embedder'

/**
 * Raiz de composição (DI) da fundação. Três seams com um dono cada:
 *  - getDb()           → Postgres (Drizzle)
 *  - getClaudeClient() → seam do Claude
 *  - getEmbedder()     → seam de embedding
 *
 * Produção resolve preguiçosamente a partir do ambiente. Testes injetam dublês
 * via setX() e limpam com resetDeps() entre testes. Mínimo necessário para a seam
 * travada — nada de container de DI genérico.
 */

let dbOverride: Database | null = null
let lazyDb: Database | null = null
let claudeOverride: ClaudeClient | null = null
let lazyClaude: ClaudeClient | null = null
let embedderOverride: Embedder | null = null
let lazyEmbedder: Embedder | null = null

export function getDb(): Database {
  if (dbOverride) return dbOverride
  if (!lazyDb) {
    // Lido preguiçosamente (não no topo do módulo): o harness só define a URL
    // depois, e globalSetup roda em outro processo.
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error('DATABASE_URL não definido (nos testes, use setDb()).')
    }
    lazyDb = makeDb(makeSql(url))
  }
  return lazyDb
}

export function setDb(db: Database): void {
  dbOverride = db
}

export function getClaudeClient(): ClaudeClient {
  if (claudeOverride) return claudeOverride
  if (!lazyClaude) lazyClaude = new RealClaudeClient()
  return lazyClaude
}

export function setClaudeClient(client: ClaudeClient): void {
  claudeOverride = client
}

export function getEmbedder(): Embedder {
  if (embedderOverride) return embedderOverride
  if (!lazyEmbedder) lazyEmbedder = new RealEmbedder()
  return lazyEmbedder
}

export function setEmbedder(embedder: Embedder): void {
  embedderOverride = embedder
}

/**
 * Limpa overrides dos seams entre testes. NÃO mexe no banco (setDb persiste por
 * arquivo de teste) nem derruba o pool.
 */
export function resetDeps(): void {
  claudeOverride = null
  embedderOverride = null
}
