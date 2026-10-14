'use client'
/**
 * Reaplica a classe do tema (cookie `theme`) no `<html>` quando o React monta o documento no client.
 *
 * O caminho normal é o script pré-pintura do `<head>` (`THEME_INIT_SCRIPT`): o `<html>` sai do servidor
 * com `DEFAULT_THEME_CLASS`, o script troca a classe antes da pintura e a hidratação a preserva
 * (`suppressHydrationWarning`). Aqui é no-op.
 *
 * O caso que este componente cobre: o React renderiza o `<html>` no client, não hidrata. O `<html>` volta
 * com `DEFAULT_THEME_CLASS`, e o script, que o React insere via `dangerouslySetInnerHTML`, não roda de
 * novo. Acontece em dois casos:
 *  - quando o render do servidor lança antes de enviar qualquer HTML, por exemplo o 404 e o 500 da página
 *    da receita, que fica fora de `loading.tsx` para responder com status de verdade (handoff 71). O Next
 *    manda um shell vazio e o client monta tudo;
 *  - num erro de hidratação sem Suspense acima, em que o React refaz o documento inteiro.
 *
 * `useLayoutEffect`: aplica antes da pintura. O `ThemeToggle` acompanha a troca pelo `MutationObserver`.
 */
import { useLayoutEffect } from 'react'
import { THEME_COOKIE } from '@/lib/theme'
import { applyThemeFromCookie } from '@/lib/theme-apply'

export function ThemeCookieSync() {
  useLayoutEffect(() => {
    applyThemeFromCookie(document, THEME_COOKIE)
  }, [])
  return null
}
