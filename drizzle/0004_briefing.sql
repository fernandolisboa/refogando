CREATE TYPE "public"."strength" AS ENUM('required', 'preferred');--> statement-breakpoint
CREATE TABLE "briefing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cozinha" "cozinha",
	"restricoes" "restricao"[] DEFAULT '{}' NOT NULL,
	"porcoes" integer,
	"dificuldade" integer,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefing_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"briefing_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"strength" "strength" NOT NULL,
	"raw_text" text,
	"quantidade" numeric(10, 3),
	"unidade" "unidade",
	"ordem" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creation_session" ADD COLUMN "briefing_id" uuid;--> statement-breakpoint
ALTER TABLE "briefing_item" ADD CONSTRAINT "briefing_item_briefing_id_briefing_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_item" ADD CONSTRAINT "briefing_item_ingredient_id_ingredient_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefing_item_briefing_id_idx" ON "briefing_item" USING btree ("briefing_id");--> statement-breakpoint
ALTER TABLE "creation_session" ADD CONSTRAINT "creation_session_briefing_id_briefing_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creation_session" ADD CONSTRAINT "creation_session_structured_briefing_chk" CHECK ("creation_session"."mode" <> 'structured' OR "creation_session"."briefing_id" IS NOT NULL);