ALTER TABLE "app_config" ALTER COLUMN "default_model" SET DEFAULT 'claude-opus-5-5';--> statement-breakpoint
-- Leva a linha singleton ao sucessor do que estava escolhido (as 2 opções antigas do admin). Só a
-- config muda: `generation.model` (quem gerou cada Receita) fica intocado.
UPDATE "app_config" SET "default_model" = CASE "default_model"
  WHEN 'claude-opus-4-8' THEN 'claude-opus-5-5'
  WHEN 'claude-sonnet-4-6' THEN 'claude-sonnet-5'
END
WHERE "default_model" IN ('claude-opus-4-8', 'claude-sonnet-4-6');
