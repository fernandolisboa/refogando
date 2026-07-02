ALTER TABLE "takedown_ticket" ADD COLUMN "sla_level" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "takedown_ticket" ADD COLUMN "sla_alerted_at" timestamp with time zone;