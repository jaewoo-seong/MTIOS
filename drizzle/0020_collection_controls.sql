CREATE TABLE "collection_directives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"instruction" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"absorbed_stage" text,
	"created_by" uuid,
	"absorbed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_id" uuid,
	"query" text NOT NULL,
	"query_normalized" text NOT NULL,
	"query_embedding" vector(1536),
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reuse_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_campaigns" ADD COLUMN "research_cost_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_campaigns" ADD COLUMN "ceiling_cents" bigint;--> statement-breakpoint
ALTER TABLE "collection_directives" ADD CONSTRAINT "collection_directives_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_directives" ADD CONSTRAINT "collection_directives_campaign_id_collection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."collection_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_directives" ADD CONSTRAINT "collection_directives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_evidence" ADD CONSTRAINT "collection_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_evidence" ADD CONSTRAINT "collection_evidence_campaign_id_collection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."collection_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_evidence" ADD CONSTRAINT "collection_evidence_candidate_id_collection_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."collection_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_directive_pending_idx" ON "collection_directives" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_evidence_campaign_query_idx" ON "collection_evidence" USING btree ("campaign_id","query_normalized");--> statement-breakpoint
CREATE INDEX "collection_evidence_candidate_idx" ON "collection_evidence" USING btree ("candidate_id");