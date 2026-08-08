CREATE TABLE "company_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"language" text DEFAULT 'unknown' NOT NULL,
	"alias_type" text DEFAULT 'trading_name' NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossier_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"run_id" uuid,
	"strategy_version_id" uuid,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"owner_label" text DEFAULT '' NOT NULL,
	"credential_env" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"quota_period" text DEFAULT 'monthly' NOT NULL,
	"allowance" integer,
	"reset_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"authorization_confirmed_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_provider_account_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid,
	"run_id" uuid,
	"candidate_id" uuid,
	"operation" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'attempted' NOT NULL,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_discovery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid,
	"candidate_id" uuid,
	"company_id" uuid,
	"provider_account_id" uuid,
	"query" text NOT NULL,
	"result_url" text,
	"discovered_name" text NOT NULL,
	"resolution" text NOT NULL,
	"resolution_reason" text,
	"strategy_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_canonical_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."canonical_companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "dossier_context_snapshots" ADD CONSTRAINT "dossier_context_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "dossier_context_snapshots" ADD CONSTRAINT "dossier_context_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "dossier_context_snapshots" ADD CONSTRAINT "dossier_context_snapshots_campaign_id_collection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."collection_campaigns"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "dossier_context_snapshots" ADD CONSTRAINT "dossier_context_snapshots_candidate_id_collection_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."collection_candidates"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "dossier_context_snapshots" ADD CONSTRAINT "dossier_context_snapshots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "dossier_context_snapshots" ADD CONSTRAINT "dossier_context_snapshots_strategy_version_id_project_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."project_strategy_versions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "research_provider_accounts" ADD CONSTRAINT "research_provider_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_provider_account_usage" ADD CONSTRAINT "research_provider_account_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_provider_account_usage" ADD CONSTRAINT "research_provider_account_usage_account_id_research_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."research_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_provider_account_usage" ADD CONSTRAINT "research_provider_account_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "research_provider_account_usage" ADD CONSTRAINT "research_provider_account_usage_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "research_provider_account_usage" ADD CONSTRAINT "research_provider_account_usage_candidate_id_collection_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."collection_candidates"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "company_discovery_events" ADD CONSTRAINT "company_discovery_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "company_discovery_events" ADD CONSTRAINT "company_discovery_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "company_discovery_events" ADD CONSTRAINT "company_discovery_events_campaign_id_collection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."collection_campaigns"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "company_discovery_events" ADD CONSTRAINT "company_discovery_events_candidate_id_collection_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."collection_candidates"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "company_discovery_events" ADD CONSTRAINT "company_discovery_events_company_id_canonical_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."canonical_companies"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "company_discovery_events" ADD CONSTRAINT "company_discovery_events_provider_account_id_research_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."research_provider_accounts"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "company_discovery_events" ADD CONSTRAINT "company_discovery_events_strategy_version_id_project_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."project_strategy_versions"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "company_alias_company_normalized_idx" ON "company_aliases" USING btree ("company_id","normalized_alias");
CREATE INDEX "company_alias_org_normalized_idx" ON "company_aliases" USING btree ("organization_id","normalized_alias");
CREATE INDEX "dossier_context_candidate_idx" ON "dossier_context_snapshots" USING btree ("candidate_id","created_at");
CREATE INDEX "dossier_context_run_idx" ON "dossier_context_snapshots" USING btree ("run_id");
CREATE UNIQUE INDEX "research_provider_account_env_idx" ON "research_provider_accounts" USING btree ("organization_id","credential_env");
CREATE INDEX "research_provider_account_priority_idx" ON "research_provider_accounts" USING btree ("organization_id","provider","status","priority");
CREATE UNIQUE INDEX "research_provider_account_usage_idempotency_idx" ON "research_provider_account_usage" USING btree ("account_id","idempotency_key");
CREATE INDEX "research_provider_account_usage_window_idx" ON "research_provider_account_usage" USING btree ("account_id","occurred_at");
CREATE INDEX "company_discovery_project_company_idx" ON "company_discovery_events" USING btree ("project_id","company_id","created_at");
CREATE INDEX "company_discovery_candidate_idx" ON "company_discovery_events" USING btree ("candidate_id");
