CREATE TABLE "organization_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"company_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"industries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"geographies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ideal_clients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"value_propositions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"differentiators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engagement_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qualification_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"terminology" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forbidden_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_projects" (
	"report_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"citation_key" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"included_characters" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_profile_versions" ADD CONSTRAINT "organization_profile_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_profile_versions" ADD CONSTRAINT "organization_profile_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_profile_versions" ADD CONSTRAINT "organization_profile_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_projects" ADD CONSTRAINT "report_projects_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_projects" ADD CONSTRAINT "report_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_projects" ADD CONSTRAINT "report_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_document_revision_id_document_revisions_id_fk" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_profile_revision_idx" ON "organization_profile_versions" USING btree ("organization_id","revision");--> statement-breakpoint
CREATE INDEX "organization_profile_status_idx" ON "organization_profile_versions" USING btree ("organization_id","status","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "report_project_unique_idx" ON "report_projects" USING btree ("report_id","project_id");--> statement-breakpoint
CREATE INDEX "report_project_project_idx" ON "report_projects" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_source_revision_unique_idx" ON "report_sources" USING btree ("report_id","document_revision_id");--> statement-breakpoint
CREATE INDEX "report_source_report_idx" ON "report_sources" USING btree ("organization_id","report_id");