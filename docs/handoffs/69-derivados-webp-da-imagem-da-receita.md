# Handoff 69 — Derivados WebP da Imagem da receita (migração 0077)

**Sessão:** 2026-10-14. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `c0bbf81`, depois do #574). **Migração:** `0077_perf_image_derivatives`. Continuação da auditoria do handoff 64: "migração 2" da ordem aprovada em `docs/perf/2026-10-13-respostas.md`, achado I. Aprovado pelo dono em 2026-10-13: "manter o original intocado". Única mudança visível: quais bytes de imagem o navegador baixa. Layout, recorte, `alt`, regras e respostas da API seguem iguais (a API ganha um campo opcional, `imageSrcSet`, ao lado do `imageUrl`).

## 1. O que foi entregue

- **Migração 0077** (gerada com `drizzle-kit generate` a partir de `src/db/schema.ts`, ajustada à mão como a 0075/0076):
  - `SET LOCAL lock_timeout = '5s'`.
  - Num ALTER TABLE só, em `recipe_image`: `thumb_url text`, `detail_url text`, `derivatives_attempted_at timestamptz` (todos NULL, sem default: só catálogo, sem reescrita) e o CHECK `recipe_image_derivatives_pair_chk` (`(thumb_url IS NULL) = (detail_url IS NULL)`), que varre a tabela uma vez para validar.
  - Sem backfill na migração: as linhas existentes ficam NULL e a tela usa o original até o cron preenchê-las.
- **Geração dos derivados** (`src/server/images/image-derivatives.ts`): sharp, `rotate()` (orientação EXIF), `resize({ width, withoutEnlargement })`, WebP q80; `detail` ~1280 px e `thumb` ~400 px de largura, guardados no mesmo Blob em `recipes/w1280/` e `recipes/w400/`.
  - **Formato primeiro:** o `metadata()` (só o cabeçalho, sem renderizar) decide; só JPEG, PNG e WebP ganham derivado. O route do upload confere só o `file.type` declarado, e o sharp decodifica pelos bytes: um SVG de 1,3 KB rotulado `image/png`, com `feTurbulence`/`feGaussianBlur`, custava ~30 s de CPU. Agora SVG, GIF, TIFF, HEIF etc. ficam sem derivado (log com o motivo, tela no original); o upload continua aceito como antes (rejeitar mudaria comportamento).
  - Imagem animada não ganha derivado. Teto de 24 MP na entrada (`IMAGE_INPUT_PIXEL_LIMIT`, o mesmo da foto da avaliação) e `.timeout({ seconds: 10 })` em cada pipeline.
  - Os dois renders rodam um depois do outro (antes: dois `clone()` em paralelo, duas decodificações cheias ao mesmo tempo, ~87 MB acima da base num PNG de 24 MP). As dimensões de saída são as mesmas.
  - Nunca lança: erro ⇒ uma linha `[imagens] derivados não gerados (sharp|storage): <nome do erro ou motivo>` (ex.: `formato svg`, `animada`) e `null`. Se só um dos dois `put` der certo, o que subiu é apagado (o par nunca fica pela metade).
- **Os três caminhos que criam `recipe_image`** (procurei todo `insert(recipeImage)`/`createGalleryImage`; não há outro, nem em `scripts/`):
  1. upload do dono, `applyRecipeImageUpload` (`src/server/recipe/image.ts`);
  2. upload do Curador no catálogo, `applyCatalogImageUpload` (`src/server/curate/catalog-image.ts`);
  3. geração por IA, `generateAndStoreGalleryImage` (dono, catálogo, auto-gen da aprovação e `scripts/images-catalog.ts` passam por ele).
  Em cada um, o sharp roda em paralelo com o `put` do original; os derivados sobem só depois que o original foi guardado (original falhou ⇒ nada órfão) e entram na mesma linha, na mesma transação. Falha nos derivados não muda a resposta: colunas NULL. Se a transação falhar, os três blobs são apagados.
