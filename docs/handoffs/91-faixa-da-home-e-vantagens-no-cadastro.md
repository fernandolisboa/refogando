# Handoff 91 — Faixa da home para visitantes e vantagens no cadastro

**Data:** 2026-10-23.
**PR:** "Faixa de valor na home para visitantes e vantagens no cadastro (#472)".
**Base:** `main` depois do #629.
**Migração:** nenhuma. **ADR:** nenhum novo (ADR-0020 segue: a home é a landing; o repouso continua anônimo e
cacheável).

## 1. Escopo

- **Home, só para quem não entrou na conta:** uma faixa acima da "Receita da semana" com título, uma linha e um botão
  para `/{locale}/sign-up`. Três frases (`faixaHome.titulos/textos/botoes`, por índice); a home sorteia uma por
  requisição. Some na busca/filtro junto com o resto do `highlight`.
- **Cadastro:** três bullets (`auth.vantagens`) logo abaixo do `<h1>` do `AuthForm`, só no modo `sign-up` (não na tela
  "confira seu e-mail" nem no "Entrar").
- O texto foi escolhido pelo Fernando (issue #472, 2026-10-23): curto, de cozinha de casa, **sem "IA"**. A frase 3 da
  proposta ("Cozinhe qualquer ideia.") ficou de fora do sorteio por ser só o slogan.

## 2. O que ler primeiro

1. `src/components/recipe/home-value-banner.tsx`: `HomeValueBanner({ indice })`.
2. `src/domain/faixa-home.ts`: `sortearFaixa` (puro, `random` injetável).
3. `src/app/[locale]/(com-carregamento)/page.tsx`: o `highlight` agora é a faixa (com o índice sorteado ali) + a
   receita da semana.
4. `faixaHome` e `auth.vantagens` em `src/i18n/messages/pt-BR.ts` e `en-US.ts`.
5. `test/ui/home-value-banner.test.tsx`, o bloco "#472" em `test/ui/auth-form.test.tsx` e as linhas da faixa em
   `e2e/specs/visitante.spec.ts` e `conta-e-navegacao.spec.ts`.

## 3. Princípios inegociáveis

- **A faixa vem no HTML de todos e some para quem está logado.** A home de repouso não lê cookie nem sessão
  (ADR-0020), então o servidor não sabe quem entrou. Pintar só depois de confirmar o visitante empurrava a receita
  da semana e o feed ~140 px para baixo em todo carregamento (CLS no público da home indexável; achado do review).
  Por isso ela só devolve `null` com `session.data`; pendente (SSR, hidratação, refetch) e erro mostram. Custo
  aceito: quem está logado a vê por um instante ao recarregar a home; na navegação dentro do app, não.
- **Sorteio no servidor, por requisição.** A home é dinâmica (lê `searchParams`), então `sortearFaixa` roda a cada
  requisição e o índice desce por prop: SSR e hidratação pintam a mesma frase, que também não muda ao limpar a
  busca nem ao trocar o idioma em runtime (vira a mesma frase traduzida). Se a home virar ISR/estática, o sorteio
  congela por janela de cache: aí mova-o para o navegador sem reintroduzir o salto de layout.
- **Nada guardado no navegador.** Evitar repetir a frase anterior exigiria um item novo no armazenamento local, que a
  Política lista um a um (item 8). Se um dia quiser isso, atualize a Política no mesmo PR (ver `CLAUDE.md`).
- **Listas do mesmo tamanho.** Um teste exige `titulos`, `textos` e `botoes` com o mesmo tamanho nos dois idiomas.
  Para trocar ou adicionar frase, mexa nas três listas dos dois arquivos.

## 4. Landmines

- O `highlight` só aparece no repouso (`search-experience.tsx`, `status === 'idle' && data === null`). Não monte a
  faixa fora dele, senão ela aparece no meio dos resultados de busca.
- A faixa tem um `<h2>`, igual à receita da semana e ao feed. A home tem um único `<h1>` (sr-only).
- O sign-up agora tem um `<ul role="list">` acima do formulário. Teste que use `getByRole('list')` nessa página casa
  com ele.
- `sortearFaixa` mora em `src/domain/`, não no arquivo da faixa: função exportada de um módulo `'use client'` vira
  referência de cliente e não pode ser chamada pelo Server Component.

## 5. Critério de saída

`checks` e `e2e` verdes. Em produção, numa janela anônima, a home mostra uma das três frases desde o primeiro quadro,
sem empurrar o feed (recarregar troca de vez em quando), e o botão leva ao cadastro; logado, ela some. `/pt-BR/sign-up` e `/en-US/sign-up` mostram os bullets.

## 6. Gotchas de ambiente

- A suíte de UI (`npx vitest run test/ui`) roda sem banco. Os projetos com banco precisam de Docker ou de um Postgres 17
  com pgvector; nunca `export` a variável do banco no shell.

## Prompt de kickoff

Leia `docs/handoffs/91-faixa-da-home-e-vantagens-no-cadastro.md`. A home mostra uma faixa com uma de três frases, sorteada no servidor a cada requisição e vinda no HTML para não empurrar o feed, que some no navegador para quem está logado; o cadastro tem três bullets de vantagens. Confira em produção numa janela anônima e logado. Para trocar o texto, edite `faixaHome` e `auth.vantagens` nos dois idiomas e mantenha as listas do mesmo tamanho.
