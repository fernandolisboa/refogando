import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { vocabularyTerm } from '@/db/schema'
import type { VocabularyKind, VocabularyTermStatus } from '@/domain/vocabulary-term'

/**
 * Leitor de vocabulário data-driven (#315, ADR-0025 Decisão 4).
 *
 * PURAMENTE ADITIVA: ninguém consome ainda — o app segue lendo `cozinhaEnum`/`cozinhaLabel`.
 * Os consumidores chegam nas próximas fatias (validação #316, rótulos #317, virada #318).
 *
 * Duas SUPERFÍCIES de leitura (scopes), cada uma mapeando para os status que ela enxerga:
 *  - `active`  — facetas de busca + `z.enum` da geração: SÓ termos vivos.
 *  - `display` — exibição do acervo: active + deprecated (depreciada ainda RENDERIZA o que já
 *                foi gravado, só não é mais oferecida em criações novas).
 * `suggested`/`merged`/`rejected` não entram em nenhuma superfície → nunca retornados.
 *
 * REGRA DE ESCRITA (ADR-0025 Decisão 4): a validação de escrita (#316) NÃO usa este cache — lê
 * o DB direto, p/ não aceitar slug recém-desativado nem rejeitar slug recém-criado dentro da
 * janela do TTL.
 */

// view mínima: allowlist explícita de colunas → id/status/timestamps NUNCA entram no snapshot.
export type VocabularyTermView = {
  slug: string
  labelPtBr: string | null
  labelEnUs: string | null
  sort: number
}

// O snapshot é COMPARTILHADO entre requisições da mesma instância serverless dentro do TTL, então
// o leitor devolve um array CONGELADO de linhas congeladas: mutar acidentalmente (sort/reverse/push
// ou setar um campo) vira erro no ponto de chamada, em vez de envenenar o cache p/ todos os viewers.
export type ReadonlyVocabulary = readonly Readonly<VocabularyTermView>[]

// scope → status visíveis (ADR-0025 Decisão 4). `as const satisfies` preserva os literais p/
// que `keyof` infira a união 'active' | 'display' (uma anotação `Record` simples alargaria).
export const VOCABULARY_SCOPES = {
  // facetas + z.enum de geração: só termos vivos.
  active: ['active'],
  // exibição do acervo: a depreciada ainda aparece no que já foi gravado.
  display: ['active', 'deprecated'],
} as const satisfies Record<string, readonly VocabularyTermStatus[]>

export type VocabularyScope = keyof typeof VOCABULARY_SCOPES

// Cache de leitura por INSTÂNCIA serverless, TTL curto. A validação de ESCRITA (#316) NÃO passa
// por aqui (lê o DB direto) — ver docstring. Chaveado por `${kind}:${scope}` (chaves independentes).
const READ_TTL_MS = 30_000

type CacheEntry = { expiresAt: number; snapshot: ReadonlyVocabulary }
const cache = new Map<string, CacheEntry>()

export async function loadVocabulary(
  db: Database,
  kind: VocabularyKind,
  scope: VocabularyScope,
): Promise<ReadonlyVocabulary> {
  const key = `${kind}:${scope}`
  const entry = cache.get(key)
  if (entry && entry.expiresAt > Date.now()) return entry.snapshot

  const rows = await db
    .select({
      slug: vocabularyTerm.slug,
      labelPtBr: vocabularyTerm.labelPtBr,
      labelEnUs: vocabularyTerm.labelEnUs,
      sort: vocabularyTerm.sort,
    })
    .from(vocabularyTerm)
    // eq(kind) também exclui dimensões estranhas — estruturalmente presente, hoje não testável
    // (VOCABULARY_KINDS === ['cozinha'] e o pgEnum proíbe um segundo kind).
    .where(and(eq(vocabularyTerm.kind, kind), inArray(vocabularyTerm.status, [...VOCABULARY_SCOPES[scope]])))
    // (kind,status,sort) do #314 respalda o WHERE; o PG adiciona um nó de sort p/ o desempate por slug.
    .orderBy(asc(vocabularyTerm.sort), asc(vocabularyTerm.slug))

  // Congela array + linhas: o snapshot é compartilhado por TODAS as requisições da instância
  // dentro do TTL; mutação acidental por um futuro consumidor (#316/#317/#318) falharia AQUI em
  // vez de envenenar silenciosamente o cache. Custo zero por leitura (congela uma vez, na escrita).
  const snapshot: ReadonlyVocabulary = Object.freeze(rows.map((r) => Object.freeze(r)))
  cache.set(key, { expiresAt: Date.now() + READ_TTL_MS, snapshot })
  return snapshot
}

// Existe SÓ p/ testes: truncate+reseed por caso esvazia as LINHAS, não este Map em memória.
export function __clearVocabularyCache(): void {
  cache.clear()
}
