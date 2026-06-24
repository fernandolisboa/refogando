ALTER TABLE "users" ADD COLUMN "image_gen_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image_gen_blocked_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image_gen_blocked_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_image_gen_blocked_by_users_id_fk" FOREIGN KEY ("image_gen_blocked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_image_gen_block_consistency_chk" CHECK (("users"."image_gen_blocked_at" IS NULL) = ("users"."image_gen_blocked_by" IS NULL));