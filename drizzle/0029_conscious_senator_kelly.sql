CREATE TABLE "mcp_external_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"client_name" text NOT NULL,
	"public_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_mode" text DEFAULT 'selected_projects' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotated_from_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_external_credential_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_external_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"project_id" uuid,
	"idempotency_key" text,
	"request_hash" text NOT NULL,
	"request_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_summary" jsonb,
	"status" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_external_credentials" ADD CONSTRAINT "mcp_external_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_external_credentials" ADD CONSTRAINT "mcp_external_credentials_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_external_credential_projects" ADD CONSTRAINT "mcp_external_credential_projects_credential_id_mcp_external_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."mcp_external_credentials"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_external_credential_projects" ADD CONSTRAINT "mcp_external_credential_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_external_invocations" ADD CONSTRAINT "mcp_external_invocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_external_invocations" ADD CONSTRAINT "mcp_external_invocations_credential_id_mcp_external_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."mcp_external_credentials"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_external_invocations" ADD CONSTRAINT "mcp_external_invocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_external_credential_prefix_idx" ON "mcp_external_credentials" USING btree ("public_prefix");
--> statement-breakpoint
CREATE INDEX "mcp_external_credential_org_status_idx" ON "mcp_external_credentials" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "mcp_external_credential_creator_idx" ON "mcp_external_credentials" USING btree ("created_by_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_external_credential_project_idx" ON "mcp_external_credential_projects" USING btree ("credential_id","project_id");
--> statement-breakpoint
CREATE INDEX "mcp_external_credential_project_project_idx" ON "mcp_external_credential_projects" USING btree ("project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_external_invocation_idempotency_idx" ON "mcp_external_invocations" USING btree ("credential_id","tool_name","idempotency_key");
--> statement-breakpoint
CREATE INDEX "mcp_external_invocation_org_time_idx" ON "mcp_external_invocations" USING btree ("organization_id","started_at");
--> statement-breakpoint
CREATE INDEX "mcp_external_invocation_credential_time_idx" ON "mcp_external_invocations" USING btree ("credential_id","started_at");
