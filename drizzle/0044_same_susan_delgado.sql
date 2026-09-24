CREATE TABLE "takedown_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" text NOT NULL,
	"source_url" text,
	"display_name" text,
	"message" text NOT NULL,
	"contact_email" text,
	"locale" text,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "takedown_ticket_status_received_idx" ON "takedown_ticket" USING btree ("status","received_at");