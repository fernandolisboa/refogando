-- #642 (ADR-0056): tradução sob demanda com single-flight, cache negativo de falha e cota por usuário.
-- `recipe_translation_attempt`: no máximo uma linha por (receita, locale) ainda sem tradução — o lease "em voo"
-- (`lease_id`/`lease_until`) e o cache negativo da última falha (`failed_at`/`retry_at`/`fail_key`). Sem usuário
-- e sem conteúdo (a chave é um hash da fonte); recipe_id CASCADE; o sucesso apaga a linha.
-- `quota_hold` ganha o tipo `translation` (a reserva da tradução disparada por um usuário, que não tem evento
-- próprio e conta até vencer). Tabela nova e vazia; o CHECK novo valida as poucas reservas em voo (≤ 2 dias).
CREATE TABLE "recipe_translation_attempt" (
	"recipe_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"fail_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_translation_attempt_recipe_id_locale_pk" PRIMARY KEY("recipe_id","locale")
);
--> statement-breakpoint
ALTER TABLE "quota_hold" DROP CONSTRAINT "quota_hold_kind_chk";--> statement-breakpoint
ALTER TABLE "recipe_translation_attempt" ADD CONSTRAINT "recipe_translation_attempt_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_hold" ADD CONSTRAINT "quota_hold_kind_chk" CHECK ("quota_hold"."kind" IN ('recipe_gen', 'image_gen', 'translation'));