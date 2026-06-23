import { describe, expect, it } from 'vitest'
import type { Database } from '@/db/client'
import {
  slugForNewTranslation,
  slugsForNewTranslations,
} from '@/server/recipe/slug'

/**
 * Borda de WRITE-PATH do Slug por idioma (#229, ADR-0020 dec.4) — a materialização do slug NA
 * CRIAÇÃO da tradução, exercitada SEM Postgres. As 5 vias de insert (curate/derive/persist-
 * generation/persist-import/ensure) chamam estas funções para congelar o slug no instante da
 * escrita, em vez de gravar NULL e esperar o backfill.
 *
 * A leitura do `taken` (os slugs já em uso no locale) é a única dependência de I/O; aqui um
 * `db` fake devolve linhas canônicas, então a lógica de borda (ler taken → desambiguar por
 * locale → preservar regra de congelamento) roda no projeto "ui" (jsdom, sem DB). A unicidade
 * REAL e o efeito de banco são cobertos na integração (CI).
 */

/**
 * Fake mínimo do `db`: só implementa o encadeamento `.select(...).from(...).where(...)` que
 * `takenSlugsForLocale` usa, devolvendo as linhas `{slug}` canônicas. Como o filtro real é
 * `locale = X AND slug IS NOT NULL`, parametrizamos por locale via um mapa locale→slugs.
 */
function fakeDb(takenByLocale: Record<string, string[]>): Pick<Database, 'select'> {
  // A query é sempre a mesma forma; capturamos o locale do `.where()` não é trivial sem
  // inspecionar o SQL — então o fake serve UMA tabela de slugs por chamada de teste e o caller
  // garante que só um locale é consultado por asserção (ou usa a variante multi-locale abaixo).
  let pendingLocale: string | null = null
  const chain = {
    from() {
      return chain
    },
    where() {
      // O helper não nos dá o locale via API; resolvemos pelo locale "armado" antes da chamada.
      const slugs = pendingLocale != null ? (takenByLocale[pendingLocale] ?? []) : []
      pendingLocale = null
      return Promise.resolve(slugs.map((slug) => ({ slug })))
    },
  }
  // `arm` injeta o locale a ser resolvido na próxima query — o helper chama `.select` uma vez
  // por locale, na ordem das entradas, então armamos antes via o proxy de `select`.
  const armQueue: string[] = []
  const db = {
    __arm(locale: string) {
      armQueue.push(locale)
    },
    select() {
      pendingLocale = armQueue.shift() ?? null
      return chain
    },
  }
  return db as unknown as Pick<Database, 'select'> & { __arm(locale: string): void }
}

describe('slugForNewTranslation — congela o slug de UMA tradução nascente (borda)', () => {
  it('título livre no locale ⇒ slug derivado direto (taken vazio)', async () => {
    const db = fakeDb({ 'pt-BR': [] }) as Pick<Database, 'select'> & { __arm(l: string): void }
    db.__arm('pt-BR')
    const slug = await slugForNewTranslation(db, { locale: 'pt-BR', title: 'Bolo de Cenoura' })
    expect(slug).toBe('bolo-de-cenoura')
  })

  it('colide com um slug já em uso no locale ⇒ desambigua com sufixo', async () => {
    const db = fakeDb({ 'pt-BR': ['bolo'] }) as Pick<Database, 'select'> & { __arm(l: string): void }
    db.__arm('pt-BR')
    const slug = await slugForNewTranslation(db, { locale: 'pt-BR', title: 'Bolo' })
    expect(slug).toBe('bolo-1')
  })

  it('o escopo do taken é POR locale: o mesmo slug em en-US não força sufixo em pt-BR', async () => {
    const db = fakeDb({ 'pt-BR': [], 'en-US': ['cake'] }) as Pick<Database, 'select'> & {
      __arm(l: string): void
    }
    db.__arm('pt-BR')
    const slug = await slugForNewTranslation(db, { locale: 'pt-BR', title: 'Cake' })
    expect(slug).toBe('cake') // pt-BR está livre; o 'cake' tomado é de en-US
  })
})

describe('slugsForNewTranslations — lote de traduções nascentes de UMA receita (derive)', () => {
  it('cada locale ganha o seu, sem colidir cross-locale; ordem preservada', async () => {
    const db = fakeDb({ 'pt-BR': [], 'en-US': [] }) as Pick<Database, 'select'> & {
      __arm(l: string): void
    }
    // O helper consulta UMA vez por locale DISTINTO, na ordem de 1ª aparição.
    db.__arm('pt-BR')
    db.__arm('en-US')
    const slugs = await slugsForNewTranslations(db, [
      { locale: 'pt-BR', title: 'Bolo de Cenoura' },
      { locale: 'en-US', title: 'Carrot Cake' },
    ])
    expect(slugs).toEqual(['bolo-de-cenoura', 'carrot-cake'])
  })

  it('duas nascentes no MESMO locale com o mesmo título ⇒ desambiguam entre si (sem 2ª query)', async () => {
    const db = fakeDb({ 'pt-BR': ['pao-de-queijo'] }) as Pick<Database, 'select'> & {
      __arm(l: string): void
    }
    db.__arm('pt-BR') // UMA query só; o 2º item reusa o taken acumulado em memória
    const slugs = await slugsForNewTranslations(db, [
      { locale: 'pt-BR', title: 'Pão de queijo' },
      { locale: 'pt-BR', title: 'Pão de queijo' },
    ])
    // base 'pao-de-queijo' já tomada ⇒ -1; a irmã nascente evita o -1 ⇒ -2.
    expect(slugs).toEqual(['pao-de-queijo-1', 'pao-de-queijo-2'])
  })
})
