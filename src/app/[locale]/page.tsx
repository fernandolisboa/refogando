/**
 * Home (issue #56). A Busca É a home: o app é descoberta-first (encontrar receitas que
 * já existem é o primeiro ato). `page.tsx` é um server component fino que monta o
 * `<SearchExperience />` (que é `'use client'` e provê o ÚNICO `<main>` do documento via
 * `<Container as="main">`). O hero editorial da #54 foi substituído por esta tela real.
 */
import { SearchExperience } from '@/components/recipe/search-experience'

export default function Home() {
  return <SearchExperience />
}
