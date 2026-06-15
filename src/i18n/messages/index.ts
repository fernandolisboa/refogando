import type { Locale } from '@/i18n/locale'
import { ptBR, type Messages } from './pt-BR'
import { enUS } from './en-US'

export type { Messages }

/** Catálogos por locale. Record<Locale, Messages> garante cobertura total dos locales. */
export const MESSAGES: Record<Locale, Messages> = {
  'pt-BR': ptBR,
  'en-US': enUS,
}
