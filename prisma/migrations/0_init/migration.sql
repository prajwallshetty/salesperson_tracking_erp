-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'MANAGER', 'SALESPERSON');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SalespersonStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ON_DUTY', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('PRIMARY', 'BACKUP');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('ON_DUTY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('ORDER_TAKEN', 'PAYMENT_COLLECTED', 'FOLLOW_UP_REQUIRED', 'NO_ORDER', 'CLIENT_CLOSED', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('OPENING_BALANCE', 'INVOICE', 'PAYMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "AccessCodeStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('AUTO_RICKSHAW', 'BUS_TRAIN_METRO_TAXI', 'FUEL', 'FOOD_MEALS', 'ACCOMMODATION', 'PARKING_TOLLS', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SALESPERSON',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_salespersons" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_salespersons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canViewDashboard" BOOLEAN NOT NULL DEFAULT true,
    "canManageUsers" BOOLEAN NOT NULL DEFAULT false,
    "canManageProducts" BOOLEAN NOT NULL DEFAULT true,
    "canManageClients" BOOLEAN NOT NULL DEFAULT true,
    "canAssignClients" BOOLEAN NOT NULL DEFAULT true,
    "canViewGps" BOOLEAN NOT NULL DEFAULT true,
    "canViewOrders" BOOLEAN NOT NULL DEFAULT true,
    "canApproveOrders" BOOLEAN NOT NULL DEFAULT true,
    "canViewPayments" BOOLEAN NOT NULL DEFAULT true,
    "canVerifyPayments" BOOLEAN NOT NULL DEFAULT true,
    "canViewReports" BOOLEAN NOT NULL DEFAULT true,
    "canExportReports" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salespersons" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "joiningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "territory" TEXT NOT NULL,
    "status" "SalespersonStatus" NOT NULL DEFAULT 'OFF_DUTY',
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salespersons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT,
    "contactPerson" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "gstNumber" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentTerms" TEXT NOT NULL DEFAULT 'Net 30',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentOutstanding" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_assignments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "type" "AssignmentType" NOT NULL DEFAULT 'PRIMARY',
    "notes" TEXT,

    CONSTRAINT "client_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'General',
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "mrp" DECIMAL(10,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 18.0,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "minimumStock" INTEGER NOT NULL DEFAULT 5,
    "image" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "transactionReference" TEXT,
    "proofUrl" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_ledger_entries" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "entryType" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "runningBalance" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logoutAt" TIMESTAMP(3),
    "loginLatitude" DOUBLE PRECISION,
    "loginLongitude" DOUBLE PRECISION,
    "logoutLatitude" DOUBLE PRECISION,
    "logoutLongitude" DOUBLE PRECISION,
    "workingMinutes" INTEGER NOT NULL DEFAULT 0,
    "distanceTravelled" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'ON_DUTY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_sessions" (
    "id" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_points" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "batteryLevel" DOUBLE PRECISION,
    "networkType" TEXT,
    "deviceId" TEXT,
    "clientPointId" TEXT,
    "isFiltered" BOOLEAN NOT NULL DEFAULT false,
    "filterReason" TEXT,
    "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_visits" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distanceFromClient" DOUBLE PRECISION,
    "isException" BOOLEAN NOT NULL DEFAULT false,
    "exceptionReason" TEXT,
    "outcome" "VisitOutcome" NOT NULL DEFAULT 'FOLLOW_UP_REQUIRED',
    "notes" TEXT,
    "photoUrl" TEXT,
    "signatureUrl" TEXT,
    "voiceNoteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "recordId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ip" TEXT,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT,
    "role" "Role",
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "salespersonId" TEXT,
    "responseCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_access_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "displayHint" TEXT,
    "status" "AccessCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "expenseNumber" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "businessPurpose" TEXT,
    "merchantName" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "receiptUrl" TEXT,
    "clientId" TEXT,
    "visitId" TEXT,
    "attendanceId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "reimbursedAt" TIMESTAMP(3),
    "reimbursedBy" TEXT,
    "reimbursementRef" TEXT,
    "reimbursementMethod" TEXT,
    "offlineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_histories" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "previousStatus" "ExpenseStatus",
    "newStatus" "ExpenseStatus" NOT NULL,
    "comment" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "manager_salespersons_managerId_salespersonId_key" ON "manager_salespersons"("managerId", "salespersonId");

-- CreateIndex
CREATE UNIQUE INDEX "manager_permissions_userId_key" ON "manager_permissions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "salespersons_userId_key" ON "salespersons"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "salespersons_employeeCode_key" ON "salespersons"("employeeCode");

-- CreateIndex
CREATE INDEX "salespersons_employeeCode_idx" ON "salespersons"("employeeCode");

-- CreateIndex
CREATE INDEX "salespersons_status_idx" ON "salespersons"("status");

-- CreateIndex
CREATE INDEX "clients_city_idx" ON "clients"("city");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_phone_idx" ON "clients"("phone");

-- CreateIndex
CREATE INDEX "client_assignments_clientId_active_idx" ON "client_assignments"("clientId", "active");

-- CreateIndex
CREATE INDEX "client_assignments_salespersonId_active_idx" ON "client_assignments"("salespersonId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_orderNumber_idx" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_clientId_idx" ON "orders"("clientId");

-- CreateIndex
CREATE INDEX "orders_salespersonId_idx" ON "orders"("salespersonId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receiptNumber_key" ON "payments"("receiptNumber");

-- CreateIndex
CREATE INDEX "payments_receiptNumber_idx" ON "payments"("receiptNumber");

-- CreateIndex
CREATE INDEX "payments_clientId_idx" ON "payments"("clientId");

-- CreateIndex
CREATE INDEX "payments_salespersonId_idx" ON "payments"("salespersonId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_collectedAt_idx" ON "payments"("collectedAt");

-- CreateIndex
CREATE INDEX "client_ledger_entries_clientId_timestamp_idx" ON "client_ledger_entries"("clientId", "timestamp");

-- CreateIndex
CREATE INDEX "attendance_salespersonId_date_idx" ON "attendance"("salespersonId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_salespersonId_date_status_key" ON "attendance"("salespersonId", "date", "status");

-- CreateIndex
CREATE INDEX "location_sessions_salespersonId_status_idx" ON "location_sessions"("salespersonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "location_points_clientPointId_key" ON "location_points"("clientPointId");

-- CreateIndex
CREATE INDEX "location_points_salespersonId_timestamp_idx" ON "location_points"("salespersonId", "timestamp");

-- CreateIndex
CREATE INDEX "location_points_sessionId_timestamp_idx" ON "location_points"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "client_visits_clientId_startedAt_idx" ON "client_visits"("clientId", "startedAt");

-- CreateIndex
CREATE INDEX "client_visits_salespersonId_startedAt_idx" ON "client_visits"("salespersonId", "startedAt");

-- CreateIndex
CREATE INDEX "audit_logs_module_recordId_idx" ON "audit_logs"("module", "recordId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_recipientId_read_idx" ON "notifications"("recipientId", "read");

-- CreateIndex
CREATE INDEX "notifications_role_createdAt_idx" ON "notifications"("role", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_key_idx" ON "idempotency_keys"("key");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE INDEX "user_access_codes_userId_status_idx" ON "user_access_codes"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expenseNumber_key" ON "expenses"("expenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_offlineId_key" ON "expenses"("offlineId");

-- CreateIndex
CREATE INDEX "expenses_salespersonId_status_idx" ON "expenses"("salespersonId", "status");

-- CreateIndex
CREATE INDEX "expenses_expenseDate_idx" ON "expenses"("expenseDate");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expense_histories_expenseId_createdAt_idx" ON "expense_histories"("expenseId", "createdAt");

-- AddForeignKey
ALTER TABLE "manager_salespersons" ADD CONSTRAINT "manager_salespersons_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_salespersons" ADD CONSTRAINT "manager_salespersons_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_permissions" ADD CONSTRAINT "manager_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salespersons" ADD CONSTRAINT "salespersons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_ledger_entries" ADD CONSTRAINT "client_ledger_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_ledger_entries" ADD CONSTRAINT "client_ledger_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_ledger_entries" ADD CONSTRAINT "client_ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_sessions" ADD CONSTRAINT "location_sessions_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_sessions" ADD CONSTRAINT "location_sessions_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "location_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_visits" ADD CONSTRAINT "client_visits_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_visits" ADD CONSTRAINT "client_visits_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_codes" ADD CONSTRAINT "user_access_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespersons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "client_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reimbursedBy_fkey" FOREIGN KEY ("reimbursedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_histories" ADD CONSTRAINT "expense_histories_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

