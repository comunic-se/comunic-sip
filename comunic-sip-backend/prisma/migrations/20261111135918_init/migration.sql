-- CreateTable
CREATE TABLE "pbx" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "client_id_enc" TEXT,
    "client_secret_enc" TEXT,
    "sdk_access_id" TEXT NOT NULL,
    "sdk_access_key_enc" TEXT NOT NULL,
    "sn" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pbx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pbx_id" TEXT NOT NULL,
    "helena_api_token_enc" TEXT,
    "partner_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_range" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "from_ext" TEXT NOT NULL,
    "to_ext" TEXT NOT NULL,

    CONSTRAINT "extension_range_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_link" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "helena_user_id" TEXT NOT NULL,
    "extension_number" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extension_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "did_route" (
    "id" TEXT NOT NULL,
    "pbx_id" TEXT NOT NULL,
    "did_number" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "did_route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "pbx_id" TEXT,
    "company_id" TEXT,
    "uid" TEXT,
    "call_id" TEXT,
    "started_at" TIMESTAMP(3),
    "direction" TEXT,
    "status" TEXT,
    "from_number" TEXT,
    "to_number" TEXT,
    "extension_number" TEXT,
    "helena_user_id" TEXT,
    "department_ids" TEXT[],
    "contact_id" TEXT,
    "call_duration" INTEGER,
    "talk_duration" INTEGER,
    "recording_file" TEXT,
    "trunk" TEXT,
    "did" TEXT,
    "raw" JSONB,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts_cache" (
    "company_id" TEXT NOT NULL,
    "helena_contact_id" TEXT NOT NULL,
    "name" TEXT,
    "phone_e164" TEXT,
    "email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_cache_pkey" PRIMARY KEY ("company_id","helena_contact_id")
);

-- CreateTable
CREATE TABLE "platform_role" (
    "id" TEXT NOT NULL,
    "helena_user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "partner_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_override" (
    "company_id" TEXT NOT NULL,
    "helena_user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "role_override_pkey" PRIMARY KEY ("company_id","helena_user_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_partner_id_idx" ON "company"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "extension_link_company_id_helena_user_id_key" ON "extension_link"("company_id", "helena_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "extension_link_company_id_extension_number_key" ON "extension_link"("company_id", "extension_number");

-- CreateIndex
CREATE UNIQUE INDEX "did_route_pbx_id_did_number_key" ON "did_route"("pbx_id", "did_number");

-- CreateIndex
CREATE INDEX "calls_company_id_started_at_idx" ON "calls"("company_id", "started_at");

-- CreateIndex
CREATE INDEX "calls_company_id_helena_user_id_idx" ON "calls"("company_id", "helena_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_role_helena_user_id_role_partner_id_key" ON "platform_role"("helena_user_id", "role", "partner_id");

-- CreateIndex
CREATE INDEX "audit_log_company_id_at_idx" ON "audit_log"("company_id", "at");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_pbx_id_fkey" FOREIGN KEY ("pbx_id") REFERENCES "pbx"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_range" ADD CONSTRAINT "extension_range_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_link" ADD CONSTRAINT "extension_link_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
