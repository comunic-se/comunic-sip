-- Regras de acesso por usuário / grupo / função e grupos visíveis por pessoa.
CREATE TABLE "access_rule" (
    "company_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "access_rule_pkey" PRIMARY KEY ("company_id","subject_type","subject_id","permission")
);
CREATE INDEX "access_rule_company_id_subject_type_idx" ON "access_rule"("company_id", "subject_type");

CREATE TABLE "user_visibility" (
    "company_id" TEXT NOT NULL,
    "helena_user_id" TEXT NOT NULL,
    "department_ids" TEXT[],
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_visibility_pkey" PRIMARY KEY ("company_id","helena_user_id")
);

-- Os ajustes por pessoa que já existiam viram regras de usuário (mesmo efeito).
INSERT INTO "access_rule" ("company_id","subject_type","subject_id","permission","allowed","updated_by","updated_at")
SELECT "company_id", 'user', "helena_user_id", "permission", "allowed", "granted_by", "created_at" FROM "permission_grant";

DROP TABLE "permission_grant";
