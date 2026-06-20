# ADR-0016 — Imagem da receita como entidade própria (ref-counted), não coluna-URL

Status: aceito

A **Imagem da receita** (foto do usuário ou ilustração gerada por IA) é **language-neutral** — invariante, como quantidade/porções — então mora na **Receita**, nunca na Tradução (ver CONTEXT.md: _Imagem da receita_). Mas, em vez de uma coluna `image_url` solta na linha, ela é uma **entidade própria** (`recipe_image`) referenciada por FK opcional `recipe.image_id`, **muitas versões → uma imagem** (many-to-one), com **contagem de referência** no blob.

`recipe_image` carrega: `blob_url`, **proveniência da imagem** (`user_photo | ai_generated`) — eixo distinto da Proveniência da Receita —, metadados da geração de IA (prompt, modelo) quando aplicável, `created_by`/`created_at`, e flags de moderação (`moderated_at`/`_reason`/`_by`).

## Por quê

A Receita é **imutável + versionada por linhagem** (ADR-0005): regenerar/editar criam linhas novas. O usuário pediu **carry-forward** da imagem ao versionar, sem **duplicar o arquivo físico**. Uma coluna-URL não consegue isso de forma sã: copiar a string entre linhas deixa o sistema **cego** sobre quais versões apontam pro mesmo blob, então não dá pra deletar com segurança nem moderar de forma consistente. A entidade + FK + ref-count resolve os três de uma vez:

- **Carry-forward sem duplicar:** a versão nova herda o `image_id` (mesmo blob, zero arquivo novo).
- **Deleção segura:** o blob só é removido quando **nenhuma** linha de `recipe` referencia mais aquele `image_id`.
- **Moderação consistente:** a imagem é julgada por si — moderá-la a esconde **em toda parte** onde aparece (não dá pra driblar re-apontando).

A entidade ainda é o lar natural da **proveniência da imagem** (e do selo "gerada por IA", honestidade na linha do ADR-0002/0009) e dos metadados de geração.

## Considered options

- **Coluna `recipe.image_url` (rejeitada):** simples, mas impossibilita dedup no carry-forward, ref-count e moderação coerente da imagem compartilhada.
- **Imagem por linhagem/família (rejeitada):** semanticamente furada — uma imagem de IA gerada da v1 pode não bater com a v2 (ingredientes mudaram). A escolha é **por versão**, com carry-forward explícito.

## Consequências

- **Carry-forward híbrido:** ao editar/regenerar, a versão nova **herda** o `image_id`. Se a mudança for **visualmente relevante** (ingredientes, título ou cozinha mudaram), a UI pergunta se quer gerar/subir nova imagem; se for **cosmética** (porções, dificuldade, notas, descrição, restrições), segue calado. Detecção **determinística** (via `derivedDiff` na edição; comparação de conjunto de ingredientes + título no regenerar) — sem custo de IA.
- **Avatar do Usuário NÃO usa esta entidade:** avatar é 1:1 com a pessoa, sem compartilhamento/carry-forward, e vive em `users.image` (URL). Os dois reusam só o **primitivo de storage** (`storeImage`/`deleteImage`), não a tabela `recipe_image`.
- **Moderação:** o Curador ganha a ação **"remover só a imagem"** (seta `moderated_at`, não apaga o blob nem zera o `image_id`); o Owner continua vendo no privado. Eixo **ortogonal e rastreável** a remover-a-receita-do-pool (ADR-0003), espelhando `recipe.moderation_removed_at`. O gate de pool de imagem ganha `AND image.moderated_at IS NULL`.
- O blob de storage é Vercel Blob atrás de interface fina (ver adendo no ADR-0010); o contrato de geração de IA que **produz** imagens `ai_generated` está no ADR-0017.