- **O original não muda.** `blob_url` segue sendo o PNG do Gemini ou a foto enviada, byte a byte. A edição imagem-a-imagem lê `recipe_image.blob_url` (testado: o gerador recebe o PNG, não o WebP). `GalleryImage.url` segue sendo o original; o derivado entra só como `srcSet`.
- **Deleção:** os quatro pontos que apagam uma `recipe_image` agora apagam os três blobs depois do commit: APAGAR da galeria do dono e do catálogo (DELETE … RETURNING das três colunas), e o `reapOrphanImage` do hard-delete da Receita (`owner-edit.ts`) e do `operator-clear-attribution.ts`. `reapOrphanImage` passou a devolver `string[]`. Helpers num módulo só, `src/server/images/image-blobs.ts`: `IMAGE_BLOB_COLS`, `imageRowBlobUrls`, `deleteOrphanBlob` e `deleteOrphanBlobs` (o único "apaga se for nosso e engole o erro"; o avatar e a foto da avaliação também passam por ele).
- **Exibição** (`src/domain/image-variants.ts`, puro e seguro no client): `buildImageSrcSet({ original, thumbUrl, detailUrl })` devolve `"<thumb> 400w, <detail> 1280w"` só com a imagem exibida (`original`, o que vai no `src`) e os dois derivados, com URLs absolutas sem espaço/vírgula. `IMAGE_SLOTS` tem, por slot, o `sizes` e se ele pode receber o thumb; `imageSrcSetProps(srcSet, slot)` devolve o `srcSet`/`sizes` da `<img>` (slot grande: só o candidato `1280w`). `src` segue o original (fallback). Os loaders selecionam as duas colunas do MESMO LEFT JOIN que já trazia o `blob_url`, então o gate de moderação é o mesmo; sem `original` o builder não monta o `srcset`.
  - **Quais slots recebem o thumb:** só os que nunca passam de 200 px CSS (400 / 2), para o thumb ter densidade ≥ 2 em qualquer tela de DPR até 2: card em lista (`w-32 sm:w-36`) e as miniaturas (Cardápio, Despensa, cozinheiro, galeria). Capa do detalhe, cards de Minhas criações/Salvos (~300–570 px) e a grade das semelhantes (158 px no desktop, até ~270 px num celular deitado) recebem só o detail. Motivo: a spec deixa a escolha ao navegador, e o Chrome usa a média geométrica entre candidatos vizinhos; num slot de 350 px em DPR 2 ele escolheria o thumb (densidade 1,14) e ampliaria.
  - Com `srcset`: feed/Descoberta, Busca, Seguindo, receita da semana, perfil público e semelhantes (`RecipeResultItem`); cozinheiros recomendados (`cook-card`); Minhas criações; Salvos e coleções; Cardápio (semana, seletor, sugestão) e Despensa (`MealPlanThumb`); capa do detalhe (`recipe-detail-view`); miniaturas da galeria do estúdio do dono (`recipe-image-manager`).
  - No original, de propósito: OG/Twitter e o `image` do JSON-LD (`src/server/recipe/seo.ts`; scrapers de preview tratam WebP de forma desigual, o card social pede ≥1200 px, e é um acesso por compartilhamento, não por visita); telas do Curador (fila de moderação, fila de revisão, comparador de prompt, estúdio do catálogo: julgar a imagem pede o arquivo inteiro, e o tráfego é mínimo); o preview da geração no estúdio do dono (o dono avalia a imagem que acabou de gerar). A foto da avaliação e o avatar não são `recipe_image` e não mudaram.
- **Backfill: cron `/api/cron/image-derivatives`** (`src/app/api/cron/image-derivatives/route.ts` + `src/server/images/derivatives-backfill.ts`, `vercel.json` às 10:30 UTC). Por que cron e não script nem rota de admin: roda no deploy com as credenciais que já estão lá (Blob e banco), sem ninguém pôr a URL do Neon de produção nem o token do Blob numa máquina local (CLAUDE.md, incidente de 2026-09-09); segue o padrão fail-closed dos outros três crons (`CRON_SECRET`); e depois de esvaziar a fila custa uma contagem por dia (mais um download por semana de cada falha permanente, que volta à fila depois de 7 dias). Uma rota de admin pediria UI ou curl com sessão; um script pediria as credenciais de produção localmente.
  - Fila: `thumb_url IS NULL AND moderated_at IS NULL` e (`derivatives_attempted_at IS NULL` ou mais velho que 7 dias). Ordem: nunca tentadas primeiro, depois as imagens selecionadas (a face exibida, `recipe.image_id` de qualquer versão) antes das que só estão na Galeria, depois a mais antiga.
  - Por passada: até 25 imagens; não começa imagem nova quando sobram menos de 15 s dos 40 s do orçamento (`maxDuration = 60`; o pior caso de uma imagem, ~10 s de download + 2 × 10 s de sharp, ainda cabe).
  - Por imagem: carimba `derivatives_attempted_at`, lê o original do Blob (só URL nossa, `store.owns`; `fetch` com `AbortSignal.timeout(10 s)`, `redirect: 'error'` e teto de 25 MB pelo `content-length` e pelos bytes lidos), gera e sobe o par, e faz `UPDATE … WHERE id AND blob_url = <o lido> AND thumb_url IS NULL AND detail_url IS NULL`. Não casou (linha apagada, preenchida por outra passada ou original trocado) ⇒ apaga o par recém-subido e conta `descartadas`.
  - Não destrutivo: nunca apaga nem sobrescreve o original nem um derivado já gravado. Idempotente: imagem preenchida sai da fila. Falha permanente (imagem animada, formato sem derivado, original sumido, host estrangeiro) sai da fila por 7 dias: volta uma vez por semana, custa um download e sai de novo, sem travar as outras.
  - Uma linha por passada: `[image-derivatives] passada concluída: pendentes=… nuncaTentadas=… tentadas=… preenchidas=… falhas=… descartadas=… restantes=… nuncaTentadasRestantes=…` (ou `passada com falha: <erro>` e 500 se o banco cair). `pendentes`/`nuncaTentadas` são a fila antes da passada; `restantes`/`nuncaTentadasRestantes` são recontadas depois dela.
