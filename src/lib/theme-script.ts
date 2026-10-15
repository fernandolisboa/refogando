import { THEME_COOKIE } from '@/lib/theme'
import { applyThemeFromCookie } from '@/lib/theme-apply'

export { applyThemeFromCookie }

/**
 * O script pré-pintura do tema (ADR-0018; achado A da auditoria de performance, handoff 67). SÓ PARA O
 * SERVIDOR: importado pelo root layout (`src/app/[locale]/layout.tsx`) e pelos testes, nunca por
 * componente client. `THEME_INIT_SCRIPT` é calculado no carregamento do módulo (`toString()`), então
 * importá-lo de um client levaria a função e o texto para o bundle do navegador. O que o client precisa
 * (`THEME_COOKIE`, `DEFAULT_THEME_CLASS`, `Theme`) fica em `./theme.ts`. O repo não usa o pacote
 * `server-only`; a regra é só esta. A função que o script roda mora em `./theme-apply.ts` (sem o texto), que
 * o client pode importar (`ThemeCookieSync`).
 */

/**
 * O script inline do `<head>` (root layout). Roda síncrono durante o parse do `<head>`, antes do
 * `<body>` existir, então a primeira pintura já sai com a classe certa. A CSP (`next.config.ts`,
 * Report-Only) tem `script-src 'self' 'unsafe-inline'`: script inline sem nonce é permitido.
 */
export const THEME_INIT_SCRIPT = `(${applyThemeFromCookie.toString()})(document,${JSON.stringify(THEME_COOKIE)})`
