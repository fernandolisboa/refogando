-- Só CREATE INDEX (sem CONCURRENTLY: o migrator roda em transação). `lock_timeout` limita a espera por
-- cada lock: sem ele, um CREATE INDEX esperando atrás de uma transação longa enfileiraria as escritas
-- seguintes na tabela. Os índices de `recipe` vêm primeiro: um DELETE de Receita em curso trava `recipe`
-- e depois as tabelas das cascatas (notification, creation_session...), na mesma ordem desta migração.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "recipe_feed_created_idx" ON "recipe" USING btree ("created_at","id") WHERE "recipe"."result_kind" <> 'playful' AND "recipe"."moderation_removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "recipe_parent_recipe_id_idx" ON "recipe" USING btree ("parent_recipe_id") WHERE "recipe"."parent_recipe_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recipe_moderated_by_idx" ON "recipe" USING btree ("moderated_by") WHERE "recipe"."moderated_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recipe_reviewed_by_idx" ON "recipe" USING btree ("reviewed_by") WHERE "recipe"."reviewed_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_provider_account_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "creation_session_recipe_id_idx" ON "creation_session" USING btree ("recipe_id") WHERE "creation_session"."recipe_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_recipe_id_idx" ON "notification" USING btree ("recipe_id") WHERE "notification"."recipe_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_review_id_idx" ON "notification" USING btree ("review_id") WHERE "notification"."review_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recipe_ingredient_ingredient_id_idx" ON "recipe_ingredient" USING btree ("ingredient_id") WHERE "recipe_ingredient"."ingredient_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "report_reporter_id_idx" ON "report" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shopping_list_item_source_recipe_id_idx" ON "shopping_list_item" USING btree ("source_recipe_id") WHERE "shopping_list_item"."source_recipe_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "verification_identifier_created_idx" ON "verification" USING btree ("identifier","created_at");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expires_at");