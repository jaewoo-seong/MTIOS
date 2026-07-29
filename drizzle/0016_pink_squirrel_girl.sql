ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "authentication_events" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
UPDATE "users" SET "username" = CASE
  WHEN "id" = '00000000-0000-4000-8000-000000000002'::uuid THEN 'operator'
  ELSE 'user_' || substring(replace("id"::text, '-', '') from 1 for 12)
END;--> statement-breakpoint
UPDATE "authentication_events" SET "username" = "users"."username"
FROM "users" WHERE "authentication_events"."user_id" = "users"."id";--> statement-breakpoint
UPDATE "user_sessions" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");
