-- Adviser-admin portal auth: AdviserAdmin + AdviserAdminSession.
-- Additive only. The existing website "Admin" model is NOT touched.

-- CreateTable: AdviserAdmin
CREATE TABLE "AdviserAdmin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdviserAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdviserAdmin_email_key" ON "AdviserAdmin"("email");

-- CreateTable: AdviserAdminSession
CREATE TABLE "AdviserAdminSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdviserAdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdviserAdminSession_token_key" ON "AdviserAdminSession"("token");

-- CreateIndex
CREATE INDEX "AdviserAdminSession_adminId_idx" ON "AdviserAdminSession"("adminId");

-- CreateIndex
CREATE INDEX "AdviserAdminSession_token_idx" ON "AdviserAdminSession"("token");

-- AddForeignKey
ALTER TABLE "AdviserAdminSession" ADD CONSTRAINT "AdviserAdminSession_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "AdviserAdmin"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
