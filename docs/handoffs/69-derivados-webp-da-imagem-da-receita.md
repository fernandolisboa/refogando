# Handoff 69 — Derivados WebP da Imagem da receita (migração 0077)

**Sessão:** 2026-10-14. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `c0bbf81`, depois do #574). **Migração:** `0077_perf_image_derivatives`. Continuação da auditoria do handoff 64: "migração 2" da ordem aprovada em `docs/perf/2026-10-13-respostas.md`, achado I. Aprovado pelo dono em 2026-10-13: "manter o original intocado". Única mudança visível: quais bytes de imagem o navegador baixa. Layout, recorte, `alt`, regras e respostas da API seguem iguais (a API ganha um campo opcional, `imageSrcSet`, ao lado do `imageUrl`).

## 1. O que foi entregue

- **Migração 0077** (gerada com `drizzle-kit generate` a partir de `src/db/schema.ts`, ajustada à mão como a 0075/0076):
  - `SET LOCAL lock_timeout = '5s'`.
  - Num ALTER TABLE só, em `recipe_image`: `thumb_url text`, `detail_url text`, `derivatives_attempted_at timestamptz` (todos NULL, sem default: só catálogo, sem reescrita) e o CHECK `recipe_image_derivatives_pair_chk` (`(thumb_url IS NULL) = (detail_url IS NULL)`), que varre a tabela uma vez para validar.
  - Sem backfill na migração: as linhas existentes ficam NULL e a tela usa o original até o cron preenchê-las.
- **Geração dos derivados** (`src/server/images/image-derivatives.ts`): sharp, `rotate()` (orientação EXIF), `resize({ width, withoutEnlargement })`, WebP q80; `detail` ~1280 px e `thumb` ~400 px de largura, guardados no mesmo Blob em `recipes/w1280/` e `recipes/w400/`. Teto de 24 MP na entrada (como a foto da avaliação). Imagem animada não ganha derivado. Nunca lança: erro ⇒ uma linha `[imagens] derivados não gerados (sharp|storage): <nome do erro>` e `null`. Se só um dos dois `put` der certo, o que subiu é apagado (o par nunca fica pela metade).
- **Os três caminhos que criam `recipe_image`** (procurei todo `insert(recipeImage)`/`createGalleryImage`; não há outro, nem em `scripts/`):
  1. upload do dono, `applyRecipeImageUpload` (`src/server/recipe/image.ts`);
  2. upload do Curador no catálogo, `applyCatalogImageUpload` (`src/server/curate/catalog-image.ts`);
  3. geração por IA, `generateAndStoreGalleryImage` (dono, catálogo, auto-gen da aprovação e `scripts/images-catalog.ts` passam por ele).
  Em cada um, o sharp roda em paralelo com o `put` do original; os derivados sobem só depois que o original foi guardado (original falhou ⇒ nada órfão) e entram na mesma linha, na mesma transação. Falha nos derivados não muda a resposta: colunas NULL. Se a transação falhar, os três blobs são apagados.
- **O original não muda.** `blob_url` segue sendo o PNG do Gemini ou a foto enviada, byte a byte. A edição imagem-a-imagem lê `recipe_image.blob_url` (testado: o gerador recebe o PNG, não o WebP). `GalleryImage.url` segue sendo o original; o derivado entra só como `srcSet`.
- **Deleção:** os quatro pontos que apagam uma `recipe_image` agora apagam os três blobs depois do commit: APAGAR da galeria do dono e do catálogo (DELETE … RETURNING das três colunas), e o `reapOrphanImage` do hard-delete da Receita (`owner-edit.ts`) e do `operator-clear-attribution.ts`. `reapOrphanImage` passou a devolver `string[]`. Helpers: `IMAGE_BLOB_COLS` e `deleteOrphanBlobs` (`image.ts`), `imageRowBlobUrls` (`image-derivatives.ts`).
- **Exibição** (`src/domain/image-variants.ts`, puro e seguro no client): `buildImageSrcSet(thumb, detail)` devolve `"<thumb> 400w, <detail> 1280w"` só com os dois e com URLs absolutas sem espaço/vírgula; `IMAGE_SIZES` tem o `sizes` de cada slot. A `<img>` recebe `srcSet` e `sizes` antes do `src`; `src` segue o original (fallback). Os loaders selecionam as duas colunas do MESMO LEFT JOIN que já trazia o `blob_url`, então o gate de moderação é o mesmo; o projetor só monta o `srcset` quando há `imageUrl`.
  - Com `srcset`: feed/Descoberta, Busca, Seguindo, receita da semana, perfil público e semelhantes (`RecipeResultItem`); cozinheiros recomendados (`cook-card`); Minhas criações; Salvos e coleções; Cardápio (semana, seletor, sugestão) e Despensa (`MealPlanThumb`); capa do detalhe (`recipe-detail-view`); miniaturas da galeria do estúdio do dono (`recipe-image-manager`).
  - No original, de propósito: OG/Twitter e o `image` do JSON-LD (`src/server/recipe/seo.ts`; scrapers de preview tratam WebP de forma desigual, o card social pede ≥1200 px, e é um acesso por compartilhamento, não por visita); telas do Curador (fila de moderação, fila de revisão, comparador de prompt, estúdio do catálogo: julgar a imagem pede o arquivo inteiro, e o tráfego é mínimo); o preview da geração no estúdio do dono (o dono avalia a imagem que acabou de gerar). A foto da avaliação e o avatar não são `recipe_image` e não mudaram.
