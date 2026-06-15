CREATE TYPE "public"."categoria" AS ENUM('entrada', 'prato_principal', 'sobremesa', 'bebida', 'molho', 'acompanhamento', 'lanche', 'cafe_da_manha');--> statement-breakpoint
CREATE TYPE "public"."cozinha" AS ENUM('italiana', 'japonesa', 'brasileira', 'baiana', 'mineira', 'mexicana', 'chinesa', 'indiana', 'tailandesa', 'francesa', 'arabe', 'portuguesa', 'mediterranea', 'peruana');--> statement-breakpoint
CREATE TYPE "public"."lineage_kind" AS ENUM('regenerated', 'edited');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('catalog', 'ai_chat', 'ai_structured', 'user_edited');--> statement-breakpoint
CREATE TYPE "public"."restricao" AS ENUM('sem_gluten', 'sem_lactose', 'vegano', 'vegetariano', 'sem_acucar', 'low_carb', 'sem_oleaginosas', 'sem_frutos_do_mar');--> statement-breakpoint
CREATE TYPE "public"."result_kind" AS ENUM('success', 'degraded', 'playful');--> statement-breakpoint
CREATE TYPE "public"."translation_provenance" AS ENUM('escrita_por_pessoa', 'automatica_revisada', 'automatica_nao_revisada');--> statement-breakpoint
CREATE TYPE "public"."unidade" AS ENUM('g', 'kg', 'ml', 'l', 'colher_de_sopa', 'colher_de_cha', 'xicara', 'unidade', 'dente', 'fatia', 'pitada', 'a_gosto', 'q_b');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text,
	"alergenos" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_translation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"nome" text NOT NULL,
	"aliases" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"result_kind" "result_kind" DEFAULT 'success' NOT NULL,
	"owner_id" uuid,
	"original_locale" text NOT NULL,
	"cozinha" "cozinha",
	"categoria" "categoria",
	"restricoes" "restricao"[] DEFAULT '{}' NOT NULL,
	"porcoes" integer,
	"dificuldade" integer,
	"parent_recipe_id" uuid,
	"lineage_kind" "lineage_kind",
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_playful_private_chk" CHECK ("recipe"."result_kind" <> 'playful' OR "recipe"."visibility" = 'private')
);
--> statement-breakpoint
CREATE TABLE "recipe_embedding" (
	"recipe_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"embedding" vector(1536),
	"model" text,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_embedding_recipe_id_locale_pk" PRIMARY KEY("recipe_id","locale")
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"ordem" integer DEFAULT 0 NOT NULL,
	"quantidade" numeric(10, 3),
	"unidade" "unidade",
	"raw_text" text,
	"nota" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_tag" (
	"recipe_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "recipe_tag_recipe_id_tag_id_pk" PRIMARY KEY("recipe_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_translation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text,
	"passos" text[],
	"notas" text,
	"provenance" "translation_provenance" NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient_translation" ADD CONSTRAINT "ingredient_translation_ingredient_id_ingredient_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_parent_recipe_id_recipe_id_fk" FOREIGN KEY ("parent_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_embedding" ADD CONSTRAINT "recipe_embedding_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_ingredient_id_ingredient_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_tag" ADD CONSTRAINT "recipe_tag_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_tag" ADD CONSTRAINT "recipe_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_translation" ADD CONSTRAINT "recipe_translation_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_slug_uq" ON "ingredient" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_translation_ingredient_locale_uq" ON "ingredient_translation" USING btree ("ingredient_id","locale");--> statement-breakpoint
CREATE INDEX "recipe_restricoes_gin" ON "recipe" USING gin ("restricoes");--> statement-breakpoint
CREATE INDEX "recipe_ingredient_recipe_id_idx" ON "recipe_ingredient" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_translation_recipe_locale_uq" ON "recipe_translation" USING btree ("recipe_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_nome_uq" ON "tag" USING btree ("nome");--> statement-breakpoint
CREATE OR REPLACE FUNCTION refuse_origin_change() RETURNS trigger AS $$
BEGIN
  IF OLD.origin IS DISTINCT FROM NEW.origin THEN
    RAISE EXCEPTION 'origin é imutável (ADR-0002): % -> %', OLD.origin, NEW.origin
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER recipe_origin_immutable
  BEFORE UPDATE ON recipe
  FOR EACH ROW
  EXECUTE FUNCTION refuse_origin_change();