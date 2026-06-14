# ADR-0001 — i18n no modelo de dados: identidade única language-neutral + tradução por locale

Status: aceito

A **Receita tem identidade única e language-neutral** — uma chave primária simples, sem locale: é o mesmo prato em qualquer idioma. O **conteúdo traduzível** (título, descrição, textos de passo, notas) vive numa **tabela de tradução chaveada por `(receita, locale)`**, uma linha por locale. A política é **uniforme entre proveniências**: catálogo e geração por IA seguem a mesma regra — a proveniência afeta a confiança/qualidade da tradução, nunca a identidade do prato. Um prato original (ex.: chili do Texas) é o mesmo prato quando buscado em pt-BR, apenas traduzido — nunca trocado por um prato diferente.

## Por quê

"Bilíngue desde o início" impede adiar a decisão: a forma da identidade congela a PK/FK de todo o schema e o pipeline de busca, e não há como trocá-la depois de existirem dados.

## Opções consideradas

- **Identidade única + tabela de tradução (escolhida).** Um prato, N traduções. Permite full-text search por idioma (config de stemming/stopwords `portuguese` vs `english` + `unaccent`), uma linha por locale.
- **Conteúdo por locale em JSONB ou colunas `title_pt`/`title_en` (rejeitada).** Sabota o FTS por idioma (cada língua precisa de `regconfig` distinto) e o `unaccent` do pt-BR.
- **Entidades separadas por locale / PK composta com locale (rejeitada).** Faria "a receita em pt" e "a receita em en" virarem coisas diferentes. É o mesmo prato; bifurcar duplicaria busca, favoritos e i18n.

## Consequências

- Busca cross-locale funciona via **ingrediente canônico language-neutral** + fallback de locale.
- Cada tradução carrega **proveniência/confiança** e um estado de **"desatualizada"** quando o original muda. A política de nome (original primário + tradução em escada) e a de corpo são domínio — ver `CONTEXT.md`.
