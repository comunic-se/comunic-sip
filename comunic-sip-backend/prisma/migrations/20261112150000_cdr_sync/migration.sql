-- Coleta de CDR pela OpenAPI do Yeastar
ALTER TABLE "pbx" ADD COLUMN "cdr_synced_at" TIMESTAMP(3);
ALTER TABLE "pbx" ADD COLUMN "cdr_sync_error" TEXT;

ALTER TABLE "calls" ADD COLUMN "from_name" TEXT;
ALTER TABLE "calls" ADD COLUMN "to_name" TEXT;
ALTER TABLE "calls" ADD COLUMN "other_extension" TEXT;
ALTER TABLE "calls" ADD COLUMN "other_user_id" TEXT;
ALTER TABLE "calls" ADD COLUMN "ring_duration" INTEGER;

CREATE UNIQUE INDEX "calls_pbx_id_uid_key" ON "calls"("pbx_id", "uid");
CREATE INDEX "calls_other_user_id_idx" ON "calls"("other_user_id");
