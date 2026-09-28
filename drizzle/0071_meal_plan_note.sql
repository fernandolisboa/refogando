ALTER TABLE "meal_plan_entry" ALTER COLUMN "recipe_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_plan_entry" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_user_day_slot_note_uq" UNIQUE("user_id","day","slot","note");--> statement-breakpoint
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_kind_chk" CHECK (("meal_plan_entry"."recipe_id" IS NULL) <> ("meal_plan_entry"."note" IS NULL));--> statement-breakpoint
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_note_chk" CHECK ("meal_plan_entry"."note" IS NULL OR (char_length("meal_plan_entry"."note") BETWEEN 1 AND 80 AND "meal_plan_entry"."porcoes" IS NULL));