# Handoff 91 — Faixa da home para visitantes e vantagens no cadastro

**Data:** 2026-10-23.
**PR:** "Faixa de valor na home para visitantes e vantagens no cadastro (#472)".
**Base:** `main` depois do #629.
**Migração:** nenhuma. **ADR:** nenhum novo (ADR-0020 segue: a home é a landing; o repouso continua anônimo e
cacheável).

## 1. Escopo

- **Home, só para quem não entrou na conta:** uma faixa acima da "Receita da semana" com título, uma linha e um botão
  para `/{locale}/sign-up`. Três frases (`faixaHome.titulos/textos/botoes`, por índice); uma é sorteada a cada
  carregamento. Some na busca/filtro junto com o resto do `highlight`.
- **Cadastro:** três bullets (`auth.vantagens`) logo abaixo do `<h1>` do `AuthForm`, só no modo `sign-up` (não na tela
  "confira seu e-mail" nem no "Entrar").
- O texto foi escolhido pelo Fernando (issue #472, 2026-10-23): curto, de cozinha de casa, **sem "IA"**. A frase 3 da
  proposta ("Cozinhe qualquer ideia.") ficou de fora do sorteio por ser só o slogan.

## 2. O que ler primeiro

1. `src/components/recipe/home-value-banner.tsx`: `HomeValueBanner` e `sortearFaixa`.
2. `src/app/[locale]/(com-carregamento)/page.tsx`: o `highlight` agora é `<HomeValueBanner />` + a receita da semana.
3. `faixaHome` e `auth.vantagens` em `src/i18n/messages/pt-BR.ts` e `en-US.ts`.
4. `test/ui/home-value-banner.test.tsx` e o bloco "#472" em `test/ui/auth-form.test.tsx`.

## 3. Princípios inegociáveis

- **A faixa decide no navegador.** A home de repouso não lê cookie nem sessão (ADR-0020), então o servidor nunca a
  pinta: com a sessão pendente (SSR e hidratação, ver `useSession` em `src/lib/auth-client.ts`) ela devolve `null`.
  Quem está logado nunca a vê piscar, e o HTML do crawler é o mesmo de antes.
- **Sorteio no inicializador do `useState`.** Roda uma vez por montagem; a frase não muda quando a sessão termina de
  carregar nem quando o idioma troca em runtime (vira a mesma frase traduzida).
- **Nada guardado no navegador.** Evitar repetir a frase anterior exigiria um item novo no armazenamento local, que a
  Política lista um a um (item 8). Se um dia quiser isso, atualize a Política no mesmo PR (ver `CLAUDE.md`).
- **Listas do mesmo tamanho.** Um teste exige `titulos`, `textos` e `botoes` com o mesmo tamanho nos dois idiomas.
  Para trocar ou adicionar frase, mexa nas três listas dos dois arquivos.

## 4. Landmines

- O `highlight` só aparece no repouso (`search-experience.tsx`, `status === 'idle' && data === null`). Não monte a
  faixa fora dele, senão ela aparece no meio dos resultados de busca.
- A faixa tem um `<h2>`, igual à receita da semana e ao feed. A home tem um único `<h1>` (sr-only).
- O sign-up agora tem um `<ul>` acima do formulário. Teste que use `getByRole('list')` nessa página casa com ele.

## 5. Critério de saída

`checks` e `e2e` verdes. Em produção, numa janela anônima, a home mostra uma das três frases (recarregar troca de vez
em quando) e o botão leva ao cadastro; logado, nada aparece. `/pt-BR/sign-up` e `/en-US/sign-up` mostram os bullets.

## 6. Gotchas de ambiente

- A suíte de UI (`npx vitest run test/ui`) roda sem banco. Os projetos com banco precisam de Docker ou de um Postgres 17
  com pgvector; nunca `export` a variável do banco no shell.

## Prompt de kickoff

Leia `docs/handoffs/91-faixa-da-home-e-vantagens-no-cadastro.md`. A home mostra a quem não entrou na conta uma faixa com uma de três frases sorteada a cada carregamento, decidida só no navegador para não mexer no cache da home, e o cadastro tem três bullets de vantagens. Confira em produção numa janela anônima e logado. Para trocar o texto, edite `faixaHome` e `auth.vantagens` nos dois idiomas e mantenha as listas do mesmo tamanho.
