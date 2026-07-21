-- GATING Slice 1: org → user → session model. Additive only — no drops, no type
-- changes. Existing rows (AgentUser/Conversation/Message) untouched; new AgentUser
-- columns are nullable or defaulted.

-- CreateTable: Organization
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "dailyMsgLimit" INTEGER NOT NULL DEFAULT 1000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_email_key" ON "Organization"("email");

-- AlterTable: AgentUser — profile fields + org FK (all nullable/defaulted, additive)
ALTER TABLE "AgentUser" ADD COLUMN "name" TEXT;
ALTER TABLE "AgentUser" ADD COLUMN "affiliation" TEXT;
ALTER TABLE "AgentUser" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentUser" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "AgentUser_organizationId_idx" ON "AgentUser"("organizationId");

-- AddForeignKey
ALTER TABLE "AgentUser" ADD CONSTRAINT "AgentUser_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: EmailVerification
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailVerification_agentUserId_idx" ON "EmailVerification"("agentUserId");

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_agentUserId_fkey"
    FOREIGN KEY ("agentUserId") REFERENCES "AgentUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Session
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_agentUserId_idx" ON "Session"("agentUserId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_agentUserId_fkey"
    FOREIGN KEY ("agentUserId") REFERENCES "AgentUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: OrgUsageDay
CREATE TABLE "OrgUsageDay" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "llmTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgUsageDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgUsageDay_day_organizationId_key" ON "OrgUsageDay"("day", "organizationId");

-- CreateIndex
CREATE INDEX "OrgUsageDay_organizationId_idx" ON "OrgUsageDay"("organizationId");

-- CreateIndex: Conversation.userId (audit flagged missing)
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");
