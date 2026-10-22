import { getDb, getImageStore } from '@/server/deps'
import { backfillImageDerivatives } from '@/server/images/derivatives-backfill'
import { isAuthorizedCron } from '@/server/http/cron-auth'

/**
 * Cron do BACKFILL dos derivados WebP da Imagem da receita (achado I da auditoria de performance,
 * migração 0077; handoff 69). GET diário (Vercel Cron — ver `vercel.json`) que preenche, em lote pequeno,
 * `recipe_image.thumb_url`/`detail_url` das imagens anteriores à 0077 (ou cujos derivados falharam na
 * criação). NÃO DESTRUTIVO e idempotente: só lê o original e só preenche colunas NULL (detalhes em
 * `backfillImageDerivatives`). A fila exclui imagem moderada e imagem tentada nos últimos 7 dias: com
 * ela vazia, a passada é uma contagem e nada mais; uma falha permanente (imagem animada, formato que não
 * ganha derivado, original sumido) volta uma vez por semana, custa um download e sai de novo.
 *
 * Toda passada termina com UMA linha `[image-derivatives]` com as contagens (só números), no estilo do
 * `[account-purge]`: é o que mostra o progresso nos logs da Vercel (o painel de crons só guarda o status).
 * `nuncaTentadasRestantes=0` ⇒ o backfill já passou por todas as imagens antigas; `restantes` é a fila
 * depois da passada (recontada). Falha de UMA imagem não falha a passada (conta em `falhas` e sai da
 * fila por uma semana); só um erro inesperado (banco fora) responde 500, com o nome do erro no log.
 *
 * FAIL-CLOSED (mesmo padrão de account-purge/dsar-sla/rate-limit-cleanup): exige
 * `Authorization: Bearer ${CRON_SECRET}`. SEM `CRON_SECRET` no ambiente OU header ausente/errado → 401.
 * Para drenar a fila mais rápido que uma passada por dia, rode o job à mão no painel da Vercel
 * (Settings → Cron Jobs → Run): cada execução é mais um lote.
 */

export const runtime = 'nodejs' // postgres-js + sharp exigem Node, não Edge.
export const dynamic = 'force-dynamic' // nunca cacheia; roda a passada a cada disparo.
// O lote não começa imagem nova com menos de 15 s dos 40 s do orçamento (ou seja, depois dos 25 s); o
// pior caso de uma imagem (~30 s com os timeouts de download e do sharp) ainda cabe nos 60 s.
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  // Fail-closed: sem secret no ambiente OU header != "Bearer <secret>" → 401 (comparação em tempo constante).
  if (!isAuthorizedCron(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const counts = await backfillImageDerivatives(getDb(), getImageStore())
    const summary = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    console.info(`[image-derivatives] passada concluída: ${summary}`)
    return Response.json(counts)
  } catch (err) {
    console.warn(`[image-derivatives] passada com falha: ${err instanceof Error ? err.name : 'erro'}`)
    return Response.json({ error: 'falha' }, { status: 500 })
  }
}
