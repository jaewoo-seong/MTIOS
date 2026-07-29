CREATE TABLE "mcp_discoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"status" text NOT NULL,
	"tools_count" integer DEFAULT 0 NOT NULL,
	"resources_count" integer DEFAULT 0 NOT NULL,
	"prompts_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"project_id" uuid,
	"run_id" uuid,
	"worker_run_id" uuid,
	"review_id" uuid,
	"role" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"arguments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"uri" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"mime_type" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"transport" text DEFAULT 'streamable_http' NOT NULL,
	"endpoint" text NOT NULL,
	"auth_secret_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"last_health_check_at" timestamp with time zone,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"role" text NOT NULL,
	"project_id" uuid,
	"allowed" boolean DEFAULT true NOT NULL,
	"max_calls" integer,
	"max_cost_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"group" text NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"approval_requirement" text DEFAULT 'none' NOT NULL,
	"budget_cents" bigint,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_discoveries" ADD CONSTRAINT "mcp_discoveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_discoveries" ADD CONSTRAINT "mcp_discoveries_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_tool_id_mcp_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."mcp_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_worker_run_id_worker_runs_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."worker_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_prompts" ADD CONSTRAINT "mcp_prompts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_prompts" ADD CONSTRAINT "mcp_prompts_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_resources" ADD CONSTRAINT "mcp_resources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_resources" ADD CONSTRAINT "mcp_resources_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_grants" ADD CONSTRAINT "mcp_tool_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_grants" ADD CONSTRAINT "mcp_tool_grants_tool_id_mcp_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."mcp_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_grants" ADD CONSTRAINT "mcp_tool_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_prompt_server_name_idx" ON "mcp_prompts" USING btree ("server_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_resource_server_uri_idx" ON "mcp_resources" USING btree ("server_id","uri");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_org_name_idx" ON "mcp_servers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tool_grant_scope_idx" ON "mcp_tool_grants" USING btree ("tool_id","role","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tool_server_name_idx" ON "mcp_tools" USING btree ("server_id","name");--> statement-breakpoint
CREATE INDEX "mcp_tool_org_group_idx" ON "mcp_tools" USING btree ("organization_id","group");