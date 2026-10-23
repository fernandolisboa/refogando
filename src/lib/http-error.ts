/**
 * A chave de erro do corpo JSON das rotas (`{ error: '<chave>' }`, o formato de todos os route handlers), ou `null`
 * quando o corpo não tem essa forma ou não dá para ler. Para o cliente decidir a mensagem por código, sem lançar.
 * Usado pelos diálogos de excluir a própria conta e de eliminar a conta de outra pessoa no Console.
 */
export async function errorCode(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json()
    return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : null
  } catch {
    return null
  }
}
