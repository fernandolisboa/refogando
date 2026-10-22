/**
 * Instrumentação do NAVEGADOR (Next: roda depois do HTML e antes da hidratação). Hoje só instala os
 * listeners de erro de janela do #590 (ADR-0048) — fora de produção é no-op. Leve e blindado: um erro aqui
 * não pode impedir a página de hidratar.
 */
import { installClientErrorListeners } from '@/lib/client-error-report'

try {
  installClientErrorListeners(window)
} catch {
  // sem relato de erro nesta carga; a página segue.
}
