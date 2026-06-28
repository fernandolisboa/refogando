'use client'
/**
 * Pílula de busca da home (#5 — protótipo "feed editorial"): lupa + input + × pra limpar. Vive DENTRO do
 * `SiteHeader` (renderizada SÓ na home): INLINE entre a nav e o cluster em telas largas (≥1280px), ou
 * quebrada pra a 2ª linha do header abaixo disso. O termo vive no `HomeSearchProvider` (elevado), então
 * este componente é só a vista — `SearchExperience` consome o mesmo `q` e faz o fetch. A posição/largura
 * responsiva é do slot no `SiteHeader`; aqui é só o pill em si (`w-full` dentro do slot).
 *
 * Paridade com o mock: borda NEUTRA em repouso, TERRACOTA quando há termo (`q.trim() !== ''`, a mesma
 * condição que mostra o ×), mais `focus-within` como afago extra. Enter dispara `submit()` (bypassa o
 * debounce, como o `onSubmit` de antes). a11y: `role=search`, `<label htmlFor>` sr-only PRÓPRIO
 * (`buscarLabel`, desacoplado do `<h1>`/título de SEO), e o × com texto sr-only (`limparBusca`).
 */
import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { useHomeSearch } from './home-search-context'

export function HomeSearchBar() {
  const { messages } = useLocale()
  const m = messages.busca
  const { q, setQ, submit } = useHomeSearch()
  const hasTerm = q.trim() !== ''
  // #5: ref pro input pra DEVOLVER o foco a ele quando o × limpa o termo — senão o botão × se
  // desmonta (hasTerm vira false) e o foco cai pro <body> (WCAG 2.4.3; é o UX nativo do search).
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <form
      role="search"
      className={cn(
        'flex items-center gap-2.5 rounded-full border bg-surface px-4 py-2.5 transition-colors focus-within:border-brand',
        hasTerm ? 'border-brand/55' : 'border-border',
      )}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {/* #5: lupa em páprica quando há termo (estados busca/vazio do mock), muted em repouso. */}
      <Search
        className={cn('size-[18px] shrink-0', hasTerm ? 'text-brand-ink' : 'text-muted')}
        strokeWidth={1.75}
        aria-hidden
      />
      <label htmlFor="search-q" className="sr-only">
        {m.buscarLabel}
      </label>
      <input
        ref={inputRef}
        id="search-q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={m.placeholder}
        className="w-full border-none bg-transparent text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
      />
      {hasTerm && (
        <button
          type="button"
          onClick={() => {
            setQ('')
            inputRef.current?.focus()
          }}
          className="-mr-1 shrink-0 rounded-full p-1 text-muted transition-colors hover:text-fg"
        >
          <span className="sr-only">{m.limparBusca}</span>
          <X className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </form>
  )
}
