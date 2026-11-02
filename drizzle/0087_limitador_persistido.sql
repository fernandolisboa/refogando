-- #643/#648 (ADR-0057): limitador persistido e cache do vetor da busca.
-- `rate_limit_window`: contador de janela FIXA por (bucket, key, window_start), upsert atômico; a chave é um HMAC
-- (IP ou conta) ou 'global', nunca o dado em claro; `expires_at` = fim da janela, apagada pela limpeza de hora em hora.
-- `search_query_embedding`: vetor da consulta de busca por HMAC da consulta normalizada (sem o texto), vale 6 h, em
-- `halfvec` (meia precisão, ~3 KB por linha; o app limita a tabela a 5000 linhas). `halfvec` pede pgvector >= 0.7: o
-- bloco abaixo atualiza a extensão só se a instalada for mais antiga (a imagem dos testes, pgvector/pgvector:pg17,
-- traz 0.8; a versão do Neon de produção não foi conferida daqui).
-- `takedown_ticket.dpo_arrival_notified_at`: o Encarregado foi avisado da chegada (e-mail individual ou resumo diário).
-- Os tickets existentes nascem carimbados com `received_at` (já passaram pelo e-mail individual de antes), para o
-- primeiro resumo diário não os repetir. Tabelas novas e vazias; a coluna nova é nullable (sem reescrita).
DO $$
BEGIN
	IF (SELECT string_to_array(split_part(extversion, '-', 1), '.')::int[] FROM pg_extension WHERE extname = 'vector') < ARRAY[0, 7] THEN
		ALTER EXTENSION vector UPDATE;
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "rate_limit_window" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_window_bucket_key_window_start_pk" PRIMARY KEY("bucket","key","window_start")
);
--> statement-breakpoint
CREATE TABLE "search_query_embedding" (
	"query_key" text PRIMARY KEY NOT NULL,
	"embedding" halfvec(1536) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "takedown_ticket" ADD COLUMN "dpo_arrival_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rate_limit_window_expires_at_idx" ON "rate_limit_window" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "search_query_embedding_created_at_idx" ON "search_query_embedding" USING btree ("created_at");--> statement-breakpoint
UPDATE "takedown_ticket" SET "dpo_arrival_notified_at" = "received_at" WHERE "dpo_arrival_notified_at" IS NULL;
