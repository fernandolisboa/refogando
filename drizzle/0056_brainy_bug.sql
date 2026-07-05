CREATE TABLE "extraction_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "extraction_cap_by_role" jsonb DEFAULT '{"usuario":60,"curador":120,"admin":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_event" ADD CONSTRAINT "extraction_event_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extraction_event_user_created_idx" ON "extraction_event" USING btree ("user_id","created_at");