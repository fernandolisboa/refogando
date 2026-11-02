import type { Database } from '@/db/client'
import { recipeTranslation } from '@/db/schema'
import { getTranslator } from '@/server/deps'
import { embedTranslation } from '@/server/embedding/recompute'
import { loadRecipeTranslationContext } from '@/server/recipe/load'
import { slugForNewTranslation } from '@/server/recipe/slug'
import { TRANSLATION_PROMPT_VERSION } from '@/domain/translation-prompt'
import { sourceFingerprintOf, mtFingerprintOfRow } from '@/domain/translation-fingerprint'
import { retranslateFailKey } from '@/domain/translation-divergent-stale'
import { isTranslationInputTooLarge } from '@/domain/translation-flight'
import { isRowSpecificTranslationFailure, type TranslateOutput } from '@/server/translation/translator'
import {
  abandonTranslationFlight,
  claimTranslationFlight,
  completeTranslationFlight,
  failTranslationFlight,
  type TranslationQuota,
} from '@/server/translation/flight'

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
 *
 * Guardas de custo (#642, ADR-0056), entre o passo 1 e o 2:
 *  - entrada acima de `TRANSLATION_MAX_INPUT_CHARS` ⇒ `too_large`, sem chamar o modelo;
 *  - `claimTranslationFlight` (tx curta sob a advisory lock do par): outro pedido em voo ⇒ `in_progress`; falha
 *    recente com a mesma fonte+versão ⇒ `cooling_down`; senão reserva a cota do usuário (`quota`, só a rota passa;
 *    estourou ⇒ LANÇA `QuotaExceededError`) e toma o lease;
 *  - a falha do tradutor grava o cache negativo; o sucesso apaga o estado do par.
 * Os desfechos novos degradam como o `degraded` (a rota devolve a view no original).
 */

export type EnsureResult =
  | { kind: 'created' }
  | { kind: 'exists' }
  | { kind: 'degraded' }
  | { kind: 'too_large' }
  | { kind: 'in_progress' }
  | { kind: 'cooling_down' }

export async function ensureTranslation(
  db: Database,
  recipeId: string,
  targetLocale: string,
  quota?: TranslationQuota,
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

  const fields = {
    titulo: source.titulo,
    descricao: source.descricao,
    passos: source.passos,
    notas: source.notas,
  }

  // #642: entrada grande demais estouraria o `max_tokens` e pagaria a chamada para nada (L-7: os campos não têm
  // tamanho máximo). Sem lease nem cota: a checagem é pura e barata.
  if (isTranslationInputTooLarge({ fields, ingredientes: ctx.ingredients, cozinha: ctx.cozinha })) {
    return { kind: 'too_large' }
  }

  // Fingerprints de conteúdo (#496, ADR-0031): carimbam a FONTE de onde esta MT saiu (gravado abaixo) e servem de
  // chave do cache negativo (#642), a mesma do circuit-breaker do #520: fonte editada ou prompt novo ⇒ chave nova.
  const sourceFingerprint = sourceFingerprintOf(fields, ctx.ingredients)
  const failKey = retranslateFailKey(sourceFingerprint, TRANSLATION_PROMPT_VERSION)

  // Single-flight + cache negativo + cota (#642). `QuotaExceededError` sobe para a rota (429).
  const claim = await claimTranslationFlight(db, { recipeId, locale: targetLocale, failKey, quota })
  if (claim.kind !== 'claimed') return { kind: claim.kind }
  const flight = { recipeId, locale: targetLocale, leaseId: claim.leaseId }

  // Traduz título/corpo + NOMES de ingrediente (#426). LANÇA (falha OU infidelidade) ⇒ degrada SEM
  // escrever a tradução (AC4: cai pro original, sem erro técnico) e grava o cache negativo (#642). A MEDIDA nunca
  // entra no payload (Direção B).
  let translated
  try {
    translated = await getTranslator().translate({
      sourceLocale: ctx.originalLocale,
      targetLocale,
      fields,
      ingredientes: ctx.ingredients,
      contexto: { cozinha: ctx.cozinha },
    })
  } catch (err) {
    await failTranslationFlight(db, { ...flight, failKey, rowSpecific: isRowSpecificTranslationFailure(err) })
    return { kind: 'degraded' }
  }

  try {
    await persistTranslation(db, { recipeId, targetLocale, ctx, translated, sourceFingerprint })
  } catch (err) {
    // Erro inesperado no slug/INSERT: solta o lease (sem cache negativo) e deixa o erro subir como antes.
    await abandonTranslationFlight(db, flight)
    throw err
  }
  await completeTranslationFlight(db, flight)

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

type TranslationContext = NonNullable<Awaited<ReturnType<typeof loadRecipeTranslationContext>>>

/** Grava a linha do 2º locale a partir da saída do tradutor (slug congelado + fingerprints + insert idempotente). */
async function persistTranslation(
  db: Database,
  input: {
    recipeId: string
    targetLocale: string
    ctx: TranslationContext
    translated: TranslateOutput
    sourceFingerprint: string
  },
): Promise<void> {
  const { recipeId, targetLocale, ctx, translated, sourceFingerprint } = input

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

  // Fingerprints de conteúdo (#496, ADR-0031): a FONTE (`sourceFingerprint`, calculado antes da chamada) e o que
  // a MT PRODUZIU, carimbados no MESMO instante da escrita. O `mtFingerprint` usa EXATAMENTE os valores persistidos
  // abaixo (titulo/descricao/passos/notas + o mapa ordem→nome do jsonb) — senão a comparação futura
  // "intocada" nunca bateria. A medida fica fora (Direção B). Habilita a re-tradução pull da fatia B.
  // Os dois helpers (`sourceFingerprintOf`/`mtFingerprintOfRow`, translation-fingerprint.ts) são a
  // MESMA construção que `retranslateOutdated` (#499) usa para recomputar o hash-de-comparação —
  // fonte única entre escrita e leitura, sem chance de drift.
  const mtFingerprint = mtFingerprintOfRow({
    titulo: translated.titulo,
    descricao: translated.descricao ?? null,
    passos: translated.passos ?? null,
    notas: translated.notas ?? null,
    ingredientes: ingredientesJsonb,
  })

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
      // Carimbos de frescor (#496, ADR-0031): esta linha nasce INTOCADA e NÃO-defasada.
      sourceFingerprint,
      mtFingerprint,
      slug,
      provenance: 'automatica_nao_revisada',
      stale: false,
    })
    .onConflictDoNothing({
      target: [recipeTranslation.recipeId, recipeTranslation.locale],
    })
}
