import type { Database } from '@/db/client'
import { recipeTranslation } from '@/db/schema'
import { getTranslator } from '@/server/deps'
import { embedTranslation } from '@/server/embedding/recompute'
import { loadRecipeTranslationContext } from '@/server/recipe/load'
import { slugForNewTranslation } from '@/server/recipe/slug'
import { TRANSLATION_PROMPT_VERSION } from '@/domain/translation-prompt'

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
  // Loader FOCADO (#23 perf): originalLocale + cozinha + linhas de tradução + os itens de
  // ingrediente de origem (ordem+nome, #426) p/ traduzir o nome por-locale; nada de tags.
  const ctx = await loadRecipeTranslationContext(db, recipeId)
  // Receita inexistente ⇒ colapsa em `exists` (no-op): null-check defensivo, a rota já
  // gateou existência antes de chamar. (Variante `exists` aqui = "nada a gerar".)
  if (!ctx) return { kind: 'exists' }

  // Já existe a tradução do locale-alvo? No-op idempotente.
  if (ctx.translations.some((t) => t.locale === targetLocale)) return { kind: 'exists' }

  // Fonte = tradução do originalLocale (a primária). Sem ela, nada a traduzir.
  const source = ctx.translations.find((t) => t.locale === ctx.originalLocale)
  if (!source) return { kind: 'exists' }

  // Traduz título/corpo + NOMES de ingrediente (#426). LANÇA (falha OU infidelidade) ⇒ degrada SEM
  // escrever (AC4: cai pro original, sem erro técnico). A MEDIDA nunca entra no payload (Direção B).
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
      ingredientes: ctx.ingredients,
      contexto: { cozinha: ctx.cozinha },
    })
  } catch {
    return { kind: 'degraded' }
  }

  // Monta o jsonb de nomes por-locale a partir do NOSSO conjunto de `ordem` (não do eco do LLM),
  // preenchendo com o nome traduzido (a fidelidade já garantiu que todos os `ordem` vieram). Guarda o
  // `nomeOrigem` (o `raw_text` traduzido) p/ o display revalidar contra o `raw_text` atual — assim uma
  // edição só-de-medida mantém a tradução e um rename/reorder cai no `raw_text` (nunca nome errado).
  // NULL quando não há ingrediente nomeado ⇒ o display cai no `raw_text` original.
  const nomeTraduzidoPorOrdem = new Map(
    (translated.ingredientes ?? []).map((i) => [i.ordem, i.nome] as const),
  )
  const ingredientesJsonb =
    ctx.ingredients.length > 0
      ? ctx.ingredients.map((s) => ({
          ordem: s.ordem,
          nome: nomeTraduzidoPorOrdem.get(s.ordem) ?? s.nome,
          nomeOrigem: s.nome,
        }))
      : null

  // Slug por idioma (#229, ADR-0020 dec.4): congela AGORA, a partir do título da MT INICIAL
  // (`translated.titulo`) — é ESTE insert que materializa o slug en-US; uma revisão posterior da
  // MT não o re-deriva (estabilidade > beleza). Desambiguado contra os slugs já em uso no locale.
  const slug = await slugForNewTranslation(db, { locale: targetLocale, title: translated.titulo })

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
      // Nome de ingrediente por-locale (#426) + versão do prompt que produziu a linha (habilita
      // backfill por-versão futuro). A medida NÃO é escrita aqui (fica em recipe_ingredient).
      ingredientes: ingredientesJsonb,
      promptVersion: TRANSLATION_PROMPT_VERSION,
      slug,
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
