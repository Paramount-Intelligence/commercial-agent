-- AlterTable: brute-force guard — count wrong OTP attempts, force-consume at cap
ALTER TABLE "EmailVerification" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