- **Backfill: cron `/api/cron/image-derivatives`** (`src/app/api/cron/image-derivatives/route.ts` + `src/server/images/derivatives-backfill.ts`, `vercel.json` às 10:30 UTC). Por que cron e não script nem rota de admin: roda no deploy com as credenciais que já estão lá (Blob e banco), sem ninguém pôr a URL do Neon de produção nem o token do Blob numa máquina local (CLAUDE.md, incidente de 2026-09-09); segue o padrão fail-closed dos outros três crons (`CRON_SECRET`); e depois de esvaziar a fila custa um `count(*)` por dia. Uma rota de admin pediria UI ou curl com sessão; um script pediria as credenciais de produção localmente.
  - Fila: `thumb_url IS NULL`, ordenada por `derivatives_attempted_at` (NULL primeiro), depois faces públicas (`recipe.image_id`) antes de imagens só de galeria, depois a mais antiga.
  - Por passada: até 25 imagens, sem começar imagem nova depois de 40 s (`maxDuration = 60`).
  - Por imagem: carimba `derivatives_attempted_at`, lê o original do Blob (só URL nossa, `store.owns`), gera e sobe o par, e faz `UPDATE … WHERE id AND blob_url = <o lido> AND thumb_url IS NULL AND detail_url IS NULL`. Não casou (linha apagada, preenchida por outra passada ou original trocado) ⇒ apaga o par recém-subido e conta `descartadas`.
  - Não destrutivo: nunca apaga nem sobrescreve o original nem um derivado já gravado. Idempotente: imagem preenchida sai da fila. Falha permanente (original sumido) vai para o fim da fila e não trava as outras.
  - Uma linha por passada: `[image-derivatives] passada concluída: pendentes=… tentadas=… preenchidas=… falhas=… descartadas=… restantes=…` (ou `passada com falha: <erro>` e 500 se o banco cair).
- ADR-0016 (atualização com a decisão) e ADR-0022 (linha sobre a imagem-base) atualizados; relatório: I resolvido, §7 novo.

## 2. Evidência

**Bytes** (sharp 0.34.5, WebP q80; PNG sintético "tipo Gemini" com textura fractal `feTurbulence` e 120 formas com borda, o mesmo gerador da suíte; o de 1024² dá 1,56 MB, como o Gemini):

| Original | PNG | `detail_url` | `thumb_url` | sharp (mediana de 5) |
|---|---|---|---|---|
| 1024×1024 | 1.564 KB | 1024×1024, 66 KB (24× menor) | 400×400, 20 KB (78× menor) | 142 ms |
| 1536×1024 | 2.514 KB | 1280×853, 73 KB (35× menor) | 400×267, 16 KB (162× menor) | 212 ms |

Um feed de 20 cards: ~31 MB → ~0,4 MB. Foto real comprime um pouco pior em WebP que esta textura; a ordem de grandeza não muda.

**Escolha do derivado** (`test/unit/image-variants.test.ts`): avaliador de `sizes` + a regra conservadora (Safari e o texto da spec: menor candidato com densidade ≥ DPR; o Chrome escolhe igual ou menor). Card em lista (128 px no celular, 144 px a partir de 40rem) ⇒ thumb no celular até DPR 3 e no desktop até DPR 2. Miniaturas (Cardápio, Despensa, cozinheiro, galeria) ⇒ thumb sempre. Capa do detalhe ⇒ detail (exceto celular DPR 1, onde 400 px já cobrem o slot de 343 px). Cards de Minhas criações/Salvos (~350 px) ⇒ thumb em DPR 1, detail acima (nunca borrado).

