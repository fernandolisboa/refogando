CREATE TYPE "public"."transcript_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "transcript_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_session_id" uuid NOT NULL,
	"role" "transcript_role" NOT NULL,
	"content" text NOT NULL,
	"seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript_message" ADD CONSTRAINT "transcript_message_creation_session_id_creation_session_id_fk" FOREIGN KEY ("creation_session_id") REFERENCES "public"."creation_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_message_session_seq_idx" ON "transcript_message" USING btree ("creation_session_id","seq");