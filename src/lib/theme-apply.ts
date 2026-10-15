/**
 * A regra que põe no `<html>` a classe do cookie `theme` (ADR-0018). Dois usos:
 *  - o script pré-pintura do `<head>` (`THEME_INIT_SCRIPT`, em `./theme-script.ts`, só do servidor), que
 *    vira texto via `toString()`;
 *  - o `ThemeCookieSync` (client), que reaplica a classe quando o React monta o `<html>` no client sem o
 *    script ter rodado (ver o comentário dele).
 * Este módulo não tem o texto do script, então pode ir no bundle do client.
 */

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