- ADR-0016 (atualização com a decisão) e ADR-0022 (seção `Atualização (2026-10-14)` sobre a imagem-base) atualizados; CONTEXT.md ganhou uma linha em **Imagem da receita** (derivados não são itens da Galeria nem Receita derivada); relatório: I resolvido, §7 novo.

## 2. Evidência

**Bytes** (sharp 0.34.5, WebP q80; PNG sintético "tipo Gemini" com textura fractal `feTurbulence` e 120 formas com borda, o mesmo gerador da suíte; o de 1024² dá 1,56 MB, como o Gemini):

| Original | PNG | `detail_url` | `thumb_url` | sharp (mediana de 5) |
|---|---|---|---|---|
| 1024×1024 | 1.564 KB | 1024×1024, 66 KB (24× menor) | 400×400, 20 KB (78× menor) | 142 ms |
| 1536×1024 | 2.514 KB | 1280×853, 73 KB (35× menor) | 400×267, 16 KB (162× menor) | 212 ms |

Um feed de 20 cards: ~31 MB → ~0,4 MB. Foto real comprime um pouco pior em WebP que esta textura; a ordem de grandeza não muda.

**Escolha do derivado** (`test/unit/image-variants.test.ts`): avaliador de `sizes` e duas regras de escolha, porque a spec deixa a escolha ao navegador: "menor candidato com densidade ≥ DPR" e a do Chrome (média geométrica entre vizinhos; pode ficar com o candidato menor que o DPR e ampliar). O teste varre as viewports de 320 a 2560 px em DPR 1, 1,5 e 2 e exige que nenhuma das duas escolha um candidato abaixo do necessário havendo um maior; e que `thumb: true` só exista em slot que nunca passa de 200 px. Card em lista (128 px no celular, 144 px a partir de 40rem) ⇒ thumb no celular até DPR 3 e no desktop até DPR 2. Miniaturas (Cardápio, Despensa, cozinheiro, galeria) ⇒ thumb sempre. Capa do detalhe, cards de Minhas criações/Salvos e grade das semelhantes ⇒ detail sempre.

**Suíte** (`test/integration/image-derivatives.test.ts`, 32 testes, Blob sempre pelo `FakeImageStore`):
- sharp: larguras e proporção, WebP, thumb < detail < original, JPEG e WebP também, sem ampliar, EXIF aplicada (200×100 com Orientation=6 ⇒ thumb 100×200 sem EXIF), animada, lixo, SVG rotulado png (rápido, sem renderizar), GIF e TIFF ⇒ sem derivado, par pela metade ⇒ apaga e devolve null;
- upload do dono (rota real): original com os mesmos bytes, par gravado, a view traz `imageSrcSet`; com o Blob dos derivados fora ⇒ 200, colunas NULL, sem `srcset`; bytes que o sharp não lê ⇒ 200 como antes; SVG rotulado `image/png` ⇒ 200 em menos de 2 s, só o original;
- upload do catálogo e geração por IA (rota real): par gravado, galeria com `srcSet`; a edição imagem-a-imagem recebe o PNG original;
- APAGAR da galeria (dono e catálogo), hard-delete da Receita e a escalada `record_deletion` do operador apagam os três blobs;
- leitura: feed, Busca, Minhas criações, perfil e detalhe trazem o mesmo `imageSrcSet`; moderada ⇒ some do público junto com a foto, o dono segue vendo; sem derivados ⇒ nenhum `imageSrcSet`;
- backfill: preenche sem tocar o original, 2ª passada não tenta nada, não sobrescreve derivado existente, respeita o lote e põe as selecionadas primeiro, falha permanente sai da fila por 7 dias e volta uma vez, imagem moderada fica fora, URL de outro host não é buscada, orçamento de tempo e reserva de 15 s, corrida (linha preenchida no meio ⇒ descarta e apaga o par), o CHECK recusa um derivado sem o par;
- `RealImageStore.get` (`test/integration/image-store-seam.test.ts`, `fetch` dublê): timeout e `redirect: 'error'` passados, `content-length` acima de 25 MB e stream acima de 25 MB ⇒ lança;
- cron: 401 sem/errado `CRON_SECRET` (nada roda), 200 com as contagens.

