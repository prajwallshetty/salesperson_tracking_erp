import { UserRole, OrderStatus, PaymentMethod, PaymentStatus, VisitOutcome, AttendanceStatus, SyncStatus } from './constants';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  status: string;
  salespersonId?: string;
  employeeCode?: string;
  territory?: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  expiresIn: string;
}

export interface SalespersonProfile {
  id: string;
  userId: string;
  employeeCode: string;
  name: string;
  email: string;
  phone: string;
  territory: string;
  status: string;
  deviceId?: string | null;
  lastActiveAt?: string | null;
  currentSessionId?: string | null;
}

export interface ClientDTO {
  id: string;
  name: string;
  businessName?: string | null;
  contactPerson: string;
  phone: string;
  email?: string | null;
  gstNumber?: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  category: string;
  creditLimit: number;
  paymentTerms: string;
  status: string;
  notes?: string | null;
  openingBalance: number;
  currentOutstanding: number;
  distanceMeters?: number;
  isAssigned?: boolean;
}

export interface ProductDTO {
  id: string;
  sku: string;
  barcode?: string | null;
  name: string;
  categoryId: string;
  categoryName?: string;
  brand: string;
  description?: string | null;
  unit: string;
  sellingPrice: number;
  mrp: number;
  taxRate: number;
  discount: number;
  stock: number;
  minimumStock: number;
  image?: string | null;
  status: string;
}

export interface OrderItemInputDTO {
  productId: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  taxRate?: number;
}

export interface CreateOrderDTO {
  clientId: string;
  items: OrderItemInputDTO[];
  discount?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
  idempotencyKey?: string;
}

export interface CreatePaymentDTO {
  clientId: string;
  orderId?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  transactionReference?: string;
  proofUrl?: string;
  notes?: string;
  collectedAt?: string;
  idempotencyKey?: string;
}

export interface StartAttendanceDTO {
  latitude?: number;
  longitude?: number;
  deviceId?: string;
  idempotencyKey?: string;
}

export interface EndAttendanceDTO {
  latitude?: number;
  longitude?: number;
}

export interface LocationPointDTO {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  batteryLevel?: number | null;
  networkType?: string | null;
  deviceId?: string | null;
  timestamp: string;
}

export interface LocationBatchDTO {
  sessionId?: string;
  points: LocationPointDTO[];
}

export interface StartVisitDTO {
  clientId: string;
  latitude: number;
  longitude: number;
  notes?: string;
  isException?: boolean;
  exceptionReason?: string;
  idempotencyKey?: string;
}

export interface EndVisitDTO {
  outcome: VisitOutcome;
  notes?: string;
  photoUrl?: string;
  signatureUrl?: string;
  voiceNoteUrl?: string;
}

export interface DailySummaryDTO {
  workingTimeMinutes: number;
  workingTimeFormatted: string;
  distanceKm: number;
  clientsVisited: number;
  ordersCount: number;
  totalSales: number;
  verifiedCollections: number;
  pendingCollections: number;
}

export interface SyncQueueItem {
  id: string;
  type: 'ORDER' | 'VISIT_START' | 'VISIT_END' | 'PAYMENT' | 'GPS_BATCH' | 'START_DAY' | 'END_DAY' | 'EXPENSE';
  payload: any;
  status: SyncStatus;
  retryCount: number;
  lastError?: string;
  createdAt: string;
  idempotencyKey: string;
}

// ==================== EXPENSE TYPES ====================
export interface ExpenseDTO {
  id: string;
  expenseNumber: string;
  salespersonId: string;
  salespersonName?: string;
  salespersonCode?: string;
  category: string;
  amount: number;
  currency: string;
  expenseDate: string;
  description: string;
  businessPurpose?: string | null;
  merchantName?: string | null;
  paymentMethod: string;
  receiptUrl?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  visitId?: string | null;
  attendanceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: string;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  approvedByName?: string | null;
  rejectedAt?: string | null;
  rejectedByName?: string | null;
  reimbursedAt?: string | null;
  reimbursedByName?: string | null;
  reimbursementRef?: string | null;
  reimbursementMethod?: string | null;
  offlineId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpenseDTO {
  category: string;
  amount: number;
  expenseDate: string;
  description: string;
  businessPurpose?: string;
  merchantName?: string;
  paymentMethod?: string;
  receiptUrl?: string;
  clientId?: string | null;
  visitId?: string | null;
  attendanceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: 'DRAFT' | 'SUBMITTED';
  offlineId?: string;
}

export interface UpdateExpenseDTO {
  category?: string;
  amount?: number;
  expenseDate?: string;
  description?: string;
  businessPurpose?: string;
  merchantName?: string;
  paymentMethod?: string;
  receiptUrl?: string;
}

export interface ApproveExpenseDTO {
  comment?: string;
}

export interface RejectExpenseDTO {
  rejectionReason: string;
}

export interface ReimburseExpenseDTO {
  reimbursementRef: string;
  reimbursementMethod: string;
  comment?: string;
}

// ==================== ACCESS CODE TYPES ====================
export interface AccessCodeLoginDTO {
  identifier: string; // Employee ID or Phone Number
  accessCode: string;
  deviceId?: string;
}

export interface UserAccessCodeDTO {
  id: string;
  userId: string;
  userName: string;
  employeeCode?: string;
  displayHint?: string | null;
  status: string;
  expiresAt?: string | null;
  failedAttempts: number;
  lockedUntil?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
}

// ==================== REAL-TIME SOCKET TYPES ====================
export interface SocketEventPayload<T = any> {
  eventId: string;
  version: number;
  timestamp: string;
  type: string;
  data: T;
}
