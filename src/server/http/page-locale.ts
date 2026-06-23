import { canonicalLocale, isSupportedLocale, resolveLocale, type Locale } from '@/i18n/locale'

/**
 * Resolve o locale da PÁGINA (issue #57, #228), PURO (sem `next/headers`): recebe os 3
 * insumos crus → devolve `Locale`.
 *
 * Locale-no-caminho (ADR-0020): com o app sob `[locale]`, o `params.locale` (urlLocale) é
 * SEMPRE presente e é a FONTE DA VERDADE do idioma exibido (chrome + `<html lang>`). A
 * precedência é urlLocale → cookie → Accept-Language, mas na prática o path sempre vence
 * (segmento dinâmico obrigatório); cookie/Accept-Language ficam só como rede de segurança
 * caso o path chegue inválido (defesa em profundidade; nunca tela quebrada).
 *
 * `isSupportedLocale`/`canonicalLocale` casam case-insensitive (`PT-br` → `pt-BR`).
 */
export function resolvePageLocale(input: {
  urlLocale?: string | null
  cookieLocale?: string | null
  acceptLanguage?: string | null
}): Locale {
  if (input.urlLocale && isSupportedLocale(input.urlLocale)) {
    return canonicalLocale(input.urlLocale)! // suportado ⇒ nunca null (forma canônica)
  }
  return resolveLocale({
    preferred: input.cookieLocale,
    acceptLanguage: input.acceptLanguage,
  })
}

/**
 * Resolve o locale do CONTEÚDO (qual tradução BUSCAR na API), distinto do locale da CHROME
 * (`resolvePageLocale`, dirigido pelo path). PURO.
 *
 * Existe por causa da jornada "ver o original" (#23/#57): a nota de tradução obsoleta linka
 * pra origem pra LER o corpo no idioma-fonte SEM trocar a chrome/o path. Com locale-no-caminho
 * (ADR-0020) o path é a verdade da chrome, então o segmento `[locale]` SEMPRE vence o `?locale`
 * legado — daí "ver o original" precisa de um escape EXPLÍCITO: `?original=<locale>`. Quando
 * presente e VÁLIDO, o conteúdo buscado é o do `original`; a chrome (`pageLocale`) permanece a
 * do path. Sem o escape (caso comum), conteúdo == chrome.
 *
 * `original` inválido/ausente → cai no `pageLocale` (nunca tela quebrada).
 */
export function resolveContentLocale(input: {
  pageLocale: Locale
  original?: string | null
}): Locale {
  if (input.original && isSupportedLocale(input.original)) {
    return canonicalLocale(input.original)! // suportado ⇒ nunca null (forma canônica)
  }
  return input.pageLocale
}
