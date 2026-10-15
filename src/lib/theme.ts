/**
 * Núcleo puro do tema claro/escuro (ADR-0018). Sem React, sem next/headers — só a
 * lógica de resolução do cookie → classe do `<html>`, testável em unit.
 *
 * Quem aplica a classe (achado A da auditoria de performance, handoff 67): o layout NÃO lê mais o
 * cookie (`cookies()` tornava toda rota dinâmica). O HTML do servidor sai sempre com
 * `DEFAULT_THEME_CLASS` e um script inline no `<head>` (`THEME_INIT_SCRIPT`, em `./theme-script.ts`)
 * lê o cookie e troca a classe ANTES da primeira pintura, como o next-themes. Assim o mesmo HTML serve
 * a todos (cacheável) e quem guardou 'dark' não vê flash. O client grava o cookie e alterna a classe
 * (ThemeToggle).
 *
 * Este módulo é importado pelo ThemeToggle (client): só constantes e a regra pura, NADA do script (o texto
 * dele vive em `./theme-script.ts`, importado só pelo layout, para não ir no bundle do client; a função
 * que ele roda, em `./theme-apply.ts`).
 *
 * `THEME_COOKIE` é a fonte única do nome do cookie. NÃO-HttpOnly e não-sensível: é só
 * preferência de apresentação (o client precisa lê-lo/gravá-lo via document.cookie),
 * nada de credencial — igual ao cookie de locale.
 */
export const THEME_COOKIE = 'theme'

/** Todos os temas; o teste de paridade do script gera casos para cada um. */
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/**
 * Resolve a classe a pôr no `<html>` a partir do valor cru do cookie `theme`.
 *  - 'dark'/'light' explícito  → essa classe (o usuário forçou um tema);
 *  - ausente/desconhecido      → 'light' (padrão inicial, issue #208): emite `.light` no
 *    `<html>`, derrotando a @media do SO. O dono prefere claro como padrão; o SO só passa
 *    a valer se o usuário escolher 'dark' (cookie só é gravado ao alternar ativamente).
 * A precedência (classe vence a @media) é garantida pela ordem de fonte do CSS (ADR-0018).
 *
 * É a regra que o script inline (`applyThemeFromCookie`, theme-script.ts) reproduz; o teste de paridade
 * compara os dois.
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
