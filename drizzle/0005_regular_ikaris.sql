CREATE TABLE "campaign_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"trading_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"normalized_name" text NOT NULL,
	"normalized_domain" text,
	"country_code" text,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"completeness" integer DEFAULT 0 NOT NULL,
	"first_researched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"proposed_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"normalized_domain" text,
	"country_code" text,
	"address" text,
	"canonical_company_id" uuid,
	"resolution" text DEFAULT 'new' NOT NULL,
	"resolution_reason" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"issuing_country" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agenda_id" uuid,
	"disposition" text DEFAULT 'in_scope' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_research_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"worker_run_id" uuid,
	"lease_token" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"source_type" text DEFAULT 'web' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agenda_id" uuid,
	"name" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"qualification_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"query_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_count" integer NOT NULL,
	"existing_count_policy" text DEFAULT 'ask' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"unresolved_count" integer DEFAULT 0 NOT NULL,
	"estimated_remaining" integer,
	"saturation_reason" text,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_candidates" ADD CONSTRAINT "campaign_candidates_campaign_id_research_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."research_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_candidates" ADD CONSTRAINT "campaign_candidates_candidate_id_company_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."company_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_companies" ADD CONSTRAINT "canonical_companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_candidates" ADD CONSTRAINT "company_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_candidates" ADD CONSTRAINT "company_candidates_canonical_company_id_canonical_companies_id_fk" FOREIGN KEY ("canonical_company_id") REFERENCES "public"."canonical_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_identifiers" ADD CONSTRAINT "company_identifiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_identifiers" ADD CONSTRAINT "company_identifiers_company_id_canonical_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."canonical_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_project_links" ADD CONSTRAINT "company_project_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_project_links" ADD CONSTRAINT "company_project_links_company_id_canonical_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."canonical_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_project_links" ADD CONSTRAINT "company_project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_project_links" ADD CONSTRAINT "company_project_links_agenda_id_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_research_claims" ADD CONSTRAINT "company_research_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_research_claims" ADD CONSTRAINT "company_research_claims_campaign_id_research_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."research_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_research_claims" ADD CONSTRAINT "company_research_claims_candidate_id_company_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."company_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_research_claims" ADD CONSTRAINT "company_research_claims_worker_run_id_worker_runs_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."worker_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_sources" ADD CONSTRAINT "company_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_sources" ADD CONSTRAINT "company_sources_company_id_canonical_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."canonical_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_campaigns" ADD CONSTRAINT "research_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_campaigns" ADD CONSTRAINT "research_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_campaigns" ADD CONSTRAINT "research_campaigns_agenda_id_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_candidate_idx" ON "campaign_candidates" USING btree ("campaign_id","candidate_id");--> statement-breakpoint
CREATE INDEX "canonical_company_org_name_idx" ON "canonical_companies" USING btree ("organization_id","normalized_name","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_company_org_domain_idx" ON "canonical_companies" USING btree ("organization_id","normalized_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "company_candidate_org_fingerprint_idx" ON "company_candidates" USING btree ("organization_id","fingerprint");--> statement-breakpoint
CREATE INDEX "company_candidate_org_name_idx" ON "company_candidates" USING btree ("organization_id","normalized_name","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "company_identifier_org_type_value_idx" ON "company_identifiers" USING btree ("organization_id","type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "company_project_link_idx" ON "company_project_links" USING btree ("company_id","project_id","agenda_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_research_active_claim_idx" ON "company_research_claims" USING btree ("campaign_id","candidate_id");--> statement-breakpoint
CREATE INDEX "company_research_lease_idx" ON "company_research_claims" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_source_company_url_idx" ON "company_sources" USING btree ("company_id","source_url");