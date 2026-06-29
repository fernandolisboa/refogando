CREATE TYPE "public"."curation_status" AS ENUM('pending', 'editing', 'approved', 'rejected', 'not_required');--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "curation_status" "curation_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_curation_queue_idx" ON "recipe" USING btree ("created_at") WHERE "recipe"."curation_status" IN ('pending', 'editing');--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_curation_review_consistency_chk" CHECK (("recipe"."reviewed_at" IS NULL) = ("recipe"."reviewed_by" IS NULL));--> statement-breakpoint
-- Backfill (#238, ADR-0026 — hand-add, atômico com o ADD COLUMN): o catálogo JÁ existente
-- (owner-null, editorial escrito à mão #19) deve CONTINUAR público. Sem isto o novo gate
-- (catálogo público <=> curation_status='approved') o esconderia. reviewed_at/reviewed_by
-- ficam NULL (catálogo legado não tem curador registrado) — satisfaz o CHECK acima (ambos NULL).
-- Receita de usuário (owner-not-null) permanece no default 'not_required'.
UPDATE "recipe" SET "curation_status" = 'approved' WHERE "owner_id" IS NULL;