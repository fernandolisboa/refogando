/**
 * Núcleo puro do tema claro/escuro (ADR-0018). Sem React, sem next/headers — só a
 * lógica de resolução do cookie → classe do `<html>`, testável em unit.
 *
 * Quem aplica a classe (achado A da auditoria de performance, handoff 67): o layout NÃO lê mais o
 * cookie (`cookies()` tornava toda rota dinâmica). O HTML do servidor sai sempre com
 * `DEFAULT_THEME_CLASS` e um script inline no `<head>` (`THEME_INIT_SCRIPT`) lê o cookie e troca a
 * classe ANTES da primeira pintura, como o next-themes. Assim o mesmo HTML serve a todos (cacheável)
 * e quem guardou 'dark' não vê flash. O client grava o cookie e alterna a classe (ThemeToggle).
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
 *  - ausente/desconhecido      → 'light' (padrão inicial, issue #208): emite `.light` no
 *    `<html>`, derrotando a @media do SO. O dono prefere claro como padrão; o SO só passa
 *    a valer se o usuário escolher 'dark' (cookie só é gravado ao alternar ativamente).
 * A precedência (classe vence a @media) é garantida pela ordem de fonte do CSS (ADR-0018).
 *
 * É a regra que o script inline (`applyThemeFromCookie`) reproduz; o teste de paridade compara os dois.
 */
export function resolveThemeClass(cookieValue: string | undefined | null): 'dark' | 'light' {
  if (cookieValue === 'dark') return 'dark'
  return 'light'
}

/**
 * Classe que o servidor emite no `<html>` para TODO visitante: a de quem não tem cookie (`'light'`).
 * Quem guardou 'dark' tem a classe trocada pelo script antes da pintura.
 */
export const DEFAULT_THEME_CLASS: Theme = resolveThemeClass(undefined)

/**
 * Corpo do script pré-pintura: lê o cookie `theme` de `doc.cookie` e deixa no `<html>` exatamente a
 * classe que o layout emitia quando lia o cookie no servidor (`resolveThemeClass` sobre o
 * `cookies().get(THEME_COOKIE)` do Next).
 *
 * AUTOSSUFICIENTE de propósito: vira texto via `toString()` (`THEME_INIT_SCRIPT`) e roda no navegador
 * antes de qualquer bundle, então NÃO pode chamar nada de fora (nem `resolveThemeClass`, nem
 * constantes do módulo); o nome do cookie entra por argumento. Sintaxe conservadora (sem `?.`/`??`):
 * o código do servidor não passa pelo downlevel do client.
 *
 * O parse espelha o do Next (`parseCookie` de @edge-runtime/cookies): separa por `; *`, par sem `=`
 * vale "true", o valor passa por `decodeURIComponent` (falha mantém o anterior) e o ÚLTIMO par com o
 * nome vence. O teste de paridade roda os dois sobre os mesmos cookies.
 *
 * Qualquer erro deixa a classe do servidor (claro), igual a um cookie ausente.
 */
export function applyThemeFromCookie(
  doc: { cookie: string; documentElement: { classList: DOMTokenList } },
  cookieName: string,
): void {
  try {
    let value: string | undefined
    const pairs = doc.cookie.split(/; */)
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]
      if (!pair) continue
      const eq = pair.indexOf('=')
      if (eq === -1) {
        if (pair === cookieName) value = 'true'
        continue
      }
      if (pair.slice(0, eq) !== cookieName) continue
      try {
        value = decodeURIComponent(pair.slice(eq + 1))
      } catch {
        // valor mal codificado: o Next também ignora o par e fica com o anterior
      }
    }
    const theme = value === 'dark' ? 'dark' : 'light'
    const classList = doc.documentElement.classList
    classList.remove(theme === 'dark' ? 'light' : 'dark')
    classList.add(theme)
  } catch {
    // sem cookie legível: fica a classe do servidor
  }
}

/**
 * O script inline do `<head>` (root layout). Roda síncrono durante o parse do `<head>`, antes do
 * `<body>` existir, então a primeira pintura já sai com a classe certa. A CSP (`next.config.ts`,
 * Report-Only) tem `script-src 'self' 'unsafe-inline'`: script inline sem nonce é permitido.
 */
export const THEME_INIT_SCRIPT = `(${applyThemeFromCookie.toString()})(document,${JSON.stringify(THEME_COOKIE)})`
