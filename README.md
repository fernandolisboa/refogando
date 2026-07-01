# Refogando

> *Refogar*: dourar alho e cebola na gordura quente — o gesto por onde quase toda comida brasileira começa. É daí que vem o nome.

App de receitas com **IA**, **bilíngue pt-BR / en-US desde a primeira linha**. Você **busca** o que já existe, **cria conversando** com a IA, ou **cria no capricho** por formulário — e um único núcleo de domínio cuida de tudo, idêntico em qualquer idioma.

## O que dá pra fazer

- **Criar receita com IA** em três modos: **conversa** (chat multi-turno, retomável), **estruturado** (formulário → geração sob medida) e **texto livre** (descreve o prato, sai a receita).
- **Descobrir e buscar**: a home é um feed indexável, e a **busca híbrida** (full-text por idioma + semântica com embeddings) acha por nome, ingrediente ou "perfil culinário" (cozinha, categoria, tags). Acervo raso pro pedido? A busca pode oferecer links da web.
- **Catálogo curado + comunidade**: receitas editoriais (curadas por gente) convivem com as públicas da comunidade — sem se misturarem num ranking cego.
- **Estúdio de imagem por IA**: gerar e editar a foto do prato, com galeria por receita e selo honesto de "gerada / editada por IA".
- **Social, na medida**: seguir cozinheiros, **salvar** em coleções, **avaliar** com nota 1–5★ + comentário (e a foto do prato que *você* cozinhou), e uma caixa de **notificações**.

## Stack

- **Next.js 16** (App Router) + **TypeScript**, **Tailwind** + **shadcn/ui**.
- **Postgres (Neon)** via **Drizzle ORM**; busca semântica com **pgvector**.
- **Better Auth** (e-mail/senha, Google opcional).
- **IA**: texto no **Claude (Anthropic)**, imagem no **Gemini (Google)**.
- **Vercel** pro deploy — as migrações rodam no próprio deploy.

## Rodando localmente

```bash
npm ci
cp .env.example .env.local     # preencha DATABASE_URL, BETTER_AUTH_SECRET e as chaves de IA
npm run dev                    # http://localhost:3000
```

Comandos que você vai usar:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest — dois projetos: "node" (Postgres real) e "ui" (jsdom)
npm run db:generate  # gera a migração Drizzle a partir do schema
```

As migrações são **geradas** no repo e **aplicadas no deploy** (o `vercel.json` roda `db:migrate` antes do build). **Nunca** migre o banco de produção da sua máquina.

## Como o projeto pensa (leia antes de mexer)

- **[`CONTEXT.md`](CONTEXT.md)** — a **linguagem ubíqua** do domínio (Receita, Proveniência, Visibilidade, Cozinha, Avaliação, Salvar…). É a fonte da verdade dos nomes; se um termo não está aqui, provavelmente não devia existir.
- **[`docs/adr/`](docs/adr/)** — as **decisões de arquitetura**, uma por assunto, com o porquê e as alternativas rejeitadas.
- **[`docs/handoffs/`](docs/handoffs/)** — handoffs auto-suficientes de cada fase de trabalho.
- **[`docs/agents/`](docs/agents/)** — as convenções pra agentes (issue tracker, triage, docs de domínio).

## Fluxo de trabalho

Desenvolvimento por **fases**, e cada issue passa por um pipeline de 8 passos: explorar → planejar → revisar o plano → corrigir → **implementar em TDD** → **code-review multi-lente** → corrigir → validar e mergear. Tudo por **branch + PR + squash-merge** — nunca direto na `main` (que é protegida). Os detalhes vivem no [`CLAUDE.md`](CLAUDE.md).

## Bom saber

- Um bom teste testa **comportamento**, não implementação. A suíte `node` sobe um Postgres real e descartável.
- **PRs só de documentação** (`docs/**` ou qualquer `.md`) pulam a CI e o deploy — handoff e ADR não mexem no build.
- Os selos de IA (receita gerada, imagem gerada/editada) são **honestos e obrigatórios** dentro do app: a gente não disfarça o que a máquina fez.

---

Feito com café e alho dourando na panela.
