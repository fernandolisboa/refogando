# ADR-0008 — Busca híbrida (FTS + semântica) em Postgres, com pgvector desde o dia 0

Status: aceito

A busca é **híbrida e em um único datastore (Postgres/Neon)** desde o início:

- **Camada precisa (âncora):** full-text por idioma (`tsvector` com config `portuguese`/`english` + `unaccent`, índice GIN) para nome/descrição; busca por **ingrediente canônico**; filtros por facetas (cozinha/categoria/tag). *Atualização (2026-10-14, handoff 66): o full-text do título e o trigrama (#118) passaram a usar os GIN (um braço de tsquery por config; operador `%` com o piso fixado na transação), com resultado idêntico, exceto a correção do curinga (`%`/`_`/`\` literais); o texto cru do ingrediente segue sem índice até a migração do achado E. Atualização (2026-10-14, handoff 68, migração 0076): o texto cru do ingrediente ganhou um `tsvector` gerado por config em `recipe_ingredient` (`raw_text_tsv_portuguese`/`raw_text_tsv_english`, GIN), e a Busca casa cada termo no `tsvector` da config da Receita, com resultado idêntico.*
- **Camada semântica:** embeddings em **pgvector** (índice HNSW, distância cosseno) para intenção difusa ("algo reconfortante de inverno, sem lactose") que palavra-chave não pega.
- As duas **se combinam num ranking** — FTS/facetas ancoram a precisão, o vetor re-ranqueia/expande por significado. **Não** é busca puramente vetorial (que erraria match exato de nome).

Resultados seguem **seccionados** catálogo vs comunidade (ADR-0003). Embeddings são **por locale**: cada linha de tradução (ADR-0001) gera seu vetor, para relevância na língua da consulta; re-embedar quando a tradução muda (mesma lógica de `stale`).

## Por quê

"Busca completa desde o dia 0" foi decisão de produto explícita — buscar por vibe é central. pgvector mantém os vetores no mesmo Postgres (sem motor externo, sem dual-write), e o Neon habilita `vector` e `unaccent` nativamente (verificado nas docs do Neon: `CREATE EXTENSION vector;` / `CREATE EXTENSION unaccent;`, HNSW/IVFFlat). Híbrido (vs vetor puro) preserva o match exato de nome/ingrediente, onde embedding sozinho é fraco.

## Consequências

- Custo de geração de embeddings por receita **× locale**; cada criação/edição/tradução dispara (re)embedding.
- A escolha do modelo de embedding (multilíngue) e dimensões fica para a implementação; trocar o modelo = re-embedar (reversível).
- `pgvector` e `unaccent` são pré-requisitos de extensão no provisionamento do banco.
