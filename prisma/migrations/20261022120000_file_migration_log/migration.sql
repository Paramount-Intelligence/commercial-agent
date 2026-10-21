-- Private list of old stored files made obsolete by the file move, so they
-- can be deleted one by one later. Additive and idempotent.

CREATE TABLE IF NOT EXISTS "FileMigrationLog" (
    "id" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldUrl" TEXT NOT NULL,
    "newUrl" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oldDeletedAt" TIMESTAMP(3),
    CONSTRAINT "FileMigrationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FileMigrationLog_oldDeletedAt_idx" ON "FileMigrationLog"("oldDeletedAt");
CREATE INDEX IF NOT EXISTS "FileMigrationLog_tableName_recordId_idx" ON "FileMigrationLog"("tableName", "recordId");
