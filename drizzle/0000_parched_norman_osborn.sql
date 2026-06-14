-- Extensões de fundação (issue #2). drizzle-kit não gera CREATE EXTENSION:
-- adicionadas à mão neste baseline para que viajem no histórico de migrations.
-- unaccent → busca precisa sem acento (#6); vector (pgvector) → camada semântica (#14).
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "ping" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
