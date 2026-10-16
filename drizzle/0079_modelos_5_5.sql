-- ADR-0046: o app passa a usar só Haiku, Sonnet e Opus, os três na 5.5. Move
-- o modelo EM USO de cada tarefa para a 5.5 do mesmo nível (Fable, que saiu da lista, vai para o Opus,
-- o nível mais alto que ficou). Só mexe em modelo das famílias conhecidas que ainda não está na 5.5;
-- qualquer outro valor fica como está. Os ajustes salvos por modelo (`byModel`) ficam: o modelo novo sem
-- ajuste salvo usa o default da tarefa para ele (`defaultSettings`). `generation.model` das Receitas
-- (proveniência) não é tocado. Daqui em diante a troca de versão é automática (cron /api/cron/ai-models).
UPDATE "app_config" SET "default_model" = CASE
  WHEN "default_model" LIKE 'claude-opus-%' OR "default_model" LIKE 'claude-fable-%' THEN 'claude-opus-5-5'
  WHEN "default_model" LIKE 'claude-sonnet-%' THEN 'claude-sonnet-5-5'
  WHEN "default_model" LIKE 'claude-haiku-%' THEN 'claude-haiku-5-5'
  ELSE "default_model"
END
WHERE "default_model" NOT IN ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5');--> statement-breakpoint
UPDATE "app_config" SET "ai_tasks" = (
  SELECT jsonb_object_agg(
    t.key,
    CASE
      WHEN jsonb_typeof(t.value) = 'object' AND jsonb_typeof(t.value -> 'model') = 'string' THEN
        jsonb_set(t.value, '{model}', to_jsonb(CASE
          WHEN t.value ->> 'model' LIKE 'claude-opus-%' OR t.value ->> 'model' LIKE 'claude-fable-%' THEN 'claude-opus-5-5'
          WHEN t.value ->> 'model' LIKE 'claude-sonnet-%' THEN 'claude-sonnet-5-5'
          WHEN t.value ->> 'model' LIKE 'claude-haiku-%' THEN 'claude-haiku-5-5'
          ELSE t.value ->> 'model'
        END))
      ELSE t.value
    END
  )
  FROM jsonb_each("app_config"."ai_tasks") AS t
)
WHERE jsonb_typeof("ai_tasks") = 'object' AND "ai_tasks" <> '{}'::jsonb;
