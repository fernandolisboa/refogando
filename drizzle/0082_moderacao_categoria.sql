-- #609: a categoria do motivo de uma retirada pela curadoria (lista fechada, MODERATION_CATEGORIES de
-- src/domain/moderation-category.ts), guardada na notificação para o dono a ver no app. É um código, não texto:
-- o rótulo é localizado na leitura (ADR-0028, adendo do #609). Só nos 3 tipos de retirada (CHECK). As linhas
-- antigas ficam com NULL e seguem com o texto de antes. ADD COLUMN nullable sem default: só catálogo, sem reescrita.
CREATE TYPE "public"."moderation_category" AS ENUM('direitos_autorais', 'pessoa_real', 'conteudo_ofensivo', 'sexual_ou_violento', 'spam', 'conteudo_ilegal', 'outro');--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "moderation_category" "moderation_category";--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_moderation_category_type_chk" CHECK ("notification"."moderation_category" IS NULL OR "notification"."type" IN ('recipe_moderated', 'review_moderated', 'image_moderated'));
