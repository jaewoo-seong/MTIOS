CREATE TABLE "client_change_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"change_set_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"status" text NOT NULL,
	"applied_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflict_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"applied_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_change_applications_change_set_id_unique" UNIQUE("change_set_id")
);
--> statement-breakpoint
CREATE TABLE "client_change_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"change_set_id" uuid NOT NULL,
	"review_decision_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"proposal_hash" text NOT NULL,
	"selected_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_change_approvals_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "client_change_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_set_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"record_id" uuid,
	"merge_record_id" uuid,
	"before" jsonb,
	"merge_before" jsonb,
	"after" jsonb,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"validation_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duplicate_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_change_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agenda_id" uuid,
	"run_id" uuid,
	"database_id" uuid NOT NULL,
	"review_id" uuid,
	"title" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"applied_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_change_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid,
	"decision" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"selected_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposal_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_change_applications" ADD CONSTRAINT "client_change_applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_applications" ADD CONSTRAINT "client_change_applications_change_set_id_client_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."client_change_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_applications" ADD CONSTRAINT "client_change_applications_approval_id_client_change_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."client_change_approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_approvals" ADD CONSTRAINT "client_change_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_approvals" ADD CONSTRAINT "client_change_approvals_change_set_id_client_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."client_change_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_approvals" ADD CONSTRAINT "client_change_approvals_review_decision_id_review_decisions_id_fk" FOREIGN KEY ("review_decision_id") REFERENCES "public"."review_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_items" ADD CONSTRAINT "client_change_items_change_set_id_client_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."client_change_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_sets" ADD CONSTRAINT "client_change_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_sets" ADD CONSTRAINT "client_change_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_sets" ADD CONSTRAINT "client_change_sets_agenda_id_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_sets" ADD CONSTRAINT "client_change_sets_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_sets" ADD CONSTRAINT "client_change_sets_database_id_client_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."client_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_sets" ADD CONSTRAINT "client_change_sets_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_sets" ADD CONSTRAINT "client_change_sets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_snapshots" ADD CONSTRAINT "client_change_snapshots_application_id_client_change_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."client_change_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_change_snapshots" ADD CONSTRAINT "client_change_snapshots_item_id_client_change_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."client_change_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_change_set_org_idempotency_idx" ON "client_change_sets" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "client_change_set_project_status_idx" ON "client_change_sets" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "client_change_snapshot_application_item_record_idx" ON "client_change_snapshots" USING btree ("application_id","item_id","record_id");