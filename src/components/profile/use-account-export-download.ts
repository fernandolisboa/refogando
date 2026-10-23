'use client'
/**
 * Baixar o export LGPD da conta (#595): `GET /api/me/export` por fetch + blob, salvo com o nome datado de
 * `accountExportFilename` (pelo relógio do navegador). Por que não um `<a href download>` direto: assim há
 * estado de "preparando" e uma mensagem localizada na falha, em vez de o navegador salvar um JSON de erro
 * como se fosse o arquivo.
 *
 * UMA instância por seção "Seus dados": a seção cria e passa ao diálogo de exclusão, então o botão de lá e o
 * de cá mostram o mesmo download, e o "Excluir definitivamente" espera ele acabar.
 *
 * "Já baixando" mora num ref (não no `status` do closure): dois cliques no mesmo render leriam o mesmo
 * status velho e baixariam duas vezes. `reset()` limpa o desfecho ("Download iniciado.", erro) quando o
 * diálogo fecha, mas não interrompe um download em andamento. `sessao` = 401: a sessão expirou, e tentar de
 * novo não adianta sem entrar outra vez.
 */
import { useCallback, useRef, useState } from 'react'
import { accountExportFilename } from '@/domain/account-export'

export type ExportDownloadStatus = 'idle' | 'downloading' | 'done' | 'error' | 'sessao'

export type AccountExportDownload = {
  status: ExportDownloadStatus
  download: () => Promise<void>
  reset: () => void
}

/** Safari e Firefox leem a URL do blob depois do clique: revogar na hora cancela o download. */
const REVOKE_AFTER_MS = 30_000

export function useAccountExportDownload(): AccountExportDownload {
  const [status, setStatus] = useState<ExportDownloadStatus>('idle')
  const baixandoRef = useRef(false)

  const download = useCallback(async () => {
    if (baixandoRef.current) return
    baixandoRef.current = true
    setStatus('downloading')
    try {
      const res = await fetch('/api/me/export')
      if (!res.ok) {
        setStatus(res.status === 401 ? 'sessao' : 'error')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = accountExportFilename(new Date())
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
      setStatus('done')
    } catch {
      setStatus('error')
    } finally {
      baixandoRef.current = false
    }
  }, [])

  const reset = useCallback(() => {
    setStatus((s) => (s === 'downloading' ? s : 'idle'))
  }, [])

  return { status, download, reset }
}