**Suíte** (`test/integration/image-derivatives.test.ts`, 24 testes, Blob sempre pelo `FakeImageStore`):
- sharp: larguras e proporção, WebP, sem ampliar, EXIF aplicada (200×100 com Orientation=6 ⇒ thumb 100×200 sem EXIF), animada e lixo ⇒ sem derivado, par pela metade ⇒ apaga e devolve null;
- upload do dono (rota real): original com os mesmos bytes, par gravado, a view traz `imageSrcSet`; com o Blob dos derivados fora ⇒ 200, colunas NULL, sem `srcset`; bytes que o sharp não lê ⇒ 200 como antes;
- upload do catálogo e geração por IA (rota real): par gravado, galeria com `srcSet`; a edição imagem-a-imagem recebe o PNG original;
- APAGAR da galeria e hard-delete da Receita apagam os três blobs;
- leitura: feed, Busca, Minhas criações, perfil e detalhe trazem o mesmo `imageSrcSet`; moderada ⇒ some do público junto com a foto, o dono segue vendo; sem derivados ⇒ nenhum `imageSrcSet`;
- backfill: preenche sem tocar o original, 2ª passada não tenta nada, não sobrescreve derivado existente, respeita o lote e põe faces primeiro, falha permanente vai para o fim, URL de outro host não é buscada, orçamento de tempo, corrida (linha preenchida no meio ⇒ descarta e apaga o par), o CHECK recusa um derivado sem o par;
- cron: 401 sem/errado `CRON_SECRET` (nada roda), 200 com as contagens.

**Migração no Postgres local** (cluster `17/perf`):
- banco novo (`mig77_fresh`): as 78 migrações aplicadas em ~1,5 s;
- banco na 0076 com dados (`mig77_data`, cópia de `perf_m76_small`: 860 Receitas, 400 `recipe_image`, 300 delas faces): 0077 aplicada, colunas NULL nas 400 linhas, CHECK presente; `__drizzle_migrations` com `created_at = 1791970990746`.

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
- **Quem apaga uma `recipe_image` apaga os três blobs.** Caminho novo de deleção: `RETURNING(IMAGE_BLOB_COLS)` + `deleteOrphanBlobs(store, imageRowBlobUrls(row))` depois do commit.
- **Caminho novo que cria `recipe_image`** passa `derivatives` ao `createGalleryImage` (com `renderImageDerivativesSafe` em paralelo ao `put` do original e `storeImageDerivatives` depois). Esquecer não quebra nada (o cron preenche), mas a imagem nasce pesada.

## 5. Landmines

