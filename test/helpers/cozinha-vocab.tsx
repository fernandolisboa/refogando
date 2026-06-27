import type { ReactNode } from 'react'
import { localizeCozinhaVocab, type CozinhaOption } from '@/domain/cozinha-label'
import { COZINHA_SEED } from '@/domain/vocabulary-term'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { useLocale } from '@/i18n/provider'
import type { Locale } from '@/i18n/locale'

/**
 * Fixture do vocabulário de cozinha para testes de UI (#317). Em produção o layout semeia o
 * `CozinhaVocabProvider` a partir de `loadVocabulary` (DB) — no jsdom (sem DB) os testes usam
 * estas opções, derivadas da MESMA fonte única (`COZINHA_SEED`, #314) e localizadas pelo
 * próprio `localizeCozinhaVocab`. Assim os rótulos batem com o que a UI renderiza em produção
 * sem reembutir um mapa estático (que reviveria o drift que o #317 acabou de matar).
 */
export function cozinhaVocabFixture(locale: Locale = 'pt-BR'): CozinhaOption[] {
  return localizeCozinhaVocab(COZINHA_SEED, locale)
}

/** Atalho pt-BR (o locale-padrão dos render helpers). */
export const COZINHA_VOCAB_PT_BR: CozinhaOption[] = cozinhaVocabFixture('pt-BR')

/**
 * Embrulha os filhos no `CozinhaVocabProvider` semeado com a fixture do locale CORRENTE (lido
 * de `useLocale`). Deve viver DENTRO do `LocaleProvider`. Conveniência p/ os render helpers que
 * montam forms/previews de cozinha: uma linha de wrap em vez de threadar a fixture à mão (e
 * acompanha a troca de locale em runtime, casando as asserções com o idioma corrente).
 */
export function WithCozinhaVocab({ children }: { children: ReactNode }) {
  const { locale } = useLocale()
  return <CozinhaVocabProvider value={cozinhaVocabFixture(locale)}>{children}</CozinhaVocabProvider>
}
