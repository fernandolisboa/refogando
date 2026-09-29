CREATE TABLE "pantry_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"match_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_item_user_match_uq" UNIQUE("user_id","match_key"),
	CONSTRAINT "pantry_item_nome_chk" CHECK (char_length("pantry_item"."nome") BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;