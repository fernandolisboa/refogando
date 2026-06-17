CREATE INDEX "recipe_embedding_embedding_hnsw" ON "recipe_embedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
