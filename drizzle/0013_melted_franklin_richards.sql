CREATE TABLE "model_route_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"route" text NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"test_status" text DEFAULT 'not_tested' NOT NULL,
	"test_error" text,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'America/Indiana/Indianapolis' NOT NULL,
	"date_format" text DEFAULT 'medium' NOT NULL,
	"number_format" text DEFAULT 'locale' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "output_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_route_revisions" ADD CONSTRAINT "model_route_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_route_revisions" ADD CONSTRAINT "model_route_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_route_revisions" ADD CONSTRAINT "model_route_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_route_revision_version" ON "model_route_revisions" USING btree ("organization_id","route","version");--> statement-breakpoint
CREATE UNIQUE INDEX "user_preference_org_user" ON "user_preferences" USING btree ("organization_id","user_id");