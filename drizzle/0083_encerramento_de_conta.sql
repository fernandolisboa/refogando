-- #606: registro do encerramento de conta pela equipe (Console → Usuários, ADR-0051 P1/P3). Uma linha por conta
-- eliminada pelo admin, gravada na mesma transação da eliminação: motivo de lista fechada (enum, sem texto livre), se
-- o conteúdo público saiu (só no menor de 16, CHECK), se o aviso por e-mail foi tentado e quem decidiu. Nada de
-- e-mail, nome ou @. user_id RESTRICT (a linha users sobrevive anonimizada); decided_by SET NULL. Retenção de 5 anos
-- pelo cron de retenção. Tabela nova e vazia: sem reescrita nem lock em tabela existente além das FKs para users.
CREATE TYPE "public"."account_closure_reason" AS ENUM('menor_16', 'violacao_grave');--> statement-breakpoint
CREATE TABLE "account_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" "account_closure_reason" NOT NULL,
	"removed_public_content" boolean DEFAULT false NOT NULL,
	"notified_by_email" boolean NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_closure_public_content_chk" CHECK ("account_closure"."removed_public_content" = false or "account_closure"."reason" = 'menor_16')
);
--> statement-breakpoint
ALTER TABLE "account_closure" ADD CONSTRAINT "account_closure_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_closure" ADD CONSTRAINT "account_closure_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_closure_user_id_idx" ON "account_closure" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_closure_decided_by_idx" ON "account_closure" USING btree ("decided_by") WHERE "account_closure"."decided_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "account_closure_created_at_idx" ON "account_closure" USING btree ("created_at");