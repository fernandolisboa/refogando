-- ADR-0043 (cenário dinâmico das imagens geradas): duas colunas e a cópia do mapa fixo de convenção
-- visual por cozinha (#424) para o banco.
--  - `app_config.image_scene_director_enabled`: liga/desliga o diretor de arte (tarefa de IA `imageScene`)
--    que escolhe o cenário de cada imagem. NOT NULL + DEFAULT constante: no PG11+ o ADD COLUMN é só de
--    catálogo (sem reescrita da linha singleton).
--  - `vocabulary_term.visual_note`: nota visual curada por cozinha (louça, empratamento, superfície), que
--    entra no prompt da imagem. NULLABLE, sem default.
-- O UPDATE copia as 15 entradas de `CUISINE_VISUAL_CONVENTION` (removido do código) com o texto idêntico,
-- só onde a cozinha existe e a nota ainda está vazia (re-rodar não sobrescreve uma nota editada no admin).
-- `lock_timeout` limita a espera pelo lock como na 0075–0077: `vocabulary_term` é lida em toda geração e
-- em toda faceta de cozinha.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "image_scene_director_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_term" ADD COLUMN "visual_note" text;--> statement-breakpoint
UPDATE "vocabulary_term" AS vt
SET "visual_note" = v.note, "updated_at" = now()
FROM (VALUES
  ('italiana', 'louça branca clássica de trattoria, talheres simples, mesa de madeira'),
  ('japonesa', 'louça de cerâmica artesanal, tigelas pequenas e pauzinhos, empratamento minimalista'),
  ('brasileira', 'prato rústico ou panela de barro, cores quentes, mesa acolhedora'),
  ('baiana', 'panela de barro e colher de pau, tons terrosos e alaranjados do dendê, apresentação rústica'),
  ('mineira', 'panela de ferro ou prato de ágata, fogão a lenha ao fundo desfocado, fartura caseira'),
  ('mexicana', 'louça de barro colorida, elementos vibrantes de lima e coentro, textura viva'),
  ('chinesa', 'travessa de porcelana, pauzinhos, empratamento em mesa giratória de restaurante'),
  ('indiana', 'thali de metal ou tigelas de cobre, especiarias visíveis, tons dourados intensos'),
  ('tailandesa', 'tigelas de cerâmica, folhas de bananeira, ervas frescas e frutos do mar vívidos'),
  ('francesa', 'empratamento refinado de bistrô, louça fina branca, molho desenhado no prato'),
  ('arabe', 'travessas de latão ou cerâmica trabalhada, mezze fartos, tapete e tons quentes'),
  ('portuguesa', 'louça de faiança pintada, azulejo ao fundo, apresentação farta e rústica'),
  ('mediterranea', 'louça de cerâmica azul e branca, azeite e ervas, luz mediterrânea clara'),
  ('peruana', 'louça artesanal andina, cores vivas de ají e limão, apresentação contemporânea'),
  ('americana', 'prato de diner ou tábua, porção generosa, estética casual e farta')
) AS v(slug, note)
WHERE vt."kind" = 'cozinha' AND vt."slug" = v.slug AND vt."visual_note" IS NULL;
