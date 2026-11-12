-- Ajustes de permissão podem negar (allowed=false), não só conceder
ALTER TABLE "permission_grant" ADD COLUMN "allowed" BOOLEAN NOT NULL DEFAULT true;
