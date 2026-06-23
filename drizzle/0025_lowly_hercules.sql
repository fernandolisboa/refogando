-- Linhagem da galeria de imagens (#222, ADR-0022 dec.1). drizzle-kit gerou um ADD COLUMN ... NOT NULL
-- direto em `recipe_image` (sem default), que ESTOURARIA numa tabela com linhas. Reescrito como
-- ADD COLUMN (nullable) → BACKFILL → SET NOT NULL, atômico nesta migração (drizzle envolve cada
-- arquivo numa transação). Espelha o backfill hand-edited do handle (drizzle/0014). ORDEM
-- LOAD-BEARING: o backfill de `recipe` (passo 2) vem ANTES do de `recipe_image` (passo 4, que lê
-- `r.lineage_id` já colapsado).

-- (1) recipe.lineage_id NOT NULL DEFAULT gen_random_uuid(): toda linha existente ganha uma chave
-- PRÓPRIA fresca de imediato (o default preenche no ADD COLUMN). Originais (geração/conversa/
-- catálogo/import/deriva) ficam com chave própria; só a regeneração same-owner deve COLAPSAR.
ALTER TABLE "recipe" ADD COLUMN "lineage_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint

-- (2) Colapsa cada COMPONENTE de regeneração same-owner à lineage_id da sua RAIZ — recursive CTE.
-- Fronteira SAME-OWNER (`IS NOT DISTINCT FROM` trata catálogo owner_id NULL: cadeias NULL-owner
-- colapsam juntas — inócuo, a galeria é owner-gated/canManage-only). A raiz de um componente é uma
-- linha sem pai DO MESMO DONO (parent NULL, ou cujo pai é de outro dono — i.e. uma DERIVA
-- cross-owner, que NÃO compartilha galeria). Acíclico por construção (o pai é sempre uma linha mais
-- antiga pré-existente) ⇒ termina.
WITH RECURSIVE comp AS (
  SELECT r.id, r.owner_id, r.lineage_id AS root_lineage
  FROM recipe r
  WHERE r.parent_recipe_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM recipe p
                     WHERE p.id = r.parent_recipe_id
                       AND p.owner_id IS NOT DISTINCT FROM r.owner_id)
  UNION ALL
  SELECT c.id, c.owner_id, comp.root_lineage
  FROM recipe c
  JOIN comp ON c.parent_recipe_id = comp.id
           AND c.owner_id IS NOT DISTINCT FROM comp.owner_id
)
UPDATE recipe SET lineage_id = comp.root_lineage
FROM comp WHERE recipe.id = comp.id AND recipe.lineage_id <> comp.root_lineage;--> statement-breakpoint

-- (3) recipe_image.lineage_id NULLABLE primeiro (a tabela pode ter linhas; sem default seguro).
ALTER TABLE "recipe_image" ADD COLUMN "lineage_id" uuid;--> statement-breakpoint

-- (4) Backfill DETERMINÍSTICO via subconsulta correlacionada (NÃO `UPDATE ... FROM`, que escolheria
-- uma linha arbitrária em multi-match): uma imagem compartilhada por carry-forward (#131), em
-- especial do catálogo com created_by NULL, deve cair na linhagem ORIGINANTE de forma determinística.
-- Preferência: a Receita cujo dono CASA o created_by da imagem, depois a mais antiga, depois o menor
-- id. Imagens órfãs (nenhuma Receita as referencia) recebem chave fresca no passo seguinte.
UPDATE recipe_image ri SET lineage_id = (
  SELECT r.lineage_id FROM recipe r
  WHERE r.image_id = ri.id
  ORDER BY (r.owner_id IS NOT DISTINCT FROM ri.created_by) DESC, r.created_at ASC, r.id ASC
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM recipe r2 WHERE r2.image_id = ri.id);--> statement-breakpoint

-- Órfãs (sem nenhuma Receita referenciando): chave própria fresca (entram numa galeria singleton
-- inalcançável; inócuo).
UPDATE recipe_image SET lineage_id = gen_random_uuid() WHERE lineage_id IS NULL;--> statement-breakpoint

-- PRÉ-FLIGHT OPS (sem cobertura de teste — o DB de teste nasce vazio): após o deploy, conferir
-- `SELECT count(*) FROM recipe_image WHERE lineage_id IS NULL` (deve ser 0), como no backfill de slug.

-- (5) Agora que toda imagem tem linhagem, trava a presença.
ALTER TABLE "recipe_image" ALTER COLUMN "lineage_id" SET NOT NULL;--> statement-breakpoint

-- (6) Galeria por linhagem: índice composto (lineage_id, created_at) — filtro + ordenação.
CREATE INDEX "recipe_image_lineage_idx" ON "recipe_image" USING btree ("lineage_id","created_at");