**Migração no Postgres local** (cluster `17/perf`):
- banco novo (`mig77_fresh`): as 78 migrações aplicadas em ~1,5 s;
- banco na 0076 com dados (`mig77_data`, cópia de `perf_m76_small`: 860 Receitas, 400 `recipe_image`, 300 delas selecionadas): 0077 aplicada, colunas NULL nas 400 linhas, CHECK presente; `__drizzle_migrations` com `created_at = 1791970990746`.

**Verificação:** `npx tsc --noEmit` limpo; `npx eslint .` sem erro novo (os 4 warnings de `<img>` são de arquivos que não mudaram); `vitest run` completo verde; `next build` verde. Os testes antigos de imagem usam bytes falsos (`[1,2,3,4]`): o sharp falha (loga `[imagens] derivados não gerados (sharp): Error`) e o resto do teste roda como antes, sem blob a mais.

## 3. O que ler primeiro

1. `docs/adr/0016-imagem-da-receita-entidade.md`, atualização de 2026-10-14.
2. `src/server/images/image-derivatives.ts` e `src/domain/image-variants.ts`.
3. `src/server/recipe/image.ts`: `applyRecipeImageUpload`, `generateAndStoreGalleryImage`, `createGalleryImage`, `applyRecipeGalleryImageDelete`, `reapOrphanImage`.
4. `src/server/images/derivatives-backfill.ts` e `src/app/api/cron/image-derivatives/route.ts`.
5. `test/integration/image-derivatives.test.ts` e `test/unit/image-variants.test.ts`.

## 4. Princípios inegociáveis

- **O original é intocável e é a fonte.** Nada grava em `blob_url` de uma linha existente; edição imagem-a-imagem, "baixar original" e qualquer reprocessamento leem o original, nunca um derivado.
- **Derivado é só exibição e é best-effort.** Falhar nele nunca falha upload, geração nem resposta; NULL ⇒ a tela usa o original.
- **O par anda junto** (CHECK no banco, `buildImageSrcSet` exige os dois): um `srcset` com só o thumb faria a capa sair com 400 px.
- **Mesmo gate da foto:** as colunas vêm do mesmo LEFT JOIN (`moderated_at IS NULL`) e o projetor só monta o `srcset` quando há `imageUrl`.
- **Quem apaga uma `recipe_image` apaga os três blobs.** Caminho novo de deleção: `RETURNING(IMAGE_BLOB_COLS)` + `deleteOrphanBlobs(store, imageRowBlobUrls(row))` depois do commit (os três em `src/server/images/image-blobs.ts`).
- **Caminho novo que cria `recipe_image`** passa `derivatives` ao `createGalleryImage` (com `renderImageDerivativesSafe` em paralelo ao `put` do original e `storeImageDerivatives` depois). Esquecer não quebra nada (o cron preenche), mas a imagem nasce pesada.

## 5. Landmines

