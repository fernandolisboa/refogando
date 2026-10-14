import { revalidateTag, unstable_cache } from 'next/cache'
import type { Database } from '@/db/client'
import { loadAppConfig } from '@/server/app-config'
import { selectVocabulary, type VocabularyTermView } from '@/server/vocabulary/load'
import type { SocialLink } from '@/domain/social-links-config'

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
 * INVALIDAÇÃO por tag, expirando na hora (`{ expire: 0 }`), nos Route Handlers que escrevem:
 *  - `COZINHA_VOCAB_TAG`: `POST`/`PATCH /api/admin/vocabulary` (criar, editar rótulo/nota, depreciar/
 *    reativar) e `POST /api/curate/cozinhas/[slug]/approve` (a sugestão vira `active`). Mesclar e
 *    rejeitar só levam uma `suggested` a lápide, e o "Outra" (`suggestCozinha`) só grava `suggested`:
 *    nenhum dos três muda o escopo `active`, então não expiram.
 *  - `APP_CONFIG_TAG`: `PUT /api/admin/config` (o único escritor de `app_config`).
 * A expiração por tempo (`LAYOUT_DATA_REVALIDATE_S`) é a rede para escrita fora do app (migração,
 * SQL à mão): nesses casos o valor novo aparece em até 1 h, ou na hora se alguém salvar pelo admin.
 *
 * `revalidateTag` só roda em Route Handler ou Server Action (o Next recusa durante o render).
 */
export const COZINHA_VOCAB_TAG = 'vocab:cozinha'
export const APP_CONFIG_TAG = 'app-config'
export const LAYOUT_DATA_REVALIDATE_S = 3600

/** Vocabulário de cozinha `active`, lido direto do banco (sem o cache de 30 s por instância). */
export async function loadLayoutCozinhaVocab(db: Database): Promise<VocabularyTermView[]> {
  return unstable_cache(
    () => selectVocabulary(db, 'cozinha', 'active'),
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
    ['layout', 'app-config', 'v1'],
    { revalidate: LAYOUT_DATA_REVALIDATE_S, tags: [APP_CONFIG_TAG] },
  )()
}

/**
 * Expira a tag na hora. Chamado DEPOIS da escrita gravada: uma falha aqui só atrasa o valor novo no
 * layout (até `LAYOUT_DATA_REVALIDATE_S`), nunca transforma a escrita salva num 500. Por isso engole
 * o erro (com aviso no log) em vez de deixar o caller tratar.
 */
function expireTag(tag: string): void {
  try {
    revalidateTag(tag, { expire: 0 })
  } catch (err) {
    console.warn(`[layout-data] falha ao expirar a tag ${tag}; vale em até ${LAYOUT_DATA_REVALIDATE_S} s`, err)
  }
}

export function expireCozinhaVocabCache(): void {
  expireTag(COZINHA_VOCAB_TAG)
}

export function expireAppConfigCache(): void {
  expireTag(APP_CONFIG_TAG)
}
