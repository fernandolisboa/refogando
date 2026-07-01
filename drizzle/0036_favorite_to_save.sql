ALTER TABLE "recipe_favorite" RENAME TO "recipe_save";--> statement-breakpoint
ALTER TABLE "recipe_save" RENAME CONSTRAINT "recipe_favorite_user_id_recipe_id_pk" TO "recipe_save_user_id_recipe_id_pk";--> statement-breakpoint
ALTER TABLE "recipe_save" RENAME CONSTRAINT "recipe_favorite_user_id_users_id_fk" TO "recipe_save_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "recipe_save" RENAME CONSTRAINT "recipe_favorite_recipe_id_recipe_id_fk" TO "recipe_save_recipe_id_recipe_id_fk";--> statement-breakpoint
ALTER INDEX "recipe_favorite_recipe_id_idx" RENAME TO "recipe_save_recipe_id_idx";