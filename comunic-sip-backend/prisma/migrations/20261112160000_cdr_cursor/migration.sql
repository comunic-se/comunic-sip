-- Marcador da coleta incremental (a lista do PBX "anda" enquanto paginamos)
ALTER TABLE "pbx" ADD COLUMN "cdr_cursor_at" TIMESTAMP(3);

-- Minimização de dados (LGPD): o PBX pode ser compartilhado por vários clientes;
-- só guardamos chamadas de empresas cadastradas. Remove o que entrou sem empresa.
-- (Os dados continuam no PBX; nada de quem usa o Comunic.SIP é perdido.)
DELETE FROM "calls" WHERE "company_id" IS NULL;

-- Refaz o histórico inicial com a regra nova (volta a buscar até CDR_BACKFILL_DAYS)
UPDATE "pbx" SET "cdr_synced_at" = NULL;
