-- Acesso de emergência ao painel (senha Argon2id + TOTP)
CREATE TABLE "emergency_admin" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_enc" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_totp_step" INTEGER,
    "last_login_at" TIMESTAMP(3),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_admin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "emergency_admin_username_key" ON "emergency_admin"("username");
