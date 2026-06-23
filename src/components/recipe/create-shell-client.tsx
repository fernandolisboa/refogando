'use client'
/**
 * Shell client da rota `/create` (#191, ADR-0021 dec. 2). A tela de página inteira morreu; a
 * rota vira um SHELL FINO que ABRE o drawer "Nova receita", semeado pelos deep-links que já
 * existiam — `?q` (ponte "gerar com IA" da Busca, #166 → Prompt aberto preenchido), `?resume`
 * e `?mode=conversa` (retomada de Conversa). A URL e seus três deep-links SOBREVIVEM.
 *
 * `useSearchParams` é o motivo do `<Suspense>` no Server Component pai (exigência do Next para
 * leitura de search params no build de produção). Fechar o drawer aqui não navega para lugar
 * nenhum — o usuário fica na `/create` com o drawer fechado (a chrome do shell por baixo).
 */
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreateDrawer } from './create-drawer'

export function CreateShellClient() {
  const params = useSearchParams()
  const initialQ = params.get('q') ?? undefined
  const resume = params.get('resume') ?? undefined
  const conversaHint = params.get('mode') === 'conversa'

  // O drawer abre ao montar a rota /create. Fechá-lo NÃO navega (fica na /create).
  const [open, setOpen] = useState(true)

  return (
    <CreateDrawer
      open={open}
      onOpenChange={setOpen}
      initialQ={initialQ}
      resumeSessionId={resume}
      conversaHint={conversaHint}
    />
  )
}
