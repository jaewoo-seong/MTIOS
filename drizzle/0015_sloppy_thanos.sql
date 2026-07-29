CREATE TABLE "authentication_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"email" text,
	"event" text NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_pricing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_micros_per_million_tokens" bigint DEFAULT 0 NOT NULL,
	"output_micros_per_million_tokens" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "premium_model_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"run_id" uuid NOT NULL,
	"route" text NOT NULL,
	"proposed_provider" text NOT NULL,
	"proposed_model" text NOT NULL,
	"estimated_input_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_output_tokens" integer DEFAULT 0 NOT NULL,
	"maximum_cost_micros" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"resume_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "premium_model_approvals_resume_token_unique" UNIQUE("resume_token")
);
--> statement-breakpoint
CREATE TABLE "provider_quota_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"route" text DEFAULT '*' NOT NULL,
	"period" text NOT NULL,
	"allowance" integer NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enforcement" text DEFAULT 'block_and_fallback' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"user_id" uuid,
	"run_id" uuid,
	"model_call_id" uuid,
	"provider" text NOT NULL,
	"model" text,
	"route" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'observed' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "agendas" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "agent_type" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "force_password_change" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "temporary_password_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "memberships" SET "role" = 'admin', "updated_at" = now() WHERE "role" = 'owner';--> statement-breakpoint
UPDATE "agendas" SET "created_by" = COALESCE(
  (SELECT "owner_id" FROM "projects" WHERE "projects"."id" = "agendas"."project_id"),
  '00000000-0000-4000-8000-000000000002'::uuid
) WHERE "created_by" IS NULL;--> statement-breakpoint
UPDATE "commands" SET "created_by" = COALESCE(
  (SELECT "owner_id" FROM "projects" WHERE "projects"."id" = "commands"."project_id"),
  '00000000-0000-4000-8000-000000000002'::uuid
) WHERE "created_by" IS NULL;--> statement-breakpoint
UPDATE "documents" SET "created_by" = COALESCE(
  (SELECT "owner_id" FROM "projects" WHERE "projects"."id" = "documents"."project_id"),
  '00000000-0000-4000-8000-000000000002'::uuid
) WHERE "created_by" IS NULL;--> statement-breakpoint
UPDATE "reports" SET "created_by" = COALESCE(
  (SELECT "owner_id" FROM "projects" WHERE "projects"."id" = "reports"."project_id"),
  '00000000-0000-4000-8000-000000000002'::uuid
) WHERE "created_by" IS NULL;--> statement-breakpoint
UPDATE "reviews" SET "created_by" = COALESCE(
  (SELECT "owner_id" FROM "projects" WHERE "projects"."id" = "reviews"."project_id"),
  '00000000-0000-4000-8000-000000000002'::uuid
) WHERE "created_by" IS NULL;--> statement-breakpoint
UPDATE "model_calls" SET
  "project_id" = "commands"."project_id",
  "user_id" = COALESCE("commands"."created_by", '00000000-0000-4000-8000-000000000002'::uuid),
  "agent_type" = CASE
    WHEN "model_calls"."route" LIKE 'executive_%' THEN 'executive'
    ELSE 'worker'
  END
FROM "runs"
JOIN "commands" ON "commands"."id" = "runs"."command_id"
WHERE "model_calls"."run_id" = "runs"."id";--> statement-breakpoint
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_model_approvals" ADD CONSTRAINT "premium_model_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_model_approvals" ADD CONSTRAINT "premium_model_approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_model_approvals" ADD CONSTRAINT "premium_model_approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_model_approvals" ADD CONSTRAINT "premium_model_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_model_approvals" ADD CONSTRAINT "premium_model_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_quota_policies" ADD CONSTRAINT "provider_quota_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_quota_policies" ADD CONSTRAINT "provider_quota_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage_events" ADD CONSTRAINT "provider_usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage_events" ADD CONSTRAINT "provider_usage_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage_events" ADD CONSTRAINT "provider_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage_events" ADD CONSTRAINT "provider_usage_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage_events" ADD CONSTRAINT "provider_usage_events_model_call_id_model_calls_id_fk" FOREIGN KEY ("model_call_id") REFERENCES "public"."model_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authentication_event_user_time_idx" ON "authentication_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_pricing_snapshot_idx" ON "model_pricing_snapshots" USING btree ("provider","model","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "premium_model_approval_run_route_idx" ON "premium_model_approvals" USING btree ("run_id","route");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_quota_policy_scope_idx" ON "provider_quota_policies" USING btree ("organization_id","provider","route","period");--> statement-breakpoint
CREATE INDEX "provider_usage_window_idx" ON "provider_usage_events" USING btree ("organization_id","provider","occurred_at");--> statement-breakpoint
CREATE INDEX "user_session_user_active_idx" ON "user_sessions" USING btree ("user_id","revoked_at","idle_expires_at");--> statement-breakpoint
ALTER TABLE "agendas" ADD CONSTRAINT "agendas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
