import { getDb, getImageStore } from '@/server/deps'
import { backfillImageDerivatives } from '@/server/images/derivatives-backfill'

/**
 * Cron do BACKFILL dos derivados WebP da Imagem da receita (achado I da auditoria de performance,
 * migração 0077; handoff 69). GET diário (Vercel Cron — ver `vercel.json`) que preenche, em lote pequeno,
 * `recipe_image.thumb_url`/`detail_url` das imagens anteriores à 0077 (ou cujos derivados falharam na
 * criação). NÃO DESTRUTIVO e idempotente: só lê o original e só preenche colunas NULL (detalhes em
 * `backfillImageDerivatives`). Quando a fila zera, cada passada é um `count(*)` e nada mais.
 *
 * Toda passada termina com UMA linha `[image-derivatives]` com as contagens (só números), no estilo do
 * `[account-purge]`: é o que mostra o progresso nos logs da Vercel (o painel de crons só guarda o status).
 * Falha de UMA imagem não falha a passada (conta em `falhas` e vai para o fim da fila); só um erro
 * inesperado (banco fora) responde 500, com o nome do erro no log.
 *
 * FAIL-CLOSED (mesmo padrão de account-purge/dsar-sla/rate-limit-cleanup): exige
 * `Authorization: Bearer ${CRON_SECRET}`. SEM `CRON_SECRET` no ambiente OU header ausente/errado → 401.
 * Para drenar a fila mais rápido que uma passada por dia, rode o job à mão no painel da Vercel
 * (Settings → Cron Jobs → Run): cada execução é mais um lote.
 */

export const runtime = 'nodejs' // postgres-js + sharp exigem Node, não Edge.
export const dynamic = 'force-dynamic' // nunca cacheia; roda a passada a cada disparo.
// O lote para de começar imagem nova aos 40 s (`DERIVATIVES_BACKFILL_BUDGET_MS`); 60 s dá folga à última.
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  // Fail-closed: sem secret no ambiente OU header != "Bearer <secret>" → 401.
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const counts = await backfillImageDerivatives(getDb(), getImageStore())
    const restantes = counts.pendentes - counts.preenchidas
    const summary = Object.entries({ ...counts, restantes })
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    console.info(`[image-derivatives] passada concluída: ${summary}`)
    return Response.json({ ...counts, restantes })
  } catch (err) {
    console.warn(`[image-derivatives] passada com falha: ${err instanceof Error ? err.name : 'erro'}`)
    return Response.json({ error: 'falha' }, { status: 500 })
  }
}
