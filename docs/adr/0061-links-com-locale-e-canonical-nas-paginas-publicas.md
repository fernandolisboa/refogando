# ADR-0061 — Indexação: links internos com locale e canonical em toda página pública indexável

Status: aceito (2026-11-13)

Relaciona: ADR-0020 (locale no caminho, proxy com 302 de detecção, 308 do UUID legado), #611 (canonical das
páginas legais), ADR-0024 (Modelo B: `/cooks` e o social fora do SEO), ADR-0056 (tradução sob demanda).

## Contexto

O Search Console avisou (novembro de 2026) quatro motivos novos de não indexação: "Excluída pela tag noindex",
"Página com redirecionamento", "Cópia sem página canônica selecionada pelo usuário" e "Cópia, o Google escolheu
uma canônica diferente da do usuário". Sem acesso ao relatório, conferimos o HTML público em 2026-11-13:

- **Links sem locale.** Cerca de 60 links internos saíam nus (`/`, `/cooks`, `/u/<handle>`, `/sign-in`, abas do
  header). Cada um passava pelo 302 do proxy, que escolhe o idioma pelo cookie e pelo Accept-Language, e não pela
  página de onde o link saiu. O Googlebot (sem cookie) que lia `/en-US` caía em `/pt-BR/...`, e uma pessoa em
  `/en-US` com navegador em português também.
- **Sem canonical.** `/u/<handle>`, `/guia`, `/plano`, `/sign-in` e `/sign-up` não declaravam canonical nem
  hreflang. As versões pt e en (mesmo conteúdo, só a chrome muda) e as variantes com query (`?returnTo=`) ficavam
  como cópias sem canônica.

## Decisão

1. **`Link` do app prefixa o locale.** `src/components/locale-link.tsx` embrulha o `next/link` e passa o `href`
   por `localizeHref` (`src/i18n/locale-path.ts`) com o locale do `LocaleProvider`. Fica intacto o que já tem
   locale, o externo, âncora/relativo, `/api`, `/_next` e arquivo com extensão (o mesmo `matcher` do proxy).
   O ESLint barra `import Link from 'next/link'` fora do wrapper e do `RecipeLink` (que já recebe o caminho
   prefixado; mesmo assim ele passa o href por `localizeHref`). Também passaram a prefixar: os três `router.push`
   com caminho nu, o destino do login (`router.push` e o `callbackURL` do `AuthForm`), o redirect legado
   `/conversation` e o `<a>` cru do perfil no Console.
   Rejeitado: corrigir cada `href` à mão. O próximo link nasceria nu de novo.
2. **Toda página pública indexável declara canonical + hreflang**, com a origem fixa de #611 (`CANONICAL_ORIGIN`
   em `src/domain/page-seo.ts`, generalizado de `legal-pages-seo.ts`): cada idioma é canônico de si mesmo e
   aponta o outro pelo hreflang. Entraram `/guia`, `/plano`, `/sign-in`, `/sign-up` (via `publicPageMetadata`,
   agora com `path` obrigatório) e `/u/<handle>` (handle normalizado em minúsculas, como o loader busca).
3. **Continuam como estão, de propósito** (o motivo aparece no Search Console e está certo):
   - *noindex:* `/cooks` e `/following` (Modelo B, ADR-0024); telas logadas e de fluxo de conta (`me/*`, `create`,
     `admin/*`, `forgot-password`, `reset-password`, `verify-email`); a home com busca ou filtro (`?q=`, facetas:
     resultado de busca, ADR-0020); a receita sem tradução publicada no idioma da URL
     (`/en-US/recipes/<uuid>`, tradução sob demanda, ADR-0056) e a privada; 404 (`noindex` do Next).
   - *redirecionamento:* `refogando.com` → `www` e `http` → `https` (Vercel); `/` → `/{locale}` (302 de detecção,
     ADR-0020); UUID legado → slug (308, ADR-0020 dec. 4); `/pt-br/...` → `/pt-BR/...` (301); `/{locale}/recipes`
     → home. Os links internos deixam de gerar entradas novas, mas URLs antigas já descobertas continuam listadas
     até o Google desistir delas.
4. **"O Google escolheu outra canônica"** não tem causa confirmada sem as URLs do relatório. Candidatos: a home
   e as receitas em `/en-US` cujo conteúdo é quase todo o original em português. Fica para quando o Fernando
   exportar o relatório.

## Consequências

- Link novo usa o `Link` de `@/components/locale-link` (o lint reprova o outro). Teste de componente que confere
  `href` dentro do `LocaleProvider` espera o caminho prefixado (`/pt-BR/...`).
- Página pública nova e indexável passa `alternates: localizedPageAlternates(locale, '<path>')`.
- Se o domínio público mudar, trocar `CANONICAL_ORIGIN` junto com a env do sitemap (nota em `base-url.ts`).
