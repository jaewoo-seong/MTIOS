CREATE TABLE "research_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"cache_key" text NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"etag" text,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"claim_key" text NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'unresolved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_domain_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"access" text DEFAULT 'allow' NOT NULL,
	"robots_policy" text DEFAULT 'respect' NOT NULL,
	"requests_per_second" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"publisher" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"original_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"language" text DEFAULT 'unknown' NOT NULL,
	"license" text,
	"content_hash" text NOT NULL,
	"citation" text NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"quality_score" integer DEFAULT 0 NOT NULL,
	"evidence_state" text DEFAULT 'available' NOT NULL,
	"cache_state" text DEFAULT 'miss' NOT NULL,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_provider_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"result_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"retry_after_ms" integer,
	"fallback_from" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"base_url" text NOT NULL,
	"credential_env" text,
	"requires_credential" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"requests_per_second" integer DEFAULT 1 NOT NULL,
	"concurrency" integer DEFAULT 1 NOT NULL,
	"daily_query_limit" integer,
	"cache_ttl_seconds" integer DEFAULT 86400 NOT NULL,
	"policy_url" text,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agenda_id" uuid NOT NULL,
	"run_id" uuid,
	"query" text NOT NULL,
	"category" text DEFAULT 'web' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"query_budget" integer DEFAULT 10 NOT NULL,
	"queries_used" integer DEFAULT 0 NOT NULL,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_cache" ADD CONSTRAINT "research_cache_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_cache" ADD CONSTRAINT "research_cache_provider_id_research_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."research_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_contradictions" ADD CONSTRAINT "research_contradictions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_contradictions" ADD CONSTRAINT "research_contradictions_query_id_research_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."research_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_domain_policies" ADD CONSTRAINT "research_domain_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_query_id_research_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."research_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_provider_id_research_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."research_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_provider_attempts" ADD CONSTRAINT "research_provider_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_provider_attempts" ADD CONSTRAINT "research_provider_attempts_query_id_research_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."research_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_provider_attempts" ADD CONSTRAINT "research_provider_attempts_provider_id_research_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."research_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_providers" ADD CONSTRAINT "research_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_agenda_id_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_cache_provider_key_idx" ON "research_cache" USING btree ("provider_id","cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "research_contradiction_query_claim_idx" ON "research_contradictions" USING btree ("query_id","claim_key");--> statement-breakpoint
CREATE UNIQUE INDEX "research_domain_policy_org_domain_idx" ON "research_domain_policies" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "research_evidence_query_hash_idx" ON "research_evidence" USING btree ("query_id","content_hash");--> statement-breakpoint
CREATE INDEX "research_evidence_query_state_idx" ON "research_evidence" USING btree ("query_id","evidence_state");--> statement-breakpoint
CREATE UNIQUE INDEX "research_provider_org_key_idx" ON "research_providers" USING btree ("organization_id","key");