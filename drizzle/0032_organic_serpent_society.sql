CREATE INDEX "users_name_trgm_gin" ON "users" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_handle_trgm_gin" ON "users" USING gin ("handle" gin_trgm_ops);