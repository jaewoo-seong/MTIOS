CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "context_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"language" text DEFAULT 'unknown' NOT NULL,
	"token_estimate" integer NOT NULL,
	"embedding" vector(1536),
	"embedding_route" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_pack_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"score_micros" integer NOT NULL,
	"citation" text NOT NULL,
	"token_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"agenda_id" uuid,
	"task_id" uuid,
	"run_id" uuid,
	"command_id" uuid,
	"query" text NOT NULL,
	"query_language" text DEFAULT 'unknown' NOT NULL,
	"token_budget" integer NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding_route" text DEFAULT 'multilingual_embedding' NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"agenda_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"language" text DEFAULT 'unknown' NOT NULL,
	"authority" text DEFAULT 'working' NOT NULL,
	"approval_status" text DEFAULT 'working' NOT NULL,
	"content_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context_chunks" ADD CONSTRAINT "context_chunks_source_id_context_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."context_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_pack_items" ADD CONSTRAINT "context_pack_items_pack_id_context_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."context_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_pack_items" ADD CONSTRAINT "context_pack_items_chunk_id_context_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."context_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_agenda_id_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."commands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_agenda_id_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_chunk_source_ordinal" ON "context_chunks" USING btree ("source_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "context_pack_chunk" ON "context_pack_items" USING btree ("pack_id","chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_source_identity" ON "context_sources" USING btree ("organization_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "context_chunks_full_text" ON "context_chunks" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
CREATE INDEX "context_chunks_embedding_hnsw" ON "context_chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "context_sources_scope" ON "context_sources" USING btree ("organization_id","project_id","approval_status");