- **`sizes` espelha as classes CSS.** Mudou a largura de um card (`w-32 sm:w-36`, grade 2/4 colunas, contêiner `reading`)? Ajuste `IMAGE_SIZES` e o teste. Errar para mais só baixa o derivado maior; o layout não muda.
- **Larguras nominais no `srcset`.** O derivado não é ampliado: original de 1024 px gera `detail` de 1024 px descrito como `1280w`. Só orienta a escolha; nunca tem menos pixels que o original.
- **Latência da escrita:** o sharp (~150–250 ms numa imagem do Gemini) roda em paralelo com o `put` do original; somam-se dois `put` pequenos (~20 e ~70 KB) em paralelo. Na geração (~10 s de Gemini) é ruído; no upload, alguns centésimos.
- **Memória:** decodificar 1536×1024 RGBA são ~6 MB; o teto de 24 MP barra bomba de descompressão (uploads seguem limitados a 2 MB pela rota).
- **Storage:** ~90 KB a mais por imagem (~6% do PNG).
- **Cron na Vercel:** no Hobby, cron só diário e com hora aproximada (dentro da hora marcada). Cada passada faz até 25 imagens; com N imagens antigas, a fila esvazia em ~N/25 dias. Faces vêm primeiro. Para ir mais rápido, rode à mão (§6). `CRON_SECRET` precisa existir no ambiente de produção (os outros crons já usam); sem ele, a rota responde 401 e nada roda.
- **Passadas concorrentes** (cron + execução manual ao mesmo tempo): no pior caso as duas geram o par da mesma imagem; a perdedora apaga o dela (`descartadas`). Nada se perde, nada se sobrescreve.
- **Trocar qualidade ou largura depois:** não basta zerar as colunas (os blobs antigos ficariam órfãos). Liste as URLs, zere as colunas, apague os blobs listados e deixe o cron regenerar. Os derivados vivem em `recipes/w400/` e `recipes/w1280/`.
- **Imagem animada** (WebP/GIF com mais de um quadro) nunca ganha derivado: fica sempre na fila com `falhas`, ao fim dela. É esperado.
- **Teste com bytes falsos** (`Buffer.from([1,2,3,4])`): o sharp falha e loga `[imagens] …`. Para testar derivados, gere uma imagem com sharp (como a suíte nova).
- **`reapOrphanImage` devolve `string[]`** (antes `string | null`).
- Herdado: Postgres local no cluster `17/perf` (porta 5433, `postgres:postgres`); `TEST_DATABASE_URL`/`DATABASE_URL_UNPOOLED` inline por comando, nunca exportados. Um vitest por vez no cluster.
- **Desfazer só no banco (raro; reverter o código basta, a mudança é aditiva):**
  ```sql
  ALTER TABLE recipe_image DROP CONSTRAINT recipe_image_derivatives_pair_chk,
    DROP COLUMN thumb_url, DROP COLUMN detail_url, DROP COLUMN derivatives_attempted_at;
  DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791970990746;
  ```
  Os blobs dos derivados (`recipes/w400/`, `recipes/w1280/`) podem ser apagados no painel do Blob depois.

## 6. Backfill em produção: como e quando roda

**Não há nada para rodar à mão.** Depois do deploy (a 0077 vai no `npm run db:migrate` do build da Vercel), o cron `/api/cron/image-derivatives` roda todo dia por volta das 10:30 UTC (07:30 em Brasília) com as credenciais do próprio deploy. Nenhum script local, nenhuma credencial de produção fora da Vercel.

- **Acelerar:** no painel da Vercel, projeto → Settings → Cron Jobs → `/api/cron/image-derivatives` → **Run**. Cada clique é mais uma passada (até 25 imagens). Repita até `restantes=0` no log.
- **Acompanhar:** logs da Vercel, filtro `[image-derivatives]`: uma linha por passada com `pendentes`, `preenchidas`, `falhas`, `restantes`. Ou, leitura só, no Neon (SQL Editor do console, nunca DDL/DML):
  ```sql
  SELECT count(*) AS total,
         count(thumb_url) AS com_derivados,
         count(*) FILTER (WHERE thumb_url IS NULL AND derivatives_attempted_at IS NOT NULL) AS falharam
  FROM recipe_image;
  ```
- **Falhas:** `falhas>0` repetido nas mesmas imagens é original ilegível (blob apagado, imagem animada). Ficam no original, como hoje; nada a fazer.

## 7. Critério de saída

- PR mergeado com painel de revisão limpo e "checks" verde.
- **Em produção, depois do deploy:**
  - a 0077 aplicada: `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1` devolve `created_at = 1791970990746` (leitura só), ou o log do build mostra o `db:migrate` sem erro;
  - um upload ou geração nova: a imagem nova tem `thumb_url` e `detail_url` preenchidos (consulta acima, `com_derivados` sobe), e no DevTools (Network, filtro Img) o card baixa um `.webp` de dezenas de KB em `recipes/w400/`;
  - a primeira passada do cron aparece no log com `preenchidas>0`; em ~N/25 dias (ou antes, com **Run**), `restantes=0`;
  - smoke visual: home, Busca, detalhe, Minhas criações, Salvos, Cardápio e Despensa com as mesmas fotos, recortes e selos de antes; o card social (`og:image`) continua o PNG.

## 8. Próximos passos (ordem aprovada em 2026-10-13)

1. **A, segundo passo:** ISR do detalhe público (bloqueios no handoff 67 §5).
2. **G:** gaveta "Criar" lazy (pré-carga, fallback para `/create`) + largura 512 px.
3. **Em espera:** B (HNSW) e H passo 2 (paginação), até o catálogo crescer. Despensa: pré-filtro por palavras e nome traduzido gravado na escrita, se o acervo crescer (handoff 68).
4. **Opcional, se o dono quiser:** OG com um derivado JPEG de 1200 px (hoje fica no original de propósito, §1).
