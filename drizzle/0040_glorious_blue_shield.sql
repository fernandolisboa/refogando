ALTER TABLE "report" ALTER COLUMN "recipe_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "review_id" uuid;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_review_id_recipe_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."recipe_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_review_status_idx" ON "report" USING btree ("review_id","status");--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_target_chk" CHECK (("report"."recipe_id" is null) <> ("report"."review_id" is null));