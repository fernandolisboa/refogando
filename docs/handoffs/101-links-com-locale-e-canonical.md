# Handoff 101 — Indexação: links com locale e canonical nas páginas públicas

**Data:** 2026-11-13.
**Base:** main depois do #662 (JSON-LD Recipe, handoff 100).
**Migração:** nenhuma.
**ADR:** ADR-0061 (novo).
**Política:** sem mudança (nenhum dado pessoal novo).

## 1. Escopo

Segundo PR da thread "Corrigir indexação e dados estruturados no Google" (e-mail "New reasons preventing your pages
from being indexed").

- `src/components/locale-link.tsx` (novo) + `localizeHref` em `src/i18n/locale-path.ts` + `useOptionalLocale` no
  provider; 55 arquivos trocaram o import do `next/link`; regra do ESLint em `eslint.config.mjs`.
- `src/domain/page-seo.ts` (novo, `CANONICAL_ORIGIN` + `localizedPageAlternates`); `legal-pages-seo.ts` delega.
- Canonical + hreflang em `/guia`, `/plano`, `/sign-in`, `/sign-up`, `/u/<handle>`.
- Testes de UI que conferiam `href` nu passaram a esperar `/pt-BR/...`; um e2e idem.

## 2. O que ler primeiro

1. ADR-0061 (a dec. 3 diz quais motivos do Search Console são intencionais).
2. `localizeHref` e `test/ui/locale-path.test.ts`.

## 3. Depois do merge

- Conferir no ar: na `/en-US` os links de perfil e de `/cooks` saem como `/en-US/...`; `/pt-BR/u/<handle>`,
  `/pt-BR/guia`, `/pt-BR/sign-in?returnTo=x` têm `<link rel="canonical">` sem query.
- Search Console: "Validar correção" em "Cópia sem página canônica" e "Página com redirecionamento". Os demais
  motivos são intencionais (ADR-0061 dec. 3).
- Pendente: "O Google escolheu outra canônica" precisa das URLs do relatório (export do Fernando).

## 4. Princípios inegociáveis

- Link interno sem locale não volta: usar o `Link` do app.
- Canonical aponta para o mesmo idioma da página; nunca canonical cruzando idioma.

## 5. Landmines

- `RecipeLink` continua no `next/link` direto (usa `useLinkStatus`, com `eslint-disable` na linha); o `href` passa
  por `localizeHref` como no wrapper.
- `returnTo` dentro da query continua nu de propósito (é um caminho para depois do login, e o proxy resolve).
- `redirect('/sign-in')` nos gates do admin continua nu (o `SectionGate` não recebe o locale): o admin é `Disallow`
  no robots e só vê quem está logado. `<a>` cru não passa pelo lint: use `localizeHref`.
