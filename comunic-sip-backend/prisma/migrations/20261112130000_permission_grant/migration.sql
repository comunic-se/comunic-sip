-- Permissões extras concedidas por usuário (dentro da empresa)
CREATE TABLE "permission_grant" (
    "company_id" TEXT NOT NULL,
    "helena_user_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_grant_pkey" PRIMARY KEY ("company_id","helena_user_id","permission")
);
