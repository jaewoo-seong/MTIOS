CREATE TABLE "dossier_revision_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"base_revision" integer NOT NULL,
	"instruction" text NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachment_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger_run_id" text,
	"output_revision_id" uuid,
	"error" text,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_research_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"active_strategy_version_id" uuid,
	"dossier_worker_limit" integer DEFAULT 3 NOT NULL,
	"revision_worker_limit" integer DEFAULT 2 NOT NULL,
	"queue_buffer_target" integer DEFAULT 8 NOT NULL,
	"discovery_enabled" boolean DEFAULT true NOT NULL,
	"research_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_strategy_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"strategy_version_id" uuid,
	"attachment_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_strategy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"strategy" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"based_on_version_id" uuid,
	"proposed_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_databases" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN "dossier_document_id" uuid;--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN "disposition" text DEFAULT 'researching' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN "qualification_score" integer;--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN "research_status" text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD COLUMN "strategy_version_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD COLUMN "qualification_score" integer;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD COLUMN "queue_status" text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD COLUMN "disposition" text DEFAULT 'unreviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD COLUMN "base_revision" integer;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD COLUMN "change_summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD COLUMN "feedback_request_id" uuid;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD COLUMN "strategy_version_id" uuid;--> statement-breakpoint
ALTER TABLE "dossier_revision_requests" ADD CONSTRAINT "dossier_revision_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_revision_requests" ADD CONSTRAINT "dossier_revision_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_revision_requests" ADD CONSTRAINT "dossier_revision_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_revision_requests" ADD CONSTRAINT "dossier_revision_requests_output_revision_id_document_revisions_id_fk" FOREIGN KEY ("output_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_revision_requests" ADD CONSTRAINT "dossier_revision_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_research_settings" ADD CONSTRAINT "project_research_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_research_settings" ADD CONSTRAINT "project_research_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_research_settings" ADD CONSTRAINT "project_research_settings_active_strategy_version_id_project_strategy_versions_id_fk" FOREIGN KEY ("active_strategy_version_id") REFERENCES "public"."project_strategy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_messages" ADD CONSTRAINT "project_strategy_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_messages" ADD CONSTRAINT "project_strategy_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_messages" ADD CONSTRAINT "project_strategy_messages_strategy_version_id_project_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."project_strategy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_messages" ADD CONSTRAINT "project_strategy_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_versions" ADD CONSTRAINT "project_strategy_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_versions" ADD CONSTRAINT "project_strategy_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_versions" ADD CONSTRAINT "project_strategy_versions_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_versions" ADD CONSTRAINT "project_strategy_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dossier_revision_project_status_idx" ON "dossier_revision_requests" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "dossier_revision_document_time_idx" ON "dossier_revision_requests" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_research_settings_project_idx" ON "project_research_settings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_strategy_message_time_idx" ON "project_strategy_messages" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_strategy_version_idx" ON "project_strategy_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "project_strategy_status_idx" ON "project_strategy_versions" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "client_databases" ADD CONSTRAINT "client_databases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_records" ADD CONSTRAINT "client_records_dossier_document_id_documents_id_fk" FOREIGN KEY ("dossier_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD CONSTRAINT "collection_candidates_strategy_version_id_project_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."project_strategy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_strategy_version_id_project_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."project_strategy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_database_project_idx" ON "client_databases" USING btree ("project_id");