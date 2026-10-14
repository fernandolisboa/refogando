import { unstable_cache } from 'next/cache'
import type { Database } from '@/db/client'
import { loadAppConfig } from '@/server/app-config'
import { selectVocabulary, type VocabularyTermView } from '@/server/vocabulary/load'
import type { SocialLink } from '@/domain/social-links-config'
import { APP_CONFIG_TAG, COZINHA_VOCAB_TAG } from '@/server/cache-tags'

/**
 * Leituras de banco do ROOT LAYOUT (`src/app/[locale]/layout.tsx`) no Data Cache do Next, com tag
 * (achado A da auditoria de performance, handoff 67). O layout envolve TODA página; enquanto ele lia o
 * banco a cada request (e o cookie do tema), nenhuma rota podia ser pré-renderizada. Com as duas
 * leituras cacheadas e o tema aplicado por script, as páginas que não leem nada do request
 * (`/privacidade`, `/seus-direitos`, `/guia`…) viram estáticas com ISR.
 *
 * O QUE é cacheado (uma entrada para todos; nada por viewer nem por idioma):
 *  - o vocabulário de cozinha no escopo `active` (as linhas cruas; o layout localiza por request);
 *  - de `app_config`, só o que o layout usa: o liga/desliga do "gerar 2" e os links sociais ligados.
 *    O resto da config (tetos, modelos, IA) segue lido ao vivo por quem usa (`loadAppConfig`, com o
 *    dedupe por request do `React.cache`).
 *
 * INVALIDAÇÃO por tag (`src/server/cache-tags.ts`, perfil `'max'`), nos Route Handlers que escrevem:
 *  - `COZINHA_VOCAB_TAG`: `POST`/`PATCH /api/admin/vocabulary` (criar, editar rótulo/nota, depreciar/
 *    reativar) e `POST /api/curate/cozinhas/[slug]/approve` (a sugestão vira `active`). Mesclar e
 *    rejeitar só levam uma `suggested` a lápide, e o "Outra" (`suggestCozinha`) só grava `suggested`:
 *    nenhum dos três muda o escopo `active`, então não expiram.
 *  - `APP_CONFIG_TAG`: `PUT /api/admin/config` (o único escritor de `app_config`).
 * `'max'` é stale-while-revalidate: o primeiro request depois do save ainda recebe o HTML/valor antigo e
 * dispara a regeneração, então o admin vê a mudança UM request depois. Não é `{ expire: 0 }` de
 * propósito: sem cópia velha, uma falha do banco antes da próxima visita viraria 500 nas páginas ISR (o
 * porquê está em cache-tags.ts).
 * A expiração por tempo (`LAYOUT_DATA_REVALIDATE_S`) é a rede para escrita fora do app (migração, SQL à
 * mão), e também é stale-while-revalidate: o valor novo aparece na primeira regeneração depois de ≥1 h
 * (o request que acha a entrada vencida ainda leva a antiga; com pouco tráfego, bem depois de 1 h), ou um
 * request depois de qualquer save no admin que expire a tag.
 */
export const LAYOUT_DATA_REVALIDATE_S = 3600

/** Vocabulário de cozinha `active`, lido direto do banco (sem o cache de 30 s por instância). */
export async function loadLayoutCozinhaVocab(db: Database): Promise<VocabularyTermView[]> {
  return unstable_cache(
    () => selectVocabulary(db, 'cozinha', 'active'),
    // Suba o 'v1' quando o formato guardado ou os defaults mudarem: o Data Cache da Vercel sobrevive ao deploy.
    ['layout', 'vocab-cozinha-active', 'v1'],
    { revalidate: LAYOUT_DATA_REVALIDATE_S, tags: [COZINHA_VOCAB_TAG] },
  )()
}

/** O recorte de `app_config` que o layout semeia na chrome. */
export type LayoutAppConfig = {
  // #423: o opt-in "gerar 2, o usuário escolhe" aparece só com a config ligada.
  variantEnabled: boolean
  // #451: links sociais do footer, JÁ filtrados por `enabled` (link desligado não vaza no HTML).
  socialLinks: SocialLink[]
}

export async function loadLayoutAppConfig(db: Database): Promise<LayoutAppConfig> {
  return unstable_cache(
    async (): Promise<LayoutAppConfig> => {
      const cfg = await loadAppConfig(db)
      return {
        variantEnabled: cfg.recipeVariant.enabled,
        socialLinks: cfg.socialLinks.filter((l) => l.enabled),
      }
    },
    // Suba o 'v1' quando o formato guardado ou os defaults mudarem: o Data Cache da Vercel sobrevive ao deploy.
    ['layout', 'app-config', 'v1'],
    { revalidate: LAYOUT_DATA_REVALIDATE_S, tags: [APP_CONFIG_TAG] },
  )()
}
