ALTER TABLE "documents" ADD COLUMN "ai_generated" boolean DEFAULT false NOT NULL;
UPDATE "documents" SET "ai_generated" = true
WHERE "id" IN (SELECT "linked_document_id" FROM "collection_candidates" WHERE "linked_document_id" IS NOT NULL);
