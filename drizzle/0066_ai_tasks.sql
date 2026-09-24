ALTER TABLE "app_config" ADD COLUMN "ai_tasks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- ADR-0034: troca o modelo EM USO da Geração para os atuais (0065 só mudou o DEFAULT da coluna). Roda
-- depois do #547 no ar (que já lida com thinking sempre ligado); só mexe em linha que ainda está num
-- modelo antigo conhecido. Qualquer outro valor (escolha manual do admin) fica como está.
UPDATE "app_config" SET "default_model" = CASE "default_model"
  WHEN 'claude-opus-4-8' THEN 'claude-opus-5-5'
  WHEN 'claude-sonnet-4-6' THEN 'claude-sonnet-5'
END
WHERE "default_model" IN ('claude-opus-4-8', 'claude-sonnet-4-6');
