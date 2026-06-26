CREATE TYPE "public"."vocabulary_kind" AS ENUM('cozinha');--> statement-breakpoint
CREATE TYPE "public"."vocabulary_term_status" AS ENUM('suggested', 'active', 'deprecated', 'merged', 'rejected');--> statement-breakpoint
CREATE TABLE "vocabulary_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "vocabulary_kind" NOT NULL,
	"slug" text NOT NULL,
	"status" "vocabulary_term_status" DEFAULT 'suggested' NOT NULL,
	"label_pt_br" text,
	"label_en_us" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vocabulary_term_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "vocabulary_term_kind_status_sort_idx" ON "vocabulary_term" USING btree ("kind","status","sort");
--> statement-breakpoint
INSERT INTO "vocabulary_term" ("kind", "slug", "status", "label_pt_br", "label_en_us", "sort") VALUES
	('cozinha', 'italiana', 'active', 'Italiana', 'Italian', 0),
	('cozinha', 'japonesa', 'active', 'Japonesa', 'Japanese', 1),
	('cozinha', 'brasileira', 'active', 'Brasileira', 'Brazilian', 2),
	('cozinha', 'baiana', 'active', 'Baiana', 'Bahian', 3),
	('cozinha', 'mineira', 'active', 'Mineira', 'Minas Gerais', 4),
	('cozinha', 'mexicana', 'active', 'Mexicana', 'Mexican', 5),
	('cozinha', 'chinesa', 'active', 'Chinesa', 'Chinese', 6),
	('cozinha', 'indiana', 'active', 'Indiana', 'Indian', 7),
	('cozinha', 'tailandesa', 'active', 'Tailandesa', 'Thai', 8),
	('cozinha', 'francesa', 'active', 'Francesa', 'French', 9),
	('cozinha', 'arabe', 'active', 'Árabe', 'Arabic', 10),
	('cozinha', 'portuguesa', 'active', 'Portuguesa', 'Portuguese', 11),
	('cozinha', 'mediterranea', 'active', 'Mediterrânea', 'Mediterranean', 12),
	('cozinha', 'peruana', 'active', 'Peruana', 'Peruvian', 13),
	('cozinha', 'americana', 'active', 'Americana', 'American', 14);