- **`sizes` espelha as classes CSS.** Mudou a largura de um card (`w-32 sm:w-36`, grade 2/4 colunas, `p-3` do `li` da grade, contêiner `reading`)? Ajuste `IMAGE_SLOTS` e o teste. Errar para mais só baixa o derivado maior; o layout não muda. Um slot que passe a poder ter mais de 200 px CSS precisa de `thumb: false` (o teste falha se não tiver).
- **Larguras nominais no `srcset`.** O derivado não é ampliado: original de 1024 px gera `detail` de 1024 px descrito como `1280w`. Só orienta a escolha; nunca tem menos pixels que o original.
- **Latência da escrita:** o sharp (~150–250 ms numa imagem do Gemini) roda em paralelo com o `put` do original; somam-se dois `put` pequenos (~20 e ~70 KB) em paralelo. Na geração (~10 s de Gemini) é ruído; no upload, alguns centésimos.
- **Memória:** decodificar 1536×1024 RGBA são ~6 MB; o teto de 24 MP barra bomba de descompressão (uploads seguem limitados a 2 MB pela rota). Os dois renders são sequenciais de propósito: em paralelo o pico dobrava. Não há `sharp.concurrency`/cache global.
- **Formato pelo `metadata()`, não pelo `file.type`.** Quem acrescentar um formato a `DERIVABLE_FORMATS` abre de novo a porta do SVG/TIFF caro; não acrescente sem medir.
- **Storage:** ~90 KB a mais por imagem (~6% do PNG).
- **Cron na Vercel:** no Hobby, cron só diário e com hora aproximada (dentro da hora marcada). Cada passada faz até 25 imagens; com N imagens antigas, a fila esvazia em ~N/25 dias. As selecionadas (a face exibida) vêm primeiro. Para ir mais rápido, rode à mão (§6). `CRON_SECRET` precisa existir no ambiente de produção (os outros crons já usam); sem ele, a rota responde 401 e nada roda.
- **Passadas concorrentes** (cron + execução manual ao mesmo tempo): no pior caso as duas geram o par da mesma imagem; a perdedora apaga o dela (`descartadas`). Nada se perde, nada se sobrescreve.
- **Trocar qualidade ou largura depois:** não basta zerar as colunas (os blobs antigos ficariam órfãos). Liste as URLs, zere as colunas, apague os blobs listados e deixe o cron regenerar. Os derivados vivem em `recipes/w400/` e `recipes/w1280/`.
- **Imagem animada ou de formato sem derivado** (SVG, GIF, TIFF, HEIF) nunca ganha derivado: conta em `falhas`, sai da fila por 7 dias e volta uma vez por semana. É esperado; custa um download por imagem por semana.
- **Teste com bytes falsos** (`Buffer.from([1,2,3,4])`): o sharp falha e loga `[imagens] …`. Para testar derivados, gere uma imagem com sharp (como a suíte nova).
- **`reapOrphanImage` devolve `string[]`** (antes `string | null`).
- Herdado: Postgres local no cluster `17/perf` (porta 5433, `postgres:postgres`); `TEST_DATABASE_URL`/`DATABASE_URL_UNPOOLED` inline por comando, nunca exportados. Um vitest por vez no cluster.
- **Desfazer.** Reverter o código basta (a mudança é aditiva), mas deixa órfãos:
  - **Depois de reverter só o código:** o código antigo não conhece `thumb_url`/`detail_url`, então quem apagar uma `recipe_image` (galeria, hard-delete) apaga só o original e os derivados ficam no Blob. Antes de voltar com a 0077 (ou de largar as colunas), varra `recipes/w400/` e `recipes/w1280/` no Blob e apague as chaves que nenhuma linha referencia (`SELECT thumb_url, detail_url FROM recipe_image WHERE thumb_url IS NOT NULL` dá as referenciadas).
  - **Desfazer também no banco (raro):** ANTES do DROP, exporte as URLs (`COPY (SELECT thumb_url, detail_url FROM recipe_image WHERE thumb_url IS NOT NULL) TO STDOUT`, ou pelo SQL Editor do Neon) e apague esses blobs no Blob; depois do DROP não há mais como saber quais são. Então:
  ```sql
  ALTER TABLE recipe_image DROP CONSTRAINT recipe_image_derivatives_pair_chk,
    DROP COLUMN thumb_url, DROP COLUMN detail_url, DROP COLUMN derivatives_attempted_at;
  DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791970990746;
  ```
  E varra `recipes/w400/` e `recipes/w1280/` de novo (algo pode ter subido entre o export e o DROP).

## 6. Backfill em produção: como e quando roda

**Não há nada para rodar à mão.** Depois do deploy (a 0077 vai no `npm run db:migrate` do build da Vercel), o cron `/api/cron/image-derivatives` roda todo dia por volta das 10:30 UTC (07:30 em Brasília) com as credenciais do próprio deploy. Nenhum script local, nenhuma credencial de produção fora da Vercel.

