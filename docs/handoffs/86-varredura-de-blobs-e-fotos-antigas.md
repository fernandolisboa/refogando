# Handoff 86 — Varredura de blobs órfãos, fotos antigas com EXIF e fotos de avaliação no "apagar receita" (#603)

**Data:** 2026-10-23.
**PR:** "Varredura semanal de blobs órfãos, fotos antigas sem EXIF e fotos de avaliação no apagar receita (#603)".
**Base:** `main` depois do #614 (migração 0080, índices do #601).
**Migração:** nenhuma.
**ADR:** ADR-0050, "Consequências e riscos", com três atualizações datadas.

## 1. Escopo

Este handoff trata dos três riscos de blob que o ADR-0050 deixou como follow-up:

1. **Blob órfão depois do commit.** Um cron semanal, `/api/cron/blob-sweep` (sábado às 12:00 UTC, em `vercel.json`), lista o Blob e apaga o que nenhuma linha referencia. Ele tem travas contra apagar a imagem que o banco perdeu.
2. **EXIF de envios antigos.** É um passo da mesma varredura e vale até 2026-11-30. O avatar e a foto de receita gravados antes do #596 são baixados. Os que têm EXIF, XMP ou IPTC são re-encodados pelo mesmo pipeline do #596 e trocados no banco.
3. **Fotos de avaliação de terceiros.** O `deleteOwnRecipe` lê as `recipe_review.photo_url` antes do DELETE e apaga os blobs depois do commit.

## 2. O que ler primeiro

1. `src/server/images/blob-sweep.ts`: o doc do módulo explica as travas, e as constantes estão no topo.
2. `src/app/api/cron/blob-sweep/route.ts`: o gate de produção (fail-closed) e a linha de log.
3. `src/server/recipe/owner-edit.ts`, função `deleteOwnRecipe`.
4. `test/integration/blob-sweep.test.ts` e o caso (h) de `test/integration/recipe-delete.test.ts`.
5. A linha `[blob-sweep]` em `docs/observabilidade.md`.

## 3. Princípios inegociáveis

- **Apagar blob é irreversível.** O Blob não tem lixeira, e o backup do Neon não guarda arquivos. Por isso a varredura tem estas travas:
  - **Carência:** só conta como órfão o blob gravado há mais de 24 h.
  - **Prefixos:** só olha `avatars/`, `recipes/` e `reviews/`.
  - **Teto:** apaga no máximo 500 blobs por passada.
  - **Trava por proporção:** a passada para inteira (`travada=1`) quando os órfãos apagáveis passam de 25% dos blobs antigos não retidos (`antigosNaoRetidos`), com pelo menos 20 órfãos.
  - **Passada travada:** não apaga nada e não re-encoda nada.
  - **Pausa manual:** `BLOB_SWEEP_PAUSE=1` nas variáveis de Production da Vercel. Uma restauração de backup recente perde só alguns dias de linhas, abaixo dos 25%, então quem restaura liga a pausa ANTES (roteiro no topo de `.github/workflows/db-backup.yml`).
  - **Trava descartada:** uma trava automática por "órfão mais novo que a linha mais nova do banco" foi descartada na revisão. Qualquer escrita depois da restauração a desarma, e ela travava sozinha quando um upload falhava sem outra escrita na semana.
- **Retidos.** Um órfão gravado antes de 2026-09-19 nunca sai sozinho (`orfaosRetidos`). Em sua maioria, são as imagens das linhas que o incidente de 2026-09-09 apagou: o banco voltou do backup de 06/07 em 18/09, e essas imagens são a única cópia do que se perdeu.
- **Só em produção.** A varredura roda só com `VERCEL_ENV=production`, ou em testes (`NODE_ENV=test`). Num Preview ou num `next dev` local, ela responde `{ pulada: 1 }`.
- **A referência é a URL exata** que o `put` devolveu e o banco guarda: `users.image`, `recipe_image.blob_url`/`thumb_url`/`detail_url` e `recipe_review.photo_url`.
  - Uma coluna NOVA que guarde URL de blob TEM de entrar em `loadReferences`. Se não entrar, a varredura apaga os blobs dela depois de 24 h.
- **O log leva só contagens.** Nunca URL, caminho ou id.

## 4. Auditoria de EXIF (critério da issue)

O ambiente de desenvolvimento não tem credencial do banco nem do Blob de produção. Por isso a auditoria roda dentro do app, como passo da varredura, e não como script de fora.

- **Quando:** a primeira passada é no sábado, 2026-10-24, às 12:00 UTC.
- **Onde ler:** nas contagens `fotos*` da linha `[blob-sweep]` dos logs da Vercel.
- **Como registrar:** quem ler a linha registra o resultado aqui, num PR só de docs.

**Resultado:** _pendente da primeira passada._

## 5. Landmines

- **Decisão pendente do Fernando: os órfãos retidos.** Depois da primeira passada, abra uma issue `ready-for-human` com os números de `orfaos` e `orfaosRetidos`. A pergunta é: apagar, guardar para recuperar, ou recuperar e depois apagar.
  - Contra guardar: são arquivos públicos numa URL não listada, sem conta que os reclame, e podem ter EXIF, porque são anteriores ao #596.
  - Não mexa nas constantes para liberá-los sem essa decisão.
- **`travada=1` em produção.** Compare `orfaos - orfaosRetidos` com `antigosNaoRetidos`: mais de 25% de órfãos apagáveis quer dizer que o banco perdeu linhas recentes (restauração, apagão), ou que uma coluna nova guarda URL de blob e não entrou em `loadReferences`. Não suba a trava; descubra qual dos dois.
- **Formatos fora do sharp.** O sharp só reporta o metadado que entende. HEIC nunca chega aqui, porque o upload só aceita JPEG, PNG e WebP.
- **`fotosFalhas` diferente de zero.** A foto fica como está e volta na passada seguinte. Se a mesma falha se repetir até a data final, a foto fica com o metadado: investigue antes de 2026-11-30.
- **Orçamento.** O orçamento é de 240 s, com `maxDuration = 300` (exige Fluid compute ou plano Pro).
  - Com muitas fotos antigas, a passada termina com `fotosRestantes > 0`, e o resto sai no sábado seguinte. A ordem das fotos gira a cada hora, então uma execução manual uma hora depois começa por outras fotos.
  - Para acelerar, rode o job à mão no painel da Vercel (Settings → Cron Jobs → Run).

## 6. Follow-ups

- **Depois de 2026-11-30:** remover o passo das fotos antigas: `auditLegacyPhoto`, `rotatingOrder`, as constantes `LEGACY_*`, as contagens `fotos*` e a linha correspondente do catálogo.
- **`operatorEscalateSource` (record_deletion):** apaga Receita importada da web. Essa receita é sempre privada e por isso não tem avaliação, e a varredura cobre o caso de qualquer jeito.

## 7. Critério de saída

- [x] Varredura idempotente, com orçamento de tempo e linha numérica no catálogo.
- [ ] Auditoria rodada e resultado registrado na seção 4. Só depois de 2026-10-24 às 12:00 UTC.
- [x] `deleteOwnRecipe` sem blob órfão de avaliação de terceiros, com teste.

## 8. Gotchas de ambiente

- **`uploadedAt` nos testes:** os testes usam `FakeImageStore`, e o `uploadedAt` de cada blob fica em `store.blobs.get(url).uploadedAt`. O teste o envelhece, e `list` pagina pelo índice.
- **`sharp().withExif()`:** gera o JPEG com EXIF usado nos testes.
