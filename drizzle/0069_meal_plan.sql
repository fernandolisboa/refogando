CREATE TYPE "public"."meal_slot" AS ENUM('cafe_da_manha', 'almoco', 'lanche', 'jantar');--> statement-breakpoint
CREATE TABLE "meal_plan_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"slot" "meal_slot" NOT NULL,
	"recipe_id" uuid NOT NULL,
	"porcoes" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_plan_entry_user_day_slot_recipe_uq" UNIQUE("user_id","day","slot","recipe_id"),
	CONSTRAINT "meal_plan_entry_porcoes_chk" CHECK ("meal_plan_entry"."porcoes" IS NULL OR "meal_plan_entry"."porcoes" BETWEEN 1 AND 99)
);
--> statement-breakpoint
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_plan_entry_recipe_id_idx" ON "meal_plan_entry" USING btree ("recipe_id");