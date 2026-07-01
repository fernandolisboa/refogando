CREATE TABLE "recipe_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"photo_url" text,
	"moderated_at" timestamp with time zone,
	"moderated_reason" text,
	"moderated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_review_user_recipe_uq" UNIQUE("user_id","recipe_id"),
	CONSTRAINT "recipe_review_rating_chk" CHECK ("recipe_review"."rating" between 1 and 5),
	CONSTRAINT "recipe_review_moderation_consistency_chk" CHECK (("recipe_review"."moderated_at" is null) = ("recipe_review"."moderated_by" is null))
);
--> statement-breakpoint
ALTER TABLE "recipe_review" ADD CONSTRAINT "recipe_review_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_review" ADD CONSTRAINT "recipe_review_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_review" ADD CONSTRAINT "recipe_review_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_review_recipe_id_idx" ON "recipe_review" USING btree ("recipe_id") WHERE "recipe_review"."moderated_at" is null;