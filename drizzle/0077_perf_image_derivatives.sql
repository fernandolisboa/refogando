-- Achado I da auditoria de performance (2026-10-13): derivados WebP da Imagem da receita para servir
-- (`detail_url` ~1280 px, `thumb_url` ~400 px). O `blob_url` (o original) não muda. Só colunas NULLABLE
-- sem default e um CHECK: o ADD COLUMN é só de catálogo (sem reescrita); o ADD CONSTRAINT varre a tabela
-- uma vez sob ACCESS EXCLUSIVE para validar (todas as linhas nascem NULL/NULL, o CHECK vale). Com o volume
-- de hoje (centenas de imagens) é instantâneo. Num ALTER TABLE só (um lock). `lock_timeout` limita a
-- espera pelo lock, como na 0075/0076: sem ele, o ALTER esperando atrás de uma transação longa
-- enfileiraria as leituras e escritas seguintes em `recipe_image` (todo card com foto a lê).
-- Sem backfill aqui: as imagens existentes ficam NULL (a tela cai no original) até o cron
-- `/api/cron/image-derivatives` preenchê-las em lotes (handoff 69).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "recipe_image"
  ADD COLUMN "thumb_url" text,
  ADD COLUMN "detail_url" text,
  ADD COLUMN "derivatives_attempted_at" timestamp with time zone,
  ADD CONSTRAINT "recipe_image_derivatives_pair_chk" CHECK (("recipe_image"."thumb_url" IS NULL) = ("recipe_image"."detail_url" IS NULL));
