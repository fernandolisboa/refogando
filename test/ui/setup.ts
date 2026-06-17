/**
 * Setup do projeto "ui" (jsdom). Estende o expect do Vitest com os matchers do jest-dom
 * (toBeInTheDocument, etc.). Cleanup do Testing Library é automático: com `globals: true`
 * neste projeto, o @testing-library/react registra o afterEach de limpeza sozinho.
 * NÃO carrega o setup de banco do projeto node (sem DI/Postgres aqui).
 */
import '@testing-library/jest-dom/vitest'
