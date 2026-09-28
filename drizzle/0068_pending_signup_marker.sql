-- #470 follow-up (ADR-0014): marcador explícito de cadastro pendente, chave do expurgo de cadastros abandonados
-- (cron account-purge). ADD COLUMN nullable sem default = metadata-only; contas existentes ficam NULL (nunca
-- candidatas — sem backfill por handle/email_verified, de propósito). Índice parcial: só as linhas com marcador.
ALTER TABLE "users" ADD COLUMN "pending_signup_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "users_pending_signup_idx" ON "users" USING btree ("pending_signup_at") WHERE "users"."pending_signup_at" IS NOT NULL;