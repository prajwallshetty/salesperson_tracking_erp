import AsyncStorage from '@react-native-async-storage/async-storage';
import { config, sanitizeUrl } from '../config';
import {
  getOutboxQueue,
  updateQueueItem,
  removeQueueItem,
  enqueueOperation,
  cacheClients,
  cacheProducts,
  getCachedClients,
  getCachedProducts,
} from '../storage/db';

export async function getAuthToken(): Promise<string | null> {
  return await AsyncStorage.getItem('@erp_auth_token');
}

export async function pingApiServer(customUrl?: string): Promise<{ ok: boolean; message: string; version?: string; latencyMs?: number }> {
  const target = sanitizeUrl(customUrl) || config.apiBaseUrl;
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${target}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    const text = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
    if (res.ok) {
      return {
        ok: true,
        message: `Connected (${latencyMs}ms)`,
        version: json.version || 'v1.0.0',
        latencyMs,
      };
    } else {
      return {
        ok: false,
        message: `Server returned HTTP ${res.status}: ${json.error || json.message || res.statusText}`,
      };
    }
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return {
      ok: false,
      message: isTimeout ? 'Connection timed out (6s)' : (err.message || 'Unable to connect to server'),
    };
  }
}

export async function apiRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const baseUrl = config.apiBaseUrl;
  const url = `${baseUrl}${endpoint}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout
    const res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
    clearTimeout(timeout);

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text || `HTTP ${res.status} ${res.statusText}` };
    }

    if (!res.ok) {
      const errMsg = json.error || json.message || `HTTP error ${res.status} (${res.statusText})`;
      throw new Error(errMsg);
    }
    return json;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${endpoint} timed out. Please check server connectivity.`);
    }
    // Propagate network/auth error
    throw err;
  }
}

// Durable Outbox Synchronizer (Section 28)
export async function syncOutbox(): Promise<{ syncedCount: number; failedCount: number }> {
  const token = await getAuthToken();
  if (!token) return { syncedCount: 0, failedCount: 0 };

  const queue = await getOutboxQueue();
  const pendingItems = queue.filter((item) => item.status === 'PENDING' || item.status === 'FAILED');

  if (pendingItems.length === 0) {
    return { syncedCount: 0, failedCount: 0 };
  }

  // Mark items as SYNCING
  for (const item of pendingItems) {
    await updateQueueItem(item.id, { status: 'SYNCING' });
  }

  try {
    const batchPayload = {
      items: pendingItems.map((item) => ({
        localId: item.id,
        type: item.type,
        payload: item.payload,
        idempotencyKey: item.idempotencyKey,
      })),
    };

    const response = await apiRequest('/api/sync/batch', {
      method: 'POST',
      body: JSON.stringify(batchPayload),
    });

    let syncedCount = 0;
    let failedCount = 0;

    for (const result of response.results || []) {
      if (result.status === 'SYNCED') {
        await removeQueueItem(result.localId);
        syncedCount++;
      } else {
        const item = pendingItems.find((p) => p.id === result.localId);
        await updateQueueItem(result.localId, {
          status: 'FAILED',
          lastError: result.error,
          retryCount: (item?.retryCount || 0) + 1,
        });
        failedCount++;
      }
    }

    return { syncedCount, failedCount };
  } catch (err: any) {
    // Revert to PENDING with incremented retry count
    for (const item of pendingItems) {
      await updateQueueItem(item.id, {
        status: 'PENDING',
        lastError: err.message,
        retryCount: item.retryCount + 1,
      });
    }
    return { syncedCount: 0, failedCount: pendingItems.length };
  }
}
