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

## Atualização (2026-10-14, handoff 69, migração 0077): derivados WebP para servir

Achado I da auditoria de performance (`docs/perf/2026-10-13-auditoria.md` §7): o feed servia o PNG cheio do Gemini (~1,5 MB) num thumb de 128–144 px. Decidido com o dono em 2026-10-13 ("manter o original intocado"):

- **O original (`blob_url`) não muda e segue sendo a fonte de verdade.** A edição imagem-a-imagem do Gemini (ADR-0022) lê dele, e um futuro "baixar original" também. Nada que edita ou regenera lê um derivado.
- **Derivados só para exibir:** `recipe_image.detail_url` (WebP de ~1280 px de largura, capa do detalhe) e `thumb_url` (~400 px, cards e miniaturas), gerados com sharp e guardados no mesmo Blob (`recipes/w1280/`, `recipes/w400/`) em todo caminho que cria uma `recipe_image` (upload do dono, upload do catálogo, geração por IA). Os dois existem juntos ou nenhum (CHECK `recipe_image_derivatives_pair_chk`). Sem ampliar originais pequenos; orientação EXIF aplicada; só JPEG, PNG e WebP (pelos bytes, não pelo tipo declarado) e não animada ganham derivado.
- **Best-effort:** falhar nos derivados nunca falha o upload nem a geração; as colunas ficam NULL e a tela usa o original. As imagens anteriores à 0077 (e as que falharam) são preenchidas em lotes pelo cron `/api/cron/image-derivatives`, que só lê o original e só preenche colunas NULL; uma falha sai da fila por 7 dias, e imagem moderada não entra nela.
- **Exibição:** a `<img>` mantém `src` = original e ganha `srcset` com os derivados mais `sizes` do slot; o navegador escolhe. Slot que pode passar de 200 px CSS recebe só o `detail` (o thumb de 400 px seria ampliado em DPR 2 pelo critério de escolha do Chrome). Mesmo layout, recorte e `alt`. O `srcset` segue o mesmo gate de moderação da foto. OG/Twitter e o `image` do JSON-LD continuam no original; as telas do Curador também.
- **Ref-count/deleção:** os derivados são parte da linha. Quem apaga a `recipe_image` (APAGAR da galeria, reap do hard-delete) apaga os três blobs depois do commit.

## Atualização (2026-10-22, ADR-0050, #596): a foto enviada é re-encodada no servidor

A Imagem da receita enviada pelo dono ou pelo Curador e o avatar (`users.image`) passam pelo mesmo re-encode da foto da avaliação (`reencodeUserPhoto`, `src/server/images/user-photo.ts`) antes de chegar ao Blob público: formato decidido pelos bytes (só JPEG, PNG e WebP de um quadro), orientação EXIF aplicada nos pixels, maior lado limitado (2048 px na receita, 1024 px no avatar) e saída **WebP sem EXIF, ICC nem XMP** (a localização do celular não vaza). Entrada que não passa ⇒ 400 `tipo_invalido`.

Para upload, o "original" (`blob_url`) da seção anterior passa a ser esse WebP re-encodado (qualidade 90, porque a edição imagem-a-imagem do Gemini lê dele), não os bytes que o cliente mandou. A imagem gerada por IA não muda. Fotos enviadas antes desta mudança não foram limpas retroativamente (ADR-0050, riscos).

## Atualização (2026-10-23, #604): o avatar só é apagado se for da conta

`store.owns` confere só o host (é do nosso Vercel Blob?), não de quem é o arquivo. O Better Auth aceitava qualquer string em `image` em `/update-user` e `/sign-up/email`, então uma conta podia gravar a URL de um blob alheio (avatar, foto de avaliação ou de receita) e apagá-lo ao trocar ou remover o avatar, ou ao eliminar a conta. Também podia pôr um pixel de rastreamento no próprio perfil.

- **Entrada fechada:** um hook `before` em `src/lib/auth.ts` recusa `image` nesses dois caminhos com 400 `FIELD_NOT_ALLOWED`, o mesmo contrato de um campo `input:false`. O avatar só muda por `/api/me/avatar`; o Google preenche a foto pelo fluxo OAuth, que não passa por eles.
- **Segunda barreira, no ponto de apagar** (`canDeleteAccountAvatar`, `src/server/images/avatar-blob.ts`): o avatar novo é guardado sob `avatars/<userId>/`, e só um blob nosso nesse prefixo é apagado como avatar da conta. O avatar antigo (`avatars/<arquivo>`, de antes desta mudança) só é apagado se nenhuma outra conta aponta para a mesma URL. Qualquer outro caminho e URL estrangeira nunca são apagados por aí. Usam a regra a troca/remoção do avatar e a eliminação da conta.
- Um avatar que a regra se recusa a apagar vira órfão no Blob; a varredura de órfãos (#603) o recolhe.
