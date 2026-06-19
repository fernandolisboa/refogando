'use client'
/**
 * Orquestrador client da tela CRIAR unificada (#104 S5). DUAS entradas convergem numa só URL
 * (`/create`) com um toggle EXTERNO Formulário ↔ Conversa:
 *  - Formulário: `CreateStructuredExperience` INALTERADA (#58 estruturado + #88 prompt aberto,
 *    com o seu PRÓPRIO toggle interno Estruturado ↔ Prompt aberto — daí o `labelId` distinto
 *    deste toggle externo, para os dois segmented controls não colidirem de id).
 *  - Conversa: `ConversaFocusedView` (#60 reusado como VISTA FOCADA), recebendo o
 *    `resumeSessionId` vindo de `?resume`.
 *
 * `?mode`/`?resume` são DICAS INICIAIS lidas de `useSearchParams` (este é o PRIMEIRO consumidor
 * de `useSearchParams` do repo → o caller embrulha em <Suspense>). O modo é estado LOCAL
 * (`useState`) semeado a partir das dicas — NÃO há `router.push`: alternar o toggle só troca o
 * estado local, sem reescrever a URL.
 */
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { CreateStructuredExperience } from './create-structured-experience'
import { ConversaFocusedView } from './conversa-focused-view'
import { SortToggle } from './sort-toggle'

type OuterMode = 'structured' | 'conversa'

export function CreatePageClient() {
  const { messages } = useLocale()
  const m = messages.criar
  const params = useSearchParams()
  const resume = params.get('resume') ?? undefined
  const modeHint = params.get('mode')

  // Semente do modo a partir das dicas da URL: Conversa quando `?mode=conversa` OU `?resume`
  // está presente (retomar uma conversa cai direto no Modo Conversa); senão Formulário. Estado
  // LOCAL: alternar o toggle não reescreve a URL.
  const [mode, setMode] = useState<OuterMode>(
    modeHint === 'conversa' || resume ? 'conversa' : 'structured',
  )

  return (
    <div className="flex flex-col gap-8">
      {/* Toggle EXTERNO Formulário ↔ Conversa. `labelId` DISTINTO (`create-outer-mode-label`)
          do toggle interno do estruturado (`create-mode-label`) — sem colisão de id. */}
      <SortToggle<OuterMode>
        value={mode}
        onChange={setMode}
        options={[
          { key: 'structured', label: m.modoFormulario },
          { key: 'conversa', label: m.modoConversa },
        ]}
        groupLabel={m.seletorModo}
        labelId="create-outer-mode-label"
      />

      {mode === 'structured' ? (
        <CreateStructuredExperience />
      ) : (
        <ConversaFocusedView resumeSessionId={resume} />
      )}
    </div>
  )
}
