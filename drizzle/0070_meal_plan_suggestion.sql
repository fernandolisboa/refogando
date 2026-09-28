CREATE TABLE "meal_plan_suggestion_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6)
);
--> statement-breakpoint
ALTER TABLE "meal_plan_suggestion_event" ADD CONSTRAINT "meal_plan_suggestion_event_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_plan_suggestion_event_user_created_idx" ON "meal_plan_suggestion_event" USING btree ("user_id","created_at");