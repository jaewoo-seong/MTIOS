ALTER TABLE "project_research_settings" ALTER COLUMN "queue_buffer_target" SET DEFAULT 9;
ALTER TABLE "project_research_settings" ADD COLUMN "queue_buffer_automatic" boolean DEFAULT true NOT NULL;
UPDATE "project_research_settings"
SET "queue_buffer_target" = LEAST(100, GREATEST(1, "dossier_worker_limit" * 3));
