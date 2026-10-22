/**
 * Corpo de resposta em streaming a partir de um gerador de texto (#595, o export da conta): um pedaço por
 * `pull`, então o próximo só é produzido (e o banco só é consultado) quando o cliente lê o anterior.
 *
 * Cancelamento (aba fechada, navegação, um HEAD): o `cancel` marca a flag e encerra o gerador (`return`),
 * que para de consultar as seções que faltam. Um `pull` que estava esperando o `next()` volta sem
 * enfileirar nem fechar (o `enqueue` num stream cancelado lança `ERR_INVALID_STATE`) e nunca chama
 * `onError`: cliente que desiste não é erro de servidor.
 *
 * Falha do gerador com o cliente ainda lendo: `onError` (a linha de log da rota) e o stream erra, o que
 * derruba a conexão; o cliente vê erro de rede, nunca um corpo cortado com cara de completo.
 */
export function textChunkStream(
  chunks: AsyncGenerator<string>,
  onError: (err: unknown) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: IteratorResult<string>
      try {
        next = await chunks.next()
      } catch (err) {
        if (cancelled) return
        onError(err)
        controller.error(err)
        return
      }
      if (cancelled) return
      if (next.done) controller.close()
      else controller.enqueue(encoder.encode(next.value))
    },
    cancel() {
      cancelled = true
      // Sem `await`: com um `next()` pendente, o `return` só resolve depois dele; o cancelamento não espera
      // a consulta em curso. A rejeição (se houver) já foi tratada no `pull`.
      void chunks.return(undefined).catch(() => undefined)
    },
  })
}
