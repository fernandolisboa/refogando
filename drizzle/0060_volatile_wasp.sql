CREATE TABLE "web_search_usage_daily" (
	"day" text PRIMARY KEY NOT NULL,
	"query_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
