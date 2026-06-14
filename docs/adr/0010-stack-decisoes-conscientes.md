# ADR-0010 — Stack e decisões conscientes (reversíveis, registradas para contexto)

Status: aceito

Decisões de tecnologia que **não** são ADRs "duros" (são reversíveis ou convencionais), mas cuja razão é load-bearing e merece ficar escrita para não ser re-litigada:

- **Next.js (última estável, App Router)** — escolha convencional; usar sempre a major estável mais recente, sem pinar numa versão velha (a menção a "15" era só o estado da arte na época desta decisão). SSR + i18n + route handlers para o **streaming da IA token-a-token** (route handler, não Server Action, para o streaming de geração).
- **Drizzle ORM (sobre Prisma)** — escolhido pelo **controle SQL-first**: FTS por idioma (`tsvector` / `regconfig` / `unaccent`), `pgvector` e JSONB transparentes ficam diretos no Drizzle, enquanto o Prisma abstrai longe demais para este domínio. Baixo lock-in — o schema sobrevive a uma troca. A rejeição do Prisma é **não-óbvia**, por isso registrada.
- **Neon Postgres** — vendor serverless; um único datastore (Postgres) cobre relacional + FTS + `pgvector` (extensões confirmadas no Neon — ver ADR-0008). A connection string é o ponto de acoplamento; trocar de vendor é viável.
- **Versões: última estável** — para toda dependência, usar a versão estável mais recente no momento da implementação, fixada por lockfile; não pinar em majors defasadas salvo conflito real. Greenfield não tem motivo pra começar atrasado.

Estas são conscientes, não congelam o schema, e podem ser revistas sem o peso de um ADR próprio.
