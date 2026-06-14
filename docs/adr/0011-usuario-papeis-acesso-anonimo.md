# ADR-0011 — Usuário, papéis e acesso anônimo

Status: aceito

## Identidade e propriedade

Existe uma entidade **Usuário** com id estável. Dois conceitos distintos:

- **Owner** — quem controla a linha. `Recipe.owner_id` é **nullable**: NULL para `origin=catalog` (editorial/sistema), preenchido para `ai_*` e `user_edited`. `CreationSession.user_id` é NOT NULL.
- **Autoria** — quem é creditado na exibição/atribuição (pool da comunidade). Para receita de usuário, autor == owner; para catálogo, a atribuição é editorial e o owner é NULL.

A regra de edição (ADR-0005) ancora em `owner_id`: editar a **própria** receita = update; editar a de **outro** (ou do catálogo) = fork numa derivada sua.

## Papéis

- **Visitante (anônimo)** — sem conta.
- **Usuário** — conta padrão (salva, publica, vota, favorita).
- **Curador** — Usuário + pode **curar o catálogo** (promover/editar conteúdo editorial) e **revisar receitas reportadas/com aviso** da comunidade (manter ou remover). **Não** mexe em config de admin. Moderação é **reativa**, não um gate de publicação — coerente com o app leve (ADR-0004): publicar continua sendo self-publish (ADR-0003).
- **Admin** — config do sistema + tudo dos demais.

## Acesso anônimo

O Visitante pode **buscar**, **criar com IA** (geração efêmera) e **compartilhar**. Como a geração anônima **não é persistida** no servidor, compartilhar = **exportar/copiar o texto** da receita (texto ou imagem renderizada), não um link de servidor. **Salvar** (persistir) ou **publicar** exigem **conta**; votar/favoritar também.

## Por quê

Owner vs Autoria evita um campo `author` string que mistura humano, IA e curadoria. `owner_id` nullable distingue catálogo (sistema) de conteúdo de usuário sem entidades separadas. Brincar sem login reduz atrito; exigir conta só ao persistir é o ponto natural de captura. A identidade do Usuário é **domínio** e congela FK; o provider de auth é stack reversível (ADR-0010).
