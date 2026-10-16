# SalesGrid — REST API Reference

The API is served by the unified SalesGrid application on the **same origin** as the UI
(e.g. `https://salesgrid.example.com/api/...`). Request and response contracts are unchanged from the
legacy Express API (`:4000/api`), so existing API clients only need their base URL updated.

- **OpenAPI / Swagger UI**: `/api/docs` (spec at `/api/docs/spec.json`)
- **Authentication**: either `Authorization: Bearer <jwt>` (token returned by `/api/auth/login`), or the
  httpOnly `sg_session` cookie that the same endpoint sets for browsers.
- **Authorization** is enforced server-side on every request (role, manager team, manager permission
  flags, record ownership). See `docs/MIGRATION_AUDIT.md` §4 for scope fixes relative to the legacy API.
- **Errors**: `{ "error": string }`, or `{ "error": "Validation failed", "details": [{ field, message }] }` (HTTP 400).

Additions in the unified app (all additive): `POST /api/auth/refresh`, `range=all_time` on
performance, `search` on `/api/expenses`, `assignedAt` on client list rows, `distanceFromClient` /
`isException` on route-history visit events, `minutesSinceUpdate` on live status.

---

## 1. Authentication (`/api/auth`)

### 1.1 Login
- **Endpoint**: `POST /api/auth/login`
- **Access**: Public
- **Request Body**:
```json
{
  "identifier": "admin@erp.com", // Email, Phone, or Employee Code
  "password": "Password123!"
}
```
- **Response `200 OK`**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsIn...",
  "user": {
    "id": "uuid",
    "name": "Vikram Mehta",
    "email": "admin@erp.com",
    "phone": "9876543210",
    "role": "SUPER_ADMIN",
    "status": "ACTIVE",
    "salespersonId": "uuid" // Present for salespersons
  },
  "expiresIn": "7d"
}
```

### 1.2 Get Current User
- **Endpoint**: `GET /api/auth/me`
- **Access**: Authenticated

### 1.3 Logout
- **Endpoint**: `POST /api/auth/logout`
- **Access**: Authenticated

---

## 2. Dashboard (`/api/dashboard`)

### 2.1 Executive Summary
- **Endpoint**: `GET /api/dashboard/summary`
- **Access**: Admin, Manager
- **Response `200 OK`**:
```json
{
  "kpis": {
    "totalSalespersons": 3,
    "activeSalespersons": 2,
    "totalClients": 5,
    "todayOrdersCount": 3,
    "todaySales": 23445,
    "todayVerifiedCollections": 30000,
    "todayPendingCollections": 5000,
    "todayTotalCollections": 35000,
    "totalOutstanding": 208737
  },
  "charts": {
    "salesByDay": [{ "date": "2026-09-29", "amount": 23445 }],
    "collectionsByDay": [{ "date": "2026-09-29", "amount": 30000 }],
    "topProducts": [{ "name": "Samsung 25W Fast Charger", "quantity": 30, "total": 15591.07 }],
    "salespersonPerformance": [{ "id": "uuid", "name": "Rahul Sharma", "sales": 23445, "collections": 30000 }]
  }
}
```

---

## 3. Salespersons & Field Operations (`/api/salespersons`)

### 3.1 List Salespersons
- **Endpoint**: `GET /api/salespersons`
- **Query Params**: `page`, `limit`, `search`, `status`
- **Access**: Admin, Manager

### 3.2 Live Duty Status
- **Endpoint**: `GET /api/salespersons/live-status`
- **Access**: Admin, Manager
- **Description**: Returns all salespersons with real-time duty state, battery level, speed, and relative last update time.

### 3.3 Salesperson Mobile Dashboard
- **Endpoint**: `GET /api/salespersons/dashboard`
- **Access**: Salesperson (Scoped to self)
- **Response**: Today's sales, orders count, verified collections, pending collections, visited clients ratio, duty status.

---

## 4. Location & Tracking (`/api/location`)

### 4.1 Ingest Location Breadcrumb
- **Endpoint**: `POST /api/location/update`
- **Access**: Salesperson (Active duty required)
- **Request Body**:
```json
{
  "latitude": 12.8680,
  "longitude": 74.8510,
  "accuracy": 12.0,
  "speed": 15.5,
  "batteryLevel": 85,
  "heading": 90.0,
  "networkType": "4G",
  "timestamp": "2026-09-29T10:30:00Z"
}
```

### 4.2 Current Real-time Positions (Live Map)
- **Endpoint**: `GET /api/location/current`
- **Access**: Admin, Manager
- **Response**: Array of active salespersons, latest coordinates, and assigned clients with locations.

### 4.3 Route History & Events
- **Endpoint**: `GET /api/location/history`
- **Query Params**: `salespersonId` (required), `date` (YYYY-MM-DD, required)
- **Response**: Array of timestamped GPS coordinates, estimated distance (KM), and overlaid events (visits, orders, collections).

---

## 5. Attendance (`/api/attendance`)

### 5.1 Start Day
- **Endpoint**: `POST /api/attendance/start`
- **Request Body**:
```json
{
  "latitude": 12.8700,
  "longitude": 74.8420,
  "idempotencyKey": "att-start-12345"
}
```

### 5.2 End Day
- **Endpoint**: `POST /api/attendance/end`
- **Request Body**:
```json
{
  "latitude": 12.8680,
  "longitude": 74.8510,
  "idempotencyKey": "att-end-12345"
}
```
- **Response**: Complete daily summary (Working hours, distance travelled, orders, sales, verified collections).

---

## 6. Clients & Visits (`/api/clients`, `/api/visits`)

### 6.1 List Clients
- **Endpoint**: `GET /api/clients`
- **Query Params**: `search`, `territory`, `category`, `pendingOnly`
- **Data Scoping**: Salespersons receive only their assigned clients.

### 6.2 Start Client Visit
- **Endpoint**: `POST /api/visits/start`
- **Request Body**:
```json
{
  "clientId": "uuid",
  "latitude": 12.8715,
  "longitude": 74.8432,
  "idempotencyKey": "visit-start-uuid"
}
```
- **Response**: Audit record showing calculated distance from client's registered coordinates and `isRadiusBreach` flag (if $> 100\text{m}$).

### 6.3 End Client Visit
- **Endpoint**: `POST /api/visits/end`
- **Request Body**:
```json
{
  "visitId": "uuid",
  "outcome": "ORDER_TAKEN", // ORDER_TAKEN, PAYMENT_COLLECTED, FOLLOW_UP_REQUIRED, NO_ORDER, CLIENT_CLOSED, OTHER
  "notes": "Discussed bulk Diwali festive stock orders.",
  "exceptionReason": "Client moved to showroom annex across the street." // Required if out-of-radius
}
```

---

## 7. Product Catalog (`/api/products`)

### 7.1 List Products
- **Endpoint**: `GET /api/products`
- **Query Params**: `search` (matches SKU, name, or barcode), `categoryId`, `inStockOnly`

---

## 8. Orders (`/api/orders`)

### 8.1 Create Purchase Order
- **Endpoint**: `POST /api/orders`
- **Request Body**:
```json
{
  "clientId": "uuid",
  "items": [
    { "productId": "uuid1", "quantity": 10 },
    { "productId": "uuid2", "quantity": 5 },
    { "productId": "uuid3", "quantity": 2 }
  ],
  "discount": 450,
  "notes": "Deliver by tomorrow evening.",
  "latitude": 12.8714,
  "longitude": 74.8431,
  "idempotencyKey": "order-create-uuid"
}
```
- **Calculation Compliance**: Recomputed on server with exact minor-unit GST arithmetic.

### 8.2 Transition Order Status
- **Endpoint**: `PATCH /api/orders/:id/status`
- **Request Body**:
```json
{
  "status": "CONFIRMED", // DRAFT, SUBMITTED, CONFIRMED, PROCESSING, DISPATCHED, DELIVERED, CANCELLED, REJECTED
  "notes": "Approved by manager"
}
```

---

## 9. Payments & Ledger (`/api/payments`)

### 9.1 Collect Payment in Field
- **Endpoint**: `POST /api/payments`
- **Request Body**:
```json
{
  "clientId": "uuid",
  "orderId": "uuid", // Optional
  "amount": 20000,
  "paymentMethod": "UPI", // CASH, UPI, BANK_TRANSFER, CHEQUE, CARD, OTHER
  "transactionReference": "UPI/2026/987123",
  "notes": "Received payment via GPay QR",
  "idempotencyKey": "pay-uuid"
}
```
- **Response**: Creates provisional collection with receipt number (e.g. `PAY-2026-00045`) in `PENDING` status.

### 9.2 Verify Payment
- **Endpoint**: `POST /api/payments/:id/verify`
- **Access**: Super Admin, Manager
- **Request Body**:
```json
{
  "status": "VERIFIED", // VERIFIED or REJECTED
  "rejectionReason": ""
}
```
- **Ledger Impact**: When set to `VERIFIED`, automatically creates an immutable `CREDIT` entry in `ClientLedgerEntry` and deducts the amount from `Client.currentOutstanding`.

### 9.3 Download PDF Receipt
- **Endpoint**: `GET /api/payments/:id/receipt-pdf`
- **Access**: Authenticated
- **Response**: Binary streaming PDF document (`application/pdf`) formatted with company branding, tax registration, client ledger balance, and verification seal.

---

## 10. Reports & Exports (`/api/reports`)

- **Sales Report**: `GET /api/reports/sales` (JSON or `format=csv`)
- **Collections Report**: `GET /api/reports/collections` (JSON or `format=csv`)
- **Attendance Report**: `GET /api/reports/attendance` (JSON or `format=csv`)
- **Visits Report**: `GET /api/reports/visits` (JSON or `format=csv`)
- **Product Sales Report**: `GET /api/reports/products` (JSON or `format=csv`)

---

## 11. Offline Batch Synchronization (`/api/sync`)

### 11.1 Sync Batch Operations
- **Endpoint**: `POST /api/sync/batch`
- **Request Body**:
```json
{
  "items": [
    {
      "localId": "loc-ord-1",
      "action": "CREATE_ORDER",
      "payload": { "clientId": "uuid", "items": [...] },
      "idempotencyKey": "idemp-1"
    },
    {
      "localId": "loc-pay-1",
      "action": "RECORD_PAYMENT",
      "payload": { "clientId": "uuid", "amount": 5000, "paymentMethod": "CASH" },
      "idempotencyKey": "idemp-2"
    }
  ]
}
```
- **Response**: Map of processed operations with `localId`, `serverId`, `status` (`SYNCED` or `FAILED`), and error details if rejected.
