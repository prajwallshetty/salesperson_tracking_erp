-- Phase 2 (reviewed, additive only — no existing column, row or constraint is changed or dropped).
--  * users.tokenVersion: session tokens carry this value; incrementing it signs the user out
--    everywhere. Existing rows get 0, and tokens issued before this migration (no version claim)
--    are treated as version 0, so nobody is signed out by deploying it.
--    PostgreSQL >= 11 adds a column with a constant default without rewriting the table.
--  * uploaded_files: who uploaded each file, for per-record file authorization.
-- Rollback (only before any code depends on it): DROP TABLE "uploaded_files"; ALTER TABLE "users" DROP COLUMN "tokenVersion";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "uploaded_files" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_files_filename_key" ON "uploaded_files"("filename");

-- CreateIndex
CREATE INDEX "uploaded_files_uploadedById_idx" ON "uploaded_files"("uploadedById");

-- AddForeignKey
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

