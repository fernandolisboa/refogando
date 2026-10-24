import type { Sql } from 'postgres'
import { makeDb } from '@/db/client'
import { hashPassword } from 'better-auth/crypto'
import { account, users } from '@/db/schema'
import { createCatalogRecipe } from '@/server/curate/create'
import { SEED_ADMIN, SEED_COZINHEIRA, SEED_CURADORA, SEED_PENDENTE, SEED_RECIPE } from '../fixtures/seed-data'
import { E2E_DB_NAME_RE } from './constants'

/**
 * Seed do banco descartável do E2E (#589). Roda no harness, DEPOIS das migrações (que já semeiam o
 * vocabulário de cozinhas, como em produção) e ANTES do `next build`.
 *
 * Usuários entram direto na tabela, sem senha (as specs criam a própria conta), exceto o admin: ele ganha a
 * conta `credential` com o hash do próprio Better Auth, para a spec do Console entrar com o papel.
 * A Receita entra pelo caminho editorial real (`createCatalogRecipe`, aprovada e bilíngue), sem o fluxo
 * de aprovação: esse dispararia embedding/imagem, e este processo NÃO está no modo fake (provedores
 * reais). Sem embedding, a Busca acha a Receita pelo texto (FTS + trigram), como uma recém-aprovada.
 */
export async function seedE2e(sql: Sql, expectedDbName: string): Promise<void> {
  // Mesma trava do harness do Vitest: só semeia o banco descartável que acabamos de criar.
  const [{ current_database }] = await sql<{ current_database: string }[]>`select current_database()`
  if (current_database !== expectedDbName || !E2E_DB_NAME_RE.test(current_database)) {
    throw new Error(`[e2e/seed] banco inesperado: ${current_database}`)
  }

  const db = makeDb(sql)
  const [curadora] = await db
    .insert(users)
    .values({ ...SEED_CURADORA, role: 'curador', emailVerified: true, locale: 'pt-BR' })
    .returning({ id: users.id })
  await db.insert(users).values({ ...SEED_COZINHEIRA, emailVerified: true, locale: 'pt-BR' })
  const { password, ...adminFields } = SEED_ADMIN
  const [admin] = await db
    .insert(users)
    .values({ ...adminFields, role: 'admin', emailVerified: true, locale: 'pt-BR' })
    .returning({ id: users.id })
  await db.insert(account).values({
    userId: admin.id,
    accountId: admin.id,
    providerId: 'credential',
    password: await hashPassword(password),
  })

  await createCatalogRecipe(db, {
    originalLocale: 'pt-BR',
    translations: [
      {
        locale: 'pt-BR',
        titulo: SEED_RECIPE.titulo,
        descricao: SEED_RECIPE.descricao,
        passos: [...SEED_RECIPE.passos],
        notas: null,
        provenance: 'escrita_por_pessoa',
      },
      {
        locale: 'en-US',
        titulo: SEED_RECIPE.tituloEn,
        descricao: SEED_RECIPE.descricaoEn,
        passos: [...SEED_RECIPE.passosEn],
        notas: null,
        provenance: 'escrita_por_pessoa',
      },
    ],
    cozinha: SEED_RECIPE.cozinha,
    categoria: SEED_RECIPE.categoria,
    restricoes: [],
    porcoes: SEED_RECIPE.porcoes,
    dificuldade: SEED_RECIPE.dificuldade,
    tempoAtivoMin: 20,
    tempoTotalMin: 60,
    ingredientes: SEED_RECIPE.ingredientes.map((i) => ({ ...i })),
    curationStatus: 'approved',
    reviewedBy: curadora.id,
  })

  await createCatalogRecipe(db, {
    originalLocale: 'pt-BR',
    translations: [
      {
        locale: 'pt-BR',
        titulo: SEED_PENDENTE.titulo,
        descricao: 'Rascunho semeado para a fila de curadoria do E2E.',
        passos: ['Abra a massa.', 'Asse em forno bem quente.'],
        notas: null,
        provenance: 'escrita_por_pessoa',
      },
    ],
    cozinha: 'italiana',
    categoria: 'prato_principal',
    restricoes: [],
    porcoes: 2,
    dificuldade: 3,
    tempoAtivoMin: 30,
    tempoTotalMin: 120,
    ingredientes: [{ rawText: 'farinha de trigo', quantidade: '500', unidade: 'g' }],
    curationStatus: 'pending',
    reviewedBy: null,
  })
}
