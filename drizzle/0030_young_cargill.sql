ALTER TYPE "public"."project_status" ADD VALUE 'draft' BEFORE 'active';--> statement-breakpoint
CREATE TABLE "mcp_project_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"external_client_name" text NOT NULL,
	"conversation_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "agent_definitions" SET "description" = 'Plans and reviews governed Business OS work, proposes research strategy, delegates bounded tasks, and pauses at approval gates.' WHERE "role" = 'executive';--> statement-breakpoint
UPDATE "agent_definitions" SET "description" = 'Executes bounded research, analysis, document, and data tasks under the active project strategy without expanding its own authority.' WHERE "role" = 'worker';--> statement-breakpoint
ALTER TABLE "mcp_external_invocations" ADD COLUMN "response" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_project_origins" ADD CONSTRAINT "mcp_project_origins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_project_origins" ADD CONSTRAINT "mcp_project_origins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_project_origins" ADD CONSTRAINT "mcp_project_origins_credential_id_mcp_external_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."mcp_external_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_project_origins" ADD CONSTRAINT "mcp_project_origins_invocation_id_mcp_external_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."mcp_external_invocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_project_origin_project_idx" ON "mcp_project_origins" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "mcp_project_origin_credential_idx" ON "mcp_project_origins" USING btree ("credential_id","created_at");
