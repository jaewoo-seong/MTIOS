ALTER TABLE "model_calls" ALTER COLUMN "run_id" DROP NOT NULL;
ALTER TABLE "model_calls" ADD COLUMN "operation_id" text;
ALTER TABLE "model_calls" ADD COLUMN "task_profile" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "model_calls" ADD COLUMN "selection_reason" text;
CREATE INDEX "model_calls_operation_idx" ON "model_calls" USING btree ("operation_id");
