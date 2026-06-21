/**
 * Núcleo puro do tema claro/escuro (ADR-0018). Sem React, sem next/headers — só a
 * lógica de resolução do cookie → classe do `<html>`, testável em unit. Espelha o
 * padrão do locale (src/i18n/locale.ts + cookie.ts): o servidor lê o cookie e emite a
 * classe no SSR (sem flash), o client grava o cookie e alterna a classe.
 *
 * `THEME_COOKIE` é a fonte única do nome do cookie. NÃO-HttpOnly e não-sensível: é só
 * preferência de apresentação (o client precisa lê-lo/gravá-lo via document.cookie),
 * nada de credencial — igual ao cookie de locale.
 */
export const THEME_COOKIE = 'theme'

export type Theme = 'light' | 'dark'

/**
 * Resolve a classe a pôr no `<html>` a partir do valor cru do cookie `theme`.
 *  - 'dark'/'light' explícito  → essa classe (o usuário forçou um tema);
 *  - ausente/desconhecido      → '' (sem classe): o SO decide via @media do globals.css.
 * A precedência (classe vence a @media) é garantida pela ordem de fonte do CSS (ADR-0018).
 */
export function resolveThemeClass(cookieValue: string | undefined | null): '' | 'dark' | 'light' {
  if (cookieValue === 'dark') return 'dark'
  if (cookieValue === 'light') return 'light'
  return ''
}
