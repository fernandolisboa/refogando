CREATE TYPE "public"."dsar_event_type" AS ENUM('DSAR_RECEIVED', 'DSAR_IDENTITY_VERIFIED', 'DSAR_FULFILLED', 'DSAR_REJECTED');--> statement-breakpoint
CREATE TABLE "dsar_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "dsar_event_type" NOT NULL,
	"case_id" uuid,
	"actor_id" uuid,
	"channel" text,
	"request_type" text,
	"verification_method" text,
	"payload_hash" text,
	"reason" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dsar_fulfilled_hash_chk" CHECK ("dsar_audit_event"."event_type" <> 'DSAR_FULFILLED' or "dsar_audit_event"."payload_hash" is not null)
);
--> statement-breakpoint
ALTER TABLE "dsar_audit_event" ADD CONSTRAINT "dsar_audit_event_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dsar_audit_event_case_idx" ON "dsar_audit_event" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "dsar_audit_event_type_created_idx" ON "dsar_audit_event" USING btree ("event_type","created_at");