/**
 * Persistência do Visitante (D9, #4.AC2). Helpers puros de leitura/escrita do cookie
 * `locale` — client-only, sem next/headers. Testáveis sem React (T4).
 */
export const LOCALE_COOKIE = 'locale'

export function readLocaleCookie(cookieString: string): string | null {
  const m = cookieString.match(/(?:^|;\s*)locale=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export function localeCookieValue(locale: string): string {
  // 1 ano; Path=/; SameSite=Lax. Cookie de locale é intencionalmente NÃO-HttpOnly e
  // NÃO-sensível: o provider client precisa lê-lo via document.cookie; é só preferência
  // de apresentação, nada de credencial. (Distinto do cookie de sessão do Better Auth,
  // esse sim HttpOnly.)
  return `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

/** Forma mínima de `document` que `applyLocaleSideEffects` precisa tocar. */
export type LocaleDocument = {
  cookie: string
  documentElement: { lang: string }
}

/**
 * Efeitos colaterais client de uma troca de locale (#4.AC1/AC2). UMA fonte única para os
 * dois efeitos que DEVEM andar juntos numa troca em runtime:
 *  1. persiste a preferência do Visitante no cookie (D9);
 *  2. sincroniza `<html lang>` com o locale exibido.
 *
 * O `<html>` é emitido pelo Server Component com `lang={initialLocale}`; o React do client
 * NÃO re-renderiza esse atributo numa troca em runtime. Sem o passo (2), trocar o idioma
 * atualizaria toda a chrome mas deixaria `<html lang>` preso no valor do SSR — divergência
 * de a11y/SEO (lang ≠ idioma exibido). Pura e testável em node com um `document` falso.
 */
export function applyLocaleSideEffects(doc: LocaleDocument, locale: string): void {
  doc.cookie = localeCookieValue(locale)
  doc.documentElement.lang = locale
}
