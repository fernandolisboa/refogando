-- #640/#641 (ADR-0055): reserva de cota ANTES da chamada paga. Uma linha por pedido de geração de receita
-- (`recipe_gen`, peso `slots` 1, ou 2 no "gerar 2") ou de imagem (`image_gen`), gravada sob a advisory lock do gate
-- antes de chamar o provedor. Nasce já cobrada (`expires_at = created_at + 24 h`); o persist a apaga na mesma tx em
-- que grava a `generation`/`image_generation`, e a falha provadamente não paga do provedor a devolve (DELETE). Sem
-- conteúdo: usuário, tipo e datas. user_id CASCADE; a vencida sai pelo cron de retenção. Tabela nova e vazia: sem
-- reescrita nem lock em tabela existente além da FK para users.
CREATE TABLE "quota_hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"slots" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "quota_hold_kind_chk" CHECK ("quota_hold"."kind" IN ('recipe_gen', 'image_gen')),
	CONSTRAINT "quota_hold_slots_chk" CHECK ("quota_hold"."slots" BETWEEN 1 AND 2)
);
--> statement-breakpoint
ALTER TABLE "quota_hold" ADD CONSTRAINT "quota_hold_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quota_hold_user_kind_expires_idx" ON "quota_hold" USING btree ("user_id","kind","expires_at");