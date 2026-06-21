/**
 * Aviso de contradição de restrição (#7/#57) — componente PURO, sem hooks. Recebe um
 * `AvisoView` (a `mensagem` JÁ vem renderizada no locale pela rota) + `title` (rótulo de
 * a11y). Toque LEVE (CONTEXT.md): informa, NUNCA bloqueia/suprime/gateia a leitura.
 *
 * Compõe a primitiva `Alert` (ADR-0018) na variante `aviso` (ÂMBAR `bg-aviso-bg`/`text-aviso-fg`,
 * par AA já verificado na #54, ADR-0004) — estrutura + skin Refogando, nenhuma cor nova.
 *
 * `role="note"` (não o default `role="alert"`): é leitura leve, não interrompe o leitor de
 * tela. O `title` é o TÍTULO VISÍVEL (`AlertTitle`, protótipo) e a `mensagem` "declarado, não
 * verificado" vai na `AlertDescription`. SEM `aria-label` (o título visível já nomeia a nota —
 * aria-label duplicaria o nome acessível).
 */
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import type { AvisoView } from '@/domain/recipe-read'

export function RestrictionWarning({ aviso, title }: { aviso: AvisoView; title: string }) {
  return (
    <Alert variant="aviso" role="note">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{aviso.mensagem}</AlertDescription>
    </Alert>
  )
}
