CREATE TYPE "public"."plan" AS ENUM('free', 'pro');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" "plan" DEFAULT 'free' NOT NULL;