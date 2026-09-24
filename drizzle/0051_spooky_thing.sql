ALTER TABLE "app_config" ADD COLUMN "recipe_variant_config" jsonb DEFAULT '{"enabled":false,"poloA":"tradicional","poloB":"com um toque criativo","instrucao":"Mantenha as duas fiéis ao pedido; divirjam no método e nos ingredientes de destaque, não na identidade do prato."}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "variant_group_id" uuid;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "variant_label" text;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "variant_chosen" boolean;--> statement-breakpoint
CREATE INDEX "generation_variant_group_id_idx" ON "generation" USING btree ("variant_group_id") WHERE "generation"."variant_group_id" IS NOT NULL;