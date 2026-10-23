-- #601 (ADR-0050, "Consequências"): índices para a retenção, a eliminação e a exportação da conta. Cada um
-- tirou um Seq Scan medido com EXPLAIN ANALYZE em dados sintéticos (100 mil Receitas, 110 mil imagens, 200 mil
-- sessões/Avaliações/sessões de criação; números no ADR-0050). Só CREATE INDEX (sem CONCURRENTLY: o migrator
-- roda em transação); `lock_timeout` limita a espera por cada lock, como na 0075. `recipe` vem primeiro (mesma
-- ordem de locks de um DELETE de Receita em curso, que trava `recipe` e depois as tabelas das cascatas).
-- `recipe_review_recipe_id_idx` deixa de ser parcial: o gatilho de RI do cascade (`recipe_id = $1`, sem o
-- filtro `moderated_at IS NULL`) não usava o parcial. O DROP e o CREATE andam na mesma transação.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "recipe_lineage_id_idx" ON "recipe" USING btree ("lineage_id");--> statement-breakpoint
CREATE INDEX "recipe_image_created_by_idx" ON "recipe_image" USING btree ("created_by") WHERE "recipe_image"."created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recipe_image_moderated_by_idx" ON "recipe_image" USING btree ("moderated_by") WHERE "recipe_image"."moderated_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recipe_image_source_image_id_idx" ON "recipe_image" USING btree ("source_image_id") WHERE "recipe_image"."source_image_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX "recipe_review_recipe_id_idx";--> statement-breakpoint
CREATE INDEX "recipe_review_recipe_id_idx" ON "recipe_review" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_review_moderated_by_idx" ON "recipe_review" USING btree ("moderated_by") WHERE "recipe_review"."moderated_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "creation_session_briefing_id_idx" ON "creation_session" USING btree ("briefing_id") WHERE "creation_session"."briefing_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "extraction_event_created_at_idx" ON "extraction_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "image_generation_created_at_idx" ON "image_generation" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "meal_plan_suggestion_event_created_at_idx" ON "meal_plan_suggestion_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_image_gen_blocked_by_idx" ON "users" USING btree ("image_gen_blocked_by") WHERE "users"."image_gen_blocked_by" IS NOT NULL;
