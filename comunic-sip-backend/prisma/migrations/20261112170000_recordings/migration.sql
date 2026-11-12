-- Gravações: só a referência ao arquivo no PBX (o áudio não é armazenado)
ALTER TABLE "calls" ADD COLUMN "recording_id" INTEGER;
ALTER TABLE "calls" ADD COLUMN "recording_size" INTEGER;
ALTER TABLE "pbx" ADD COLUMN "rec_cursor_id" INTEGER;
CREATE INDEX "calls_company_id_recording_id_idx" ON "calls"("company_id", "recording_id");
