import { THEME_COOKIE } from '@/lib/theme'

/**
 * O script pré-pintura do tema (ADR-0018; achado A da auditoria de performance, handoff 67). SÓ PARA O
 * SERVIDOR: importado pelo root layout (`src/app/[locale]/layout.tsx`) e pelos testes, nunca por
 * componente client. `THEME_INIT_SCRIPT` é calculado no carregamento do módulo (`toString()`), então
 * importá-lo de um client levaria a função e o texto para o bundle do navegador. O que o client precisa
 * (`THEME_COOKIE`, `DEFAULT_THEME_CLASS`, `Theme`) fica em `./theme.ts`. O repo não usa o pacote
 * `server-only`; a regra é só esta.
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

/**
 * O script inline do `<head>` (root layout). Roda síncrono durante o parse do `<head>`, antes do
 * `<body>` existir, então a primeira pintura já sai com a classe certa. A CSP (`next.config.ts`,
 * Report-Only) tem `script-src 'self' 'unsafe-inline'`: script inline sem nonce é permitido.
 */
export const THEME_INIT_SCRIPT = `(${applyThemeFromCookie.toString()})(document,${JSON.stringify(THEME_COOKIE)})`
