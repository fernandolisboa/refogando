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

O Visitante pode **buscar** e **ler** qualquer Receita pública/catálogo, e **compartilhar** o texto de uma Receita pública (exportar/copiar, não um link de servidor). **Criar com IA** (geração), **salvar**, **publicar**, **votar** e **favoritar** exigem **conta** — toda escrita e toda geração são *fail-closed* (`requireSession` → 401 ao anônimo).

> **Revisão (2026-06-18, decisão do owner — supera a versão original "geração efêmera client-only"):** a geração anônima foi **removida**. A geração chama o LLM (custo por chamada); permitir o anônimo expõe a quota da API a abuso (centenas de requisições) e a uso pessoal em massa sem captura. Logo, **gerar exige conta**. Sem geração anônima não há criação efêmera a persistir → **não existe** endpoint de *persist-on-signup*/claim, nem estado efêmero no servidor. A captura de conta acontece no momento em que o anônimo tenta uma ação logada (criar/salvar/publicar/votar/favoritar): a UI convida a entrar/criar conta. A garantia "anônimo não escreve nada" é a **ausência** de qualquer rota de escrita/geração aberta ao anônimo (verificável por teste de contrato: leitura pública 200, escrita/geração 401, zero linhas).

## Por quê

Owner vs Autoria evita um campo `author` string que mistura humano, IA e curadoria. `owner_id` nullable distingue catálogo (sistema) de conteúdo de usuário sem entidades separadas. A identidade do Usuário é **domínio** e congela FK; o provider de auth é stack reversível (ADR-0010). Ler sem login reduz atrito; **gerar/persistir exige conta** — protege a quota do LLM (custo) e é o ponto natural de captura.
