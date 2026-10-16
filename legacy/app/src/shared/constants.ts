export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  MANAGER: 'MANAGER',
  SALESPERSON: 'SALESPERSON',
} as const;
export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export const ORDER_STATUSES = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  PROCESSING: 'PROCESSING',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;
export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

export const PAYMENT_METHODS = {
  CASH: 'CASH',
  UPI: 'UPI',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CHEQUE: 'CHEQUE',
  CARD: 'CARD',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

export const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

export const VISIT_OUTCOMES = {
  ORDER_TAKEN: 'ORDER_TAKEN',
  PAYMENT_COLLECTED: 'PAYMENT_COLLECTED',
  FOLLOW_UP_REQUIRED: 'FOLLOW_UP_REQUIRED',
  NO_ORDER: 'NO_ORDER',
  CLIENT_CLOSED: 'CLIENT_CLOSED',
  OTHER: 'OTHER',
} as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[keyof typeof VISIT_OUTCOMES];

export const ATTENDANCE_STATUSES = {
  ON_DUTY: 'ON_DUTY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[keyof typeof ATTENDANCE_STATUSES];

export const SYNC_STATUSES = {
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
} as const;
export type SyncStatus = (typeof SYNC_STATUSES)[keyof typeof SYNC_STATUSES];

export const EXPENSE_CATEGORIES = {
  AUTO_RICKSHAW: 'AUTO_RICKSHAW',
  BUS_TRAIN_METRO_TAXI: 'BUS_TRAIN_METRO_TAXI',
  FUEL: 'FUEL',
  FOOD_MEALS: 'FOOD_MEALS',
  ACCOMMODATION: 'ACCOMMODATION',
  PARKING_TOLLS: 'PARKING_TOLLS',
  OTHER: 'OTHER',
} as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[keyof typeof EXPENSE_CATEGORIES];

export const EXPENSE_STATUSES = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REIMBURSED: 'REIMBURSED',
} as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[keyof typeof EXPENSE_STATUSES];

export const ACCESS_CODE_STATUSES = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type AccessCodeStatus = (typeof ACCESS_CODE_STATUSES)[keyof typeof ACCESS_CODE_STATUSES];

export const SOCKET_EVENTS = {
  // Connection
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  AUTHENTICATE: 'authenticate',
  
  // Real-time events
  LOCATION_UPDATE: 'location:update',
  ATTENDANCE_CHANGED: 'attendance:changed',
  ORDER_CREATED: 'order:created',
  ORDER_STATUS_CHANGED: 'order:status_changed',
  PAYMENT_COLLECTED: 'payment:collected',
  PAYMENT_VERIFIED: 'payment:verified',
  CLIENT_ASSIGNED: 'client:assigned',
  EXPENSE_SUBMITTED: 'expense:submitted',
  EXPENSE_APPROVED: 'expense:approved',
  EXPENSE_REJECTED: 'expense:rejected',
  EXPENSE_REIMBURSED: 'expense:reimbursed',
  NOTIFICATION_NEW: 'notification:new',
} as const;

export const DEFAULT_CONFIG = {
  VISIT_RADIUS_METERS: 100,
  TRACKING_INTERVAL_SECONDS: 60,
  TIMEZONE: 'Asia/Kolkata',
  MANAGER_ORDER_APPROVAL_REQUIRED: false,
  CASH_VERIFICATION_REQUIRED: true,
  MAX_GPS_ACCURACY_METERS: 150,
} as const;
