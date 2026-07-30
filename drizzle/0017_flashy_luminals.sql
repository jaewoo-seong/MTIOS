CREATE TABLE "collection_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agenda_id" uuid,
	"name" text NOT NULL,
	"entity_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_template" text DEFAULT '' NOT NULL,
	"dedupe_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qualification_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_count" integer,
	"saturation_rule" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"saturation_reason" text,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_candidate_claims" (
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
CREATE TABLE "collection_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolution" text DEFAULT 'new' NOT NULL,
	"resolution_reason" text,
	"linked_record_id" uuid,
	"linked_document_id" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_campaigns" ADD CONSTRAINT "collection_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_campaigns" ADD CONSTRAINT "collection_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_campaigns" ADD CONSTRAINT "collection_campaigns_agenda_id_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."agendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidate_claims" ADD CONSTRAINT "collection_candidate_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidate_claims" ADD CONSTRAINT "collection_candidate_claims_campaign_id_collection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."collection_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidate_claims" ADD CONSTRAINT "collection_candidate_claims_candidate_id_collection_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."collection_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidate_claims" ADD CONSTRAINT "collection_candidate_claims_worker_run_id_worker_runs_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."worker_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD CONSTRAINT "collection_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD CONSTRAINT "collection_candidates_campaign_id_collection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."collection_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD CONSTRAINT "collection_candidates_linked_record_id_client_records_id_fk" FOREIGN KEY ("linked_record_id") REFERENCES "public"."client_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD CONSTRAINT "collection_candidates_linked_document_id_documents_id_fk" FOREIGN KEY ("linked_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_candidate_active_claim_idx" ON "collection_candidate_claims" USING btree ("campaign_id","candidate_id");--> statement-breakpoint
CREATE INDEX "collection_candidate_lease_idx" ON "collection_candidate_claims" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_candidate_campaign_fingerprint_idx" ON "collection_candidates" USING btree ("campaign_id","fingerprint");