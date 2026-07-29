ALTER TABLE "model_calls" ADD COLUMN "licensing_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "environment" text DEFAULT 'development' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "attempt_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "structured_output_valid" boolean;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "request_budget_micros" bigint;