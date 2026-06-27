import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { vocabularyTerm } from '@/db/schema'
import { slugify } from '@/domain/handle'
import { foldIntent } from '@/domain/culinary-profile'

/**
 * Fluxo "Outra" → termo `suggested` (issue #319, ADR-0025 Decisão 5).
 *
 * O usuário que não acha sua cozinha escolhe "Outra" e digita livre; este módulo transforma esse
 * texto num slug controlado e o materializa como termo `suggested` em `vocabulary_term`, para a
 * fila do Curador (#320). NÃO valida contra o conjunto ativo — é o ÚNICO write-path bimodal que
 * admite gravar um `suggested` (a borda de validação normal exige `active`).
 *
 * DEDUP NA ENTRADA (ADR-0025 Decisão 5): o slug colapsa sobre o `UNIQUE(slug)` cru. Uma única
 * consulta procura QUALQUER linha com esse slug, em QUALQUER status:
 *  - `active`/`deprecated` ⇒ é a MESMA cozinha (reusa o slug, não cria nada);
 *  - `suggested`           ⇒ ANEXA a receita ao pendente (um `suggested` é multi-owner);
 *  - `merged`/`rejected`   ⇒ lápide (tombstone): reusa o slug, contido (sem re-sugerir duplicata/
 *                            ofensa conhecida). Casar em TODOS os status é o que impede um futuro
 *                            tombstone de estourar a UNIQUE no INSERT (500).
 * Achou qualquer um ⇒ devolve o slug SEM inserir. Senão, INSERT `status='suggested'` (default do
 * schema) com labels NULL (o Curador preenche na aprovação, #320), `onConflictDoNothing` na
 * UNIQUE(slug) p/ corrida (dois "Outra" idênticos concorrentes ⇒ um insere, o outro vira no-op).
 *
 * GUARDA DE VAZIO: texto só de símbolo/espaço (`'!!!'`, `'   '`) dobra para slug `''` — devolve
 * `null` para o caller tratar como "sem cozinha" (jamais inserir uma linha de slug vazio que a FK
 * de `recipe.cozinha` apontaria).
 *
 * `_recipeOwnerId` fica na assinatura por paridade/proveniência, mas é INUSADO no v1 (o termo não
 * tem coluna de dono — o "anexar" é implícito via a FK `recipe.cozinha`); a curadoria (#320)
 * resolve dono a partir das receitas anexadas.
 */
export async function suggestCozinha(
  db: Database,
  rawText: string,
  _recipeOwnerId?: string,
): Promise<string | null> {
  void _recipeOwnerId // v1: sem coluna de dono no termo; param fica por paridade/proveniência (#320).
  const slug = slugify(foldIntent(rawText))
  if (slug === '') return null

  // UMA consulta, casando TODOS os status (a UNIQUE(slug) garante ≤1 linha): existe ⇒ reusa/anexa.
  const [existing] = await db
    .select({ status: vocabularyTerm.status })
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, slug)))
  if (existing) return slug

  // Novo termo: nasce `suggested` (default do schema), labels NULL (Curador completa em #320).
  // `onConflictDoNothing` na UNIQUE(slug) torna a entrada idempotente e segura sob corrida.
  await db
    .insert(vocabularyTerm)
    .values({ kind: 'cozinha', slug, status: 'suggested' })
    .onConflictDoNothing({ target: vocabularyTerm.slug })
  return slug
}
