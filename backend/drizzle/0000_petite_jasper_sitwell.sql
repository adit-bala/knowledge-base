CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('draft', 'published', 'archive', 'in_review');--> statement-breakpoint
--- HACK: We manually create this role in koyeb
-- DROP ROLE IF EXISTS "read_only";--> statement-breakpoint
-- CREATE ROLE "read_only" WITH LOGIN PASSWORD 'postgres';--> statement-breakpoint
CREATE TABLE "article" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp NOT NULL,
	"markdown" text NOT NULL,
	"status" "status",
	"last_edited" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "embedding" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"chunk_idx" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embedding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddingIndex" ON "embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "content_search_index" ON "embedding" USING gin (to_tsvector('english', content));--> statement-breakpoint
CREATE POLICY "article_no_write" ON "article" AS PERMISSIVE FOR ALL TO "read_only" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "article_select" ON "article" AS PERMISSIVE FOR SELECT TO "read_only" USING (true);--> statement-breakpoint
CREATE POLICY "embedding_no_write" ON "embedding" AS PERMISSIVE FOR ALL TO "read_only" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "embedding_select" ON "embedding" AS PERMISSIVE FOR SELECT TO "read_only" USING (true);--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO "read_only";--> statement-breakpoint
GRANT SELECT ON "article" TO "read_only";--> statement-breakpoint
GRANT SELECT ON "embedding" TO "read_only";--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "read_only";
