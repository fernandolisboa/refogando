/**
 * Dados do seed do E2E (#589) — fonte ÚNICA para o harness (`e2e/harness/seed.ts`, que grava) e para as
 * specs (que procuram). Módulo folha, sem dependências.
 */

/** Curadora que assina a Receita de catálogo aprovada (o CHECK exige reviewed_at/by juntos). */
export const SEED_CURADORA = {
  name: 'Curadora da Fumaça',
  handle: 'curadora-fumaca',
  email: 'curadora@refogando.test',
} as const

/** Cozinheira comum, com handle fixo — base para specs de perfil/Cozinheiros. */
export const SEED_COZINHEIRA = {
  name: 'Cozinheira da Fumaça',
  handle: 'cozinheira-fumaca',
  email: 'cozinheira@refogando.test',
} as const

/**
 * Receita de catálogo APROVADA (pública). `rawText` é só o nome (a medida vai em quantidade/unidade,
 * ADR-0012 Adendo) e simples de propósito: a Despensa casa por palavra do texto ("ovo" cobre "ovos",
 * "cenoura" cobre "cenouras") e o `ingredientId` nasce null no catálogo. Com a Despensa {ovo, cenoura}
 * faltam 2 ⇒ a Receita cai em "Falta pouco" com "farinha de trigo, açúcar".
 */
export const SEED_RECIPE = {
  titulo: 'Bolo de cenoura da fumaça',
  tituloEn: 'Smoke test carrot cake',
  descricao: 'Bolo fofinho de cenoura, semeado para o E2E.',
  descricaoEn: 'Fluffy carrot cake, seeded for the E2E.',
  passos: ['Bata as cenouras com os ovos.', 'Junte a farinha e o açúcar.', 'Asse por 40 minutos.'],
  passosEn: ['Blend the carrots with the eggs.', 'Fold in the flour and sugar.', 'Bake for 40 minutes.'],
  cozinha: 'brasileira',
  categoria: 'sobremesa',
  porcoes: 8,
  dificuldade: 2,
  ingredientes: [
    { rawText: 'cenouras', quantidade: '3', unidade: 'unidade' },
    { rawText: 'ovos', quantidade: '3', unidade: 'unidade' },
    { rawText: 'farinha de trigo', quantidade: '2', unidade: 'xicara' },
    { rawText: 'açúcar', quantidade: '1', unidade: 'xicara' },
  ],
} as const

/** O que a Despensa recebe e o que sobra faltando na Receita do seed. */
export const PANTRY_HAVE = ['ovo', 'cenoura'] as const
export const PANTRY_MISSING = ['farinha de trigo', 'açúcar'] as const
