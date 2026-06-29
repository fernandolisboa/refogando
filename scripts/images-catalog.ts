// Geração de imagem em LOTE p/ o catálogo (#238, ADR-0026 emenda dec.13) — gera UMA imagem por IA p/
// cada receita de catálogo APROVADA que ainda NÃO tem face (`owner_id IS NULL AND curation_status=
// 'approved' AND image_id IS NULL`). Zera o acúmulo de aprovadas-sem-imagem (pré-emenda, ou se a
// auto-gen na aprovação falhou/foi pulada). Irmão do seed-catalog.ts.
//
// É um passo de DADOS (não migração): `tsx --env-file=.env.local scripts/images-catalog.ts`. O
// .env.local aponta pro DB de PRODUÇÃO **e precisa das credenciais de imagem** (chave Gemini +
// token do Blob) — as MESMAS da geração ao vivo. CUSTA DINHEIRO: ~7¢ USD (~R$0,36) por imagem
// gerada (ledger `image_generation`). Idempotente por construção: pula quem já tem face.
//
// AUTO-SELECIONA a face (núcleo, autoSelect=true) e escreve no ledger (custo). Cada geração é
// independente — uma falha (Gemini/Blob fora) NÃO aborta o lote (loga e segue).
//
// ANTI-CORRIDA com a auto-gen da aprovação (dec.12): re-checa `image_id IS NULL` imediatamente antes
// de gerar (mitiga TOCTOU). Ainda assim, **evite rodar o lote durante curadoria ativa** (aprovar
// dispara a auto-gen) — rode-o numa janela tranquila.
//
// Uso:
//   npm run images-catalog                      # gera p/ todas as aprovadas-sem-imagem
//   npm run images-catalog -- --dry-run         # só conta quantas gerariam, sem gastar
//   npm run images-catalog -- --curator=<uuid>  # ator do ledger (default: primeiro admin)
//   npm run images-catalog -- --limit=20        # teto de gerações nesta rodada (controle de gasto)
import { and, eq, isNull } from 'drizzle-orm'
import { makeSql, makeDb } from '@/db/client'
import { recipe, users } from '@/db/schema'
import { getImageStore, getImageGenerator } from '@/server/deps'
import { applyCatalogImageGeneration } from '@/server/curate/catalog-image'

function argValue(name: string): string | undefined {
  const pre = `--${name}=`
  return process.argv.find((a) => a.startsWith(pre))?.slice(pre.length)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const curatorArg = argValue('curator')
  const limitArg = argValue('limit')
  const limit = limitArg ? Math.max(0, Number.parseInt(limitArg, 10) || 0) : Infinity

  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  if (!url) {
    console.error('Defina DATABASE_URL (ou rode com `npm run images-catalog`, que carrega .env.local).')
    process.exit(1)
  }

  const sql = makeSql(url, { max: 1 })
  const db = makeDb(sql)
  try {
    // Ator do ledger: o curador (dono). --curator=<uuid> ou o primeiro admin.
    let curatorId = curatorArg
    if (!curatorId) {
      const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1)
      if (!admin) {
        console.error('Nenhum usuário admin encontrado — passe --curator=<uuid>.')
        process.exit(1)
      }
      curatorId = admin.id
    }

    // Aprovadas de catálogo SEM face.
    const pendentes = await db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(isNull(recipe.ownerId), eq(recipe.curationStatus, 'approved'), isNull(recipe.imageId)))
    console.log(`Aprovadas de catálogo SEM imagem: ${pendentes.length}.`)

    if (dryRun) {
      const n = Number.isFinite(limit) ? Math.min(limit, pendentes.length) : pendentes.length
      console.log(`[dry-run] geraria ${n} imagem(ns) (~$${(n * 0.07).toFixed(2)} USD). Nada gerado.`)
      return
    }

    const store = getImageStore()
    const generator = getImageGenerator()
    let generated = 0
    let skipped = 0
    const failed: string[] = []

    for (const { id } of pendentes) {
      if (generated >= limit) break
      // Anti-corrida (dec.13): re-checa a face AGORA (a auto-gen da aprovação pode ter preenchido).
      const [fresh] = await db.select({ imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, id))
      if (!fresh || fresh.imageId != null) {
        skipped++
        continue
      }
      const res = await applyCatalogImageGeneration({ db, store, generator, id, curatorId })
      if (res.kind === 'ok') {
        generated++
        console.log(`  ✓ ${id} (${generated})`)
      } else {
        failed.push(`${id}: ${res.kind}`)
        console.warn(`  ✗ ${id}: ${res.kind}`)
      }
    }

    console.log(
      `OK — lote de imagens do catálogo: ${generated} gerada(s), ${skipped} pulada(s) (já tinham face), ` +
        `${failed.length} falha(s). Custo ~$${(generated * 0.07).toFixed(2)} USD (ledger image_generation).`,
    )
    if (failed.length > 0) failed.slice(0, 50).forEach((f) => console.error('  falha:', f))
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('Falha no lote de imagens do catálogo:', err instanceof Error ? err.message : err)
  process.exit(1)
})
