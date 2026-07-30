ALTER TABLE "collection_candidates" ADD COLUMN "dossier_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD COLUMN "dossier_markdown" text;--> statement-breakpoint
ALTER TABLE "collection_candidates" ADD COLUMN "dossier_reason" text;