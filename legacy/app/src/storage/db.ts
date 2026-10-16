import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncQueueItem, SyncStatus } from '../shared';

const STORAGE_KEYS = {
  OUTBOX_QUEUE: '@erp_outbox_queue',
  AUTH_TOKEN: '@erp_auth_token',
  USER_PROFILE: '@erp_user_profile',
  DUTY_STATUS: '@erp_duty_status',
  CACHED_CLIENTS: '@erp_cached_clients',
  CACHED_PRODUCTS: '@erp_cached_products',
  LAST_KNOWN_LOCATION: '@erp_last_location',
};

// 1. Outbox Queue Management (Section 28)
export async function getOutboxQueue(): Promise<SyncQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOX_QUEUE);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to get outbox queue:', e);
    return [];
  }
}

export async function enqueueOperation(
  type: SyncQueueItem['type'],
  payload: any,
  idempotencyKey?: string
): Promise<SyncQueueItem> {
  const item: SyncQueueItem = {
    id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type,
    payload,
    status: 'PENDING',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    idempotencyKey: idempotencyKey || `mobile-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
  };

  const queue = await getOutboxQueue();
  queue.push(item);
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOX_QUEUE, JSON.stringify(queue));
  return item;
}

export async function updateQueueItem(
  localId: string,
  update: { status: SyncStatus; serverId?: string; lastError?: string; retryCount?: number }
): Promise<void> {
  const queue = await getOutboxQueue();
  const index = queue.findIndex((q) => q.id === localId);
  if (index !== -1) {
    queue[index] = { ...queue[index], ...update };
    await AsyncStorage.setItem(STORAGE_KEYS.OUTBOX_QUEUE, JSON.stringify(queue));
  }
}

export async function removeQueueItem(localId: string): Promise<void> {
  const queue = await getOutboxQueue();
  const filtered = queue.filter((q) => q.id !== localId);
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOX_QUEUE, JSON.stringify(filtered));
}

// 2. Master Data Caching (Section 27)
export async function cacheClients(clients: any[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.CACHED_CLIENTS, JSON.stringify(clients));
}

export async function getCachedClients(): Promise<any[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_CLIENTS);
  return raw ? JSON.parse(raw) : [];
}

export async function cacheProducts(products: any[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.CACHED_PRODUCTS, JSON.stringify(products));
}

export async function getCachedProducts(): Promise<any[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_PRODUCTS);
  return raw ? JSON.parse(raw) : [];
}

// 3. User Session & Isolation Protection (Section 25)
export async function clearUserSessionData(): Promise<void> {
  // Clear cached data so another logged-in user never sees former user's data
  await AsyncStorage.multiRemove([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.USER_PROFILE,
    STORAGE_KEYS.DUTY_STATUS,
    STORAGE_KEYS.CACHED_CLIENTS,
    STORAGE_KEYS.CACHED_PRODUCTS,
    STORAGE_KEYS.LAST_KNOWN_LOCATION,
  ]);
}
