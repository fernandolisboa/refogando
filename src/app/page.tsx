'use client'
/**
 * Home mínima (issue #4). Usa `useLocale()` para mostrar textos traduzidos — prova viva
 * de #4.AC1 (trocar o seletor no header alterna a chrome). Sem UI de login/listagem
 * (fora de escopo): só o shell que demonstra a chrome trocando de idioma.
 */
import { useLocale } from '@/i18n/provider'

export default function Home() {
  const { messages } = useLocale()
  return (
    <main>
      <h1>{messages.app.name}</h1>
      <p>{messages.app.tagline}</p>
    </main>
  )
}
