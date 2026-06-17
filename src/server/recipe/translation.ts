import type { Database } from '@/db/client'
import { recipeTranslation } from '@/db/schema'
import { getTranslator } from '@/server/deps'
import { embedTranslation } from '@/server/embedding/recompute'
import { loadRecipeTranslationContext } from '@/server/recipe/load'

/**
 * Ciclo de vida da tradução on-demand (issue #23, AC1 + AC4). CABEIA sobre as máquinas
 * de #3 (leitura localizada) e #14 (re-embedding) — NÃO reimplementa nenhuma. Dono do
 * efeito: no 1º acesso a um 2º locale, gera a linha `recipe_translation`
 * `automatica_nao_revisada` (sinalizada) a partir do original e dispara o embedding.
 *
 * Sequência (decisão reversível §5.1: sem tx externa):
 *  1. carrega as linhas; se já há tradução do `targetLocale` ⇒ `exists` (nada a fazer).
 *  2. traduz o original via `getTranslator()`. Se o translator LANÇA ⇒ `degraded`:
 *     ZERO escrita (AC4 — degrada pro original, sem erro técnico).
 *  3. insere a linha do 2º locale IDEMPOTENTE (`onConflictDoNothing` na UNIQUE
 *     (recipe_id, locale) — protege a corrida de 1º acesso concorrente).
 *  4. embeda o 2º locale (`embedTranslation`, #14): a LINHA já existe (passo 3), então
 *     `{ok:false}` não ocorre; se o EMBEDDER lança, o embedding é assistivo — engole o
 *     erro e devolve `created` (a tradução já persistiu; retry recompute fica pendente).
 *
 * O `targetLocale` chega CANÔNICO (a rota valida+canoniza com `canonicalLocale`); o
 * serviço nunca recebe locale cru. Recebe o id já validado pelo gate da rota (§5.8).
 */

export type EnsureResult = { kind: 'created' } | { kind: 'exists' } | { kind: 'degraded' }

export async function ensureTranslation(
  db: Database,
  recipeId: string,
  targetLocale: string,
): Promise<EnsureResult> {
  // Loader FOCADO (#23 perf): só originalLocale + linhas de tradução; nada de
  // ingredientes/tags (a view é montada pela rota com loadRecipeRows, fora daqui).
  const ctx = await loadRecipeTranslationContext(db, recipeId)
  // Receita inexistente ⇒ colapsa em `exists` (no-op): null-check defensivo, a rota já
  // gateou existência antes de chamar. (Variante `exists` aqui = "nada a gerar".)
  if (!ctx) return { kind: 'exists' }

  // Já existe a tradução do locale-alvo? No-op idempotente.
  if (ctx.translations.some((t) => t.locale === targetLocale)) return { kind: 'exists' }

  // Fonte = tradução do originalLocale (a primária). Sem ela, nada a traduzir.
  const source = ctx.translations.find((t) => t.locale === ctx.originalLocale)
  if (!source) return { kind: 'exists' }

  // Traduz. LANÇA ⇒ degrada SEM escrever (AC4: cai pro original, sem erro técnico).
  let translated
  try {
    translated = await getTranslator().translate({
      sourceLocale: ctx.originalLocale,
      targetLocale,
      fields: {
        titulo: source.titulo,
        descricao: source.descricao,
        passos: source.passos,
        notas: source.notas,
      },
    })
  } catch {
    return { kind: 'degraded' }
  }

  // Insere IDEMPOTENTE: a UNIQUE (recipe_id, locale) protege a corrida de 1º acesso
  // concorrente (dois POST simultâneos ⇒ um insere, o outro vira no-op). NUNCA insert nu.
  // Nota: o PERDEDOR da corrida (conflito → 0 linhas) ainda retorna `created` aqui
  // (inofensivo: o único caller descarta `.kind`; a linha persiste de qualquer modo).
  await db
    .insert(recipeTranslation)
    .values({
      recipeId,
      locale: targetLocale,
      titulo: translated.titulo,
      descricao: translated.descricao ?? null,
      passos: translated.passos ?? null,
      notas: translated.notas ?? null,
      provenance: 'automatica_nao_revisada',
      stale: false,
    })
    .onConflictDoNothing({
      target: [recipeTranslation.recipeId, recipeTranslation.locale],
    })

  // Embeda o 2º locale (#14). A LINHA já existe (passo acima) ⇒ embedTranslation não
  // devolve {ok:false}; se o EMBEDDER lança, o embedding é assistivo: engole e segue
  // (a tradução já persistiu; o recompute fica pendente via stale/retry).
  try {
    await embedTranslation(db, recipeId, targetLocale)
  } catch {
    // embedding indisponível: tradeoff documentado (§5.1) — linha persiste sem vetor.
  }

  return { kind: 'created' }
}
