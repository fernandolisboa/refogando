import { makeDb, makeSql, type Database } from '@/db/client'
import { RealClaudeClient, type ClaudeClient } from '@/server/claude/client'
import { RealEmbedder, type Embedder } from '@/server/embedding/embedder'
import { RealTranslator, type Translator } from '@/server/translation/translator'
import { RealImageStore, type ImageStore } from '@/server/images/image-store'
import { RealGeminiImageGenerator, type ImageGenerator } from '@/server/images/image-generator'
import { RealRecipeImporter, type RecipeImporter } from '@/server/import/recipe-importer'
import { RealRecipeProbe, type RecipeProbe } from '@/server/import/recipe-probe'
import { RealWebSearchProvider, type WebSearchProvider } from '@/server/web-search/web-search-provider'

/**
 * Raiz de composição (DI) da fundação. Sete seams com um dono cada:
 *  - getDb()               → Postgres (Drizzle)
 *  - getClaudeClient()     → seam do Claude
 *  - getEmbedder()         → seam de embedding
 *  - getTranslator()       → seam de tradução automática (issue #23)
 *  - getImageStore()       → seam de storage de imagem (issue #126, Vercel Blob)
 *  - getImageGenerator()   → seam de geração de imagem por IA (issue #132, Gemini REST)
 *  - getRecipeImporter()   → seam de importação de receita da web (issue #165, JSON-LD)
 *  - getRecipeProbe()      → seam do PROBE de saúde admin (issue #273, JSON-LD + robots, sem persistir)
 *  - getWebSearchProvider()→ seam de DESCOBERTA na web (issue #164, links externos ADR-0019)
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
let translatorOverride: Translator | null = null
let lazyTranslator: Translator | null = null
let imageStoreOverride: ImageStore | null = null
let lazyImageStore: ImageStore | null = null
let imageGeneratorOverride: ImageGenerator | null = null
let lazyImageGenerator: ImageGenerator | null = null
let recipeImporterOverride: RecipeImporter | null = null
let lazyRecipeImporter: RecipeImporter | null = null
let recipeProbeOverride: RecipeProbe | null = null
let lazyRecipeProbe: RecipeProbe | null = null
let webSearchProviderOverride: WebSearchProvider | null = null
let lazyWebSearchProvider: WebSearchProvider | null = null

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

export function getTranslator(): Translator {
  if (translatorOverride) return translatorOverride
  if (!lazyTranslator) lazyTranslator = new RealTranslator()
  return lazyTranslator
}

export function setTranslator(translator: Translator): void {
  translatorOverride = translator
}

export function getImageStore(): ImageStore {
  if (imageStoreOverride) return imageStoreOverride
  if (!lazyImageStore) lazyImageStore = new RealImageStore()
  return lazyImageStore
}

export function setImageStore(store: ImageStore): void {
  imageStoreOverride = store
}

export function getImageGenerator(): ImageGenerator {
  if (imageGeneratorOverride) return imageGeneratorOverride
  if (!lazyImageGenerator) lazyImageGenerator = new RealGeminiImageGenerator()
  return lazyImageGenerator
}

export function setImageGenerator(generator: ImageGenerator): void {
  imageGeneratorOverride = generator
}

export function getRecipeImporter(): RecipeImporter {
  if (recipeImporterOverride) return recipeImporterOverride
  if (!lazyRecipeImporter) lazyRecipeImporter = new RealRecipeImporter()
  return lazyRecipeImporter
}

export function setRecipeImporter(importer: RecipeImporter): void {
  recipeImporterOverride = importer
}

export function getRecipeProbe(): RecipeProbe {
  if (recipeProbeOverride) return recipeProbeOverride
  if (!lazyRecipeProbe) lazyRecipeProbe = new RealRecipeProbe()
  return lazyRecipeProbe
}

export function setRecipeProbe(probe: RecipeProbe): void {
  recipeProbeOverride = probe
}

export function getWebSearchProvider(): WebSearchProvider {
  if (webSearchProviderOverride) return webSearchProviderOverride
  if (!lazyWebSearchProvider) lazyWebSearchProvider = new RealWebSearchProvider()
  return lazyWebSearchProvider
}

export function setWebSearchProvider(provider: WebSearchProvider): void {
  webSearchProviderOverride = provider
}

/**
 * Limpa overrides dos seams entre testes. NÃO mexe no banco (setDb persiste por
 * arquivo de teste) nem derruba o pool.
 */
export function resetDeps(): void {
  claudeOverride = null
  embedderOverride = null
  translatorOverride = null
  imageStoreOverride = null
  imageGeneratorOverride = null
  recipeImporterOverride = null
  recipeProbeOverride = null
  webSearchProviderOverride = null
}
