/**
 * Limites da Sugestão de cardápio (ADR-0036) que a UI também usa. Módulo SEM dependências: o
 * `menu-suggestion.ts` declara schemas zod no topo, e um client component que importasse dele só uma
 * constante arrastaria o zod inteiro (~65 KB gzip) para o bundle da página.
 */

/** Tamanho máximo da nota livre ("jantares leves, peixe na sexta"). */
export const MENU_NOTE_MAX = 200
