import { revalidateTag } from 'next/cache'

/**
 * Registro ÚNICO das tags do Data Cache do Next (`unstable_cache`) e o ÚNICO jeito de expirá-las
 * (`expireCacheTag`). Quem cria um cache com tag registra a tag AQUI, com o perfil de expiração, e quem
 * escreve chama `expireCacheTag` depois da escrita gravada.
 *
 * Prefixo `refogando:` de propósito: na Vercel o Data Cache e as tags podem ser compartilhados por mais
 * de um projeto do time, e uma tag genérica (`app-config`) colidiria com a de outro app.
 *
 * PERFIL por tag (decide o que o PRIMEIRO request depois da escrita vê):
 *  - `'max'` (stale-while-revalidate): marca a tag como vencida; o próximo request recebe o valor (ou o
 *    HTML ISR) antigo e o Next regenera em segundo plano, então quem salvou vê a mudança UM request
 *    depois. É o perfil OBRIGATÓRIO de toda tag lida por uma página estática/ISR: com `{ expire: 0 }` a
 *    página fica sem cópia velha, e se o banco falhar antes da próxima visita a regeneração bloqueante
 *    degrada, o `connection()` do layout aborta ("Page changed from static to dynamic") e a rota responde
 *    500 em todo request até o banco voltar (reproduzido com `next start`, handoff 67). Com `'max'`, a
 *    regeneração com o banco fora devolve o valor antigo do `unstable_cache` e a página segue servida.
 *  - `{ expire: 0 }`: expira na hora; o próximo request recalcula bloqueando. Só para tag lida apenas por
 *    página DINÂMICA (sem HTML em cache para perder), quando servir o valor antigo uma vez não serve.
 */
export const APP_CONFIG_TAG = 'refogando:app-config'
export const COZINHA_VOCAB_TAG = 'refogando:vocab:cozinha'
export const RECIPE_OF_WEEK_POPULAR_TAG = 'refogando:receita-da-semana:popularidade'

export type CacheTag = typeof APP_CONFIG_TAG | typeof COZINHA_VOCAB_TAG | typeof RECIPE_OF_WEEK_POPULAR_TAG

const EXPIRE_PROFILE: Record<CacheTag, 'max' | { expire: 0 }> = {
  // Lidas pelo root layout (`src/server/layout-data.ts`), logo por TODA página ISR.
  [APP_CONFIG_TAG]: 'max',
  [COZINHA_VOCAB_TAG]: 'max',
  // Lida só pela home, que é dinâmica (`generateMetadata` lê `searchParams`): sem HTML em cache, e uma
  // falha do banco no recálculo é a mesma de antes do cache. E `'max'` não serviria: o vencedor antigo tem
  // `computedAt` recente, então passaria pelo corte de idade de `loadRecipeOfTheWeek` (recipe-of-week.ts).
  // Se a home virar ISR, esta tag passa para `'max'` e o corte de idade precisa ser revisto.
  [RECIPE_OF_WEEK_POPULAR_TAG]: { expire: 0 },
}

/**
 * Expira a tag com o perfil registrado. Chamado DEPOIS da escrita gravada: uma falha aqui só atrasa o
 * valor novo (até a revalidação por tempo de quem usa a tag), nunca transforma a escrita salva num 500.
 * Por isso engole o erro, com aviso no log. Só em Route Handler ou Server Action (o Next recusa
 * `revalidateTag` durante o render).
 */
export function expireCacheTag(tag: CacheTag): void {
  try {
    revalidateTag(tag, EXPIRE_PROFILE[tag])
  } catch (err) {
    console.warn(`[cache-tags] falha ao expirar a tag ${tag}; o valor novo espera a revalidação por tempo`, err)
  }
}
