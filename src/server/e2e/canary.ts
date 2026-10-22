/**
 * Título da Receita canário que o "Claude" do modo fake do E2E devolve (#589). Módulo SEM imports: é
 * lido pelos dublês (`./fakes.ts`, no bundle do servidor) e pelas specs do Playwright (`e2e/specs`), que
 * rodam fora do grafo com alias `@/`.
 */
export const E2E_CANARY_TITLE = 'Arroz de forno da fumaça'