- **Acelerar:** no painel da Vercel, projeto → Settings → Cron Jobs → `/api/cron/image-derivatives` → **Run**. Cada clique é mais uma passada (até 25 imagens). Repita até `nuncaTentadasRestantes=0` no log: aí o backfill já passou por todas as imagens antigas, e `restantes=0` na mesma linha (cada tentativa sai da fila: preenchida, ou carimbada por 7 dias).
- **Acompanhar:** logs da Vercel, filtro `[image-derivatives]`: uma linha por passada com `pendentes`, `nuncaTentadas`, `preenchidas`, `falhas`, `restantes`, `nuncaTentadasRestantes`. Ou, leitura só, no Neon (SQL Editor do console, nunca DDL/DML):
  ```sql
  SELECT count(*) AS total,
         count(thumb_url) AS com_derivados,
         count(*) FILTER (WHERE thumb_url IS NULL AND moderated_at IS NULL
                            AND derivatives_attempted_at IS NULL) AS nunca_tentadas,
         count(*) FILTER (WHERE thumb_url IS NULL AND derivatives_attempted_at IS NOT NULL) AS falharam,
         count(*) FILTER (WHERE thumb_url IS NULL AND moderated_at IS NOT NULL) AS moderadas_fora_da_fila
  FROM recipe_image;
  ```
- **Falhas:** `falhas>0` são originais sem derivado possível (blob apagado, imagem animada, formato fora de JPEG/PNG/WebP). Ficam no original, como hoje, e voltam à fila uma vez por semana; nada a fazer. Imagem moderada não entra na fila (o público não a vê).

## 7. Critério de saída

- PR mergeado com painel de revisão limpo e "checks" verde.
- **Em produção, depois do deploy:**
  - a 0077 aplicada: `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1` devolve `created_at = 1791970990746` (leitura só), ou o log do build mostra o `db:migrate` sem erro;
  - um upload ou geração nova: a imagem nova tem `thumb_url` e `detail_url` preenchidos (consulta acima, `com_derivados` sobe), e no DevTools (Network, filtro Img) o card baixa um `.webp` de dezenas de KB em `recipes/w400/`;
  - a primeira passada do cron aparece no log com `preenchidas>0`; em ~N/25 dias (ou antes, com **Run**), `nuncaTentadasRestantes=0` e `restantes=0`. Depois disso, uma vez por semana uma passada com `pendentes`=`falhas`=k (as falhas permanentes de volta) e `restantes=0` é o estado normal;
  - smoke visual: home, Busca, detalhe, Minhas criações, Salvos, Cardápio e Despensa com as mesmas fotos, recortes e selos de antes; o card social (`og:image`) continua o PNG.

## 8. Fora deste PR (follow-ups anotados no painel de revisão)

- **Foto da avaliação** (`src/app/api/recipes/[id]/reviews/route.ts`): mesma exposição a SVG/TIFF caro rotulado como `image/png` (confere só o `file.type` e o sharp decodifica pelos bytes). Lá o sharp reencoda o upload inteiro, então barrar o formato muda a resposta (400 em vez de 200): decisão de comportamento, não deste PR.
- **Os quatro crons** (`account-purge`, `dsar-sla`, `rate-limit-cleanup`, `image-derivatives`) comparam o `CRON_SECRET` com `!==`; trocar por comparação de tempo constante (`crypto.timingSafeEqual`) nos quatro de uma vez.
- **Upload que já é WebP de até 1280 px** ganha um segundo encode com perda no `detail`. Dá para servir o próprio original como detail nesse caso (exige cuidar do par e da deleção, que hoje supõem três blobs distintos).
- **Capa do detalhe em desktop retina:** antes baixava o original do Gemini (~1536 px de largura); agora baixa o detail de 1280 px para um slot de 784 px CSS (1568 px em DPR 2). Um pouco menos nítida em DPR 2; se incomodar, um terceiro derivado (~1600 px) ou o original no `srcset` com a largura gravada.
- **`owns()` preso ao host do NOSSO store** (hoje: qualquer `*.public.blob.vercel-storage.com`). Exigiria derivar o host do token ou de uma env nova; ficou de fora por não ser trivial nem livre de risco (um host errado viraria órfão silencioso em toda deleção).

## 9. Próximos passos (ordem aprovada em 2026-10-13)

1. **A, segundo passo:** ISR do detalhe público (bloqueios no handoff 67 §5).
2. **G:** gaveta "Criar" lazy (pré-carga, fallback para `/create`) + largura 512 px.
3. **Em espera:** B (HNSW) e H passo 2 (paginação), até o catálogo crescer. Despensa: pré-filtro por palavras e nome traduzido gravado na escrita, se o acervo crescer (handoff 68).
4. **Opcional, se o dono quiser:** OG com um derivado JPEG de 1200 px (hoje fica no original de propósito, §1).
