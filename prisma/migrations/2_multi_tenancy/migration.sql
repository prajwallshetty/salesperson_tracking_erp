-- Multi-tenancy (reviewed). Data-preserving: nothing is deleted or rewritten.
--
--  1. New table "tenants" and one row for the default tenant.
--  2. "tenantId" on the 18 tables that hold company data. ADD COLUMN ... NOT NULL DEFAULT <constant> is a
--     metadata-only change on PostgreSQL >= 11: every existing row is assigned to the default tenant
--     without a table rewrite. The default is kept so the pre-tenancy code (rollback) can still insert rows;
--     the application always sets tenantId explicitly (src/lib/db/tenancy.ts), it never relies on the default.
--  3. Global unique keys become per-company unique keys (email, phone, employeeCode, sku, barcode, category
--     name, document numbers, offlineId, clientPointId, idempotency key, setting key). Every existing row is in
--     the single default tenant, so no existing data can violate the new, weaker constraints.
--  4. Foreign keys tenantId -> tenants(id) (ON DELETE RESTRICT) and an index per table.
--
-- Rollback (only if no second tenant exists yet and no code depends on it): restore the old unique indexes
-- (see 0_init) and DROP the tenantId columns and "tenants" table. Do not run `prisma db push` from older code.

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- DropIndex
DROP INDEX "categories_name_key";

-- DropIndex
DROP INDEX "expenses_expenseNumber_key";

-- DropIndex
DROP INDEX "expenses_offlineId_key";

-- DropIndex
DROP INDEX "idempotency_keys_key_key";

-- DropIndex
DROP INDEX "location_points_clientPointId_key";

-- DropIndex
DROP INDEX "orders_orderNumber_key";

-- DropIndex
DROP INDEX "payments_receiptNumber_key";

-- DropIndex
DROP INDEX "products_barcode_key";

-- DropIndex
DROP INDEX "products_sku_key";

-- DropIndex
DROP INDEX "salespersons_employeeCode_key";

-- DropIndex
DROP INDEX "system_settings_key_key";

-- DropIndex
DROP INDEX "users_email_key";

-- DropIndex
DROP INDEX "users_phone_key";

-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "client_visits" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "idempotency_keys" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "location_points" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "location_sessions" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "salespersons" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "uploaded_files" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "user_access_codes" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- Existing single-company data becomes the default tenant (fixed id so every ADD COLUMN default below
-- points at it). Rename it with `npm run tenant -- rename default "Your Company"` after deploying.
INSERT INTO "tenants" ("id", "slug", "name", "status", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'Default company', 'ACTIVE', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- CreateIndex
CREATE INDEX "attendance_tenantId_idx" ON "attendance"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "categories_tenantId_idx" ON "categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenantId_name_key" ON "categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "client_visits_tenantId_idx" ON "client_visits"("tenantId");

-- CreateIndex
CREATE INDEX "clients_tenantId_idx" ON "clients"("tenantId");

-- CreateIndex
CREATE INDEX "expenses_tenantId_idx" ON "expenses"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenantId_expenseNumber_key" ON "expenses"("tenantId", "expenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenantId_offlineId_key" ON "expenses"("tenantId", "offlineId");

-- CreateIndex
CREATE INDEX "idempotency_keys_tenantId_idx" ON "idempotency_keys"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenantId_key_key" ON "idempotency_keys"("tenantId", "key");

-- CreateIndex
CREATE INDEX "location_points_tenantId_idx" ON "location_points"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "location_points_tenantId_clientPointId_key" ON "location_points"("tenantId", "clientPointId");

-- CreateIndex
CREATE INDEX "location_sessions_tenantId_idx" ON "location_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");

-- CreateIndex
CREATE INDEX "orders_tenantId_idx" ON "orders"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_orderNumber_key" ON "orders"("tenantId", "orderNumber");

-- CreateIndex
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_receiptNumber_key" ON "payments"("tenantId", "receiptNumber");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_sku_key" ON "products"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_barcode_key" ON "products"("tenantId", "barcode");

-- CreateIndex
CREATE INDEX "salespersons_tenantId_idx" ON "salespersons"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "salespersons_tenantId_employeeCode_key" ON "salespersons"("tenantId", "employeeCode");

-- CreateIndex
CREATE INDEX "system_settings_tenantId_idx" ON "system_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_tenantId_key_key" ON "system_settings"("tenantId", "key");

-- CreateIndex
CREATE INDEX "uploaded_files_tenantId_idx" ON "uploaded_files"("tenantId");

-- CreateIndex
CREATE INDEX "user_access_codes_tenantId_idx" ON "user_access_codes"("tenantId");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_phone_key" ON "users"("tenantId", "phone");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salespersons" ADD CONSTRAINT "salespersons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_sessions" ADD CONSTRAINT "location_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_visits" ADD CONSTRAINT "client_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_codes" ADD CONSTRAINT "user_access_codes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

