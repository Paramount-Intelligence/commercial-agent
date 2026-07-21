-- AlterTable
ALTER TABLE "Message" ADD COLUMN "retrievedCaseIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
