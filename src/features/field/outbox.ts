'use client';

import { readJson, writeJson, newId } from './storage';

/**
 * Durable offline outbox (legacy Section 28). Operations are queued ONLY when the request could
 * not reach the server (network failure). Validation/permission errors are shown to the user
 * immediately and never queued — the legacy app queued every failure and reported success.
 */
export type OutboxType = 'START_DAY' | 'END_DAY' | 'VISIT_START' | 'VISIT_END' | 'ORDER' | 'PAYMENT' | 'GPS_BATCH' | 'EXPENSE';

export interface OutboxItem {
  id: string;
  type: OutboxType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  status: 'PENDING' | 'SYNCING' | 'FAILED';
  retryCount: number;
  lastError?: string;
  createdAt: string;
  /** Short human description for the queue UI, e.g. "Order for ABC Traders". */
  label: string;
}

const key = (userId: string) => `sg_outbox_${userId}`;

export function getOutbox(userId: string): OutboxItem[] {
  return readJson<OutboxItem[]>(key(userId), []);
}

function save(userId: string, items: OutboxItem[]) {
  writeJson(key(userId), items);
  window.dispatchEvent(new CustomEvent('sg-outbox-changed'));
}

export function enqueue(userId: string, type: OutboxType, payload: Record<string, unknown>, label: string, idempotencyKey = `${type.toLowerCase()}-${newId()}`): OutboxItem {
  const item: OutboxItem = { id: `local-${newId()}`, type, payload, idempotencyKey, status: 'PENDING', retryCount: 0, createdAt: new Date().toISOString(), label };
  save(userId, [...getOutbox(userId), item]);
  return item;
}

export function updateItems(userId: string, fn: (items: OutboxItem[]) => OutboxItem[]) {
  save(userId, fn(getOutbox(userId)));
}

export function removeItem(userId: string, id: string) {
  updateItems(userId, (items) => items.filter((i) => i.id !== id));
}

export interface SyncOutcome {
  synced: number;
  failed: number;
  networkError: boolean;
}

/**
 * Sends queued items in creation order. Items that the server rejects stay as FAILED (with the
 * server's reason) until the user retries or discards them; network failures leave items PENDING.
 */
export async function syncOutbox(userId: string, opts: { includeFailed?: boolean } = {}): Promise<SyncOutcome> {
  const items = getOutbox(userId).filter((i) => i.status === 'PENDING' || (opts.includeFailed && i.status === 'FAILED') || i.status === 'SYNCING');
  if (!items.length) return { synced: 0, failed: 0, networkError: false };
  const ids = new Set(items.map((i) => i.id));
  updateItems(userId, (all) => all.map((i) => (ids.has(i.id) ? { ...i, status: 'SYNCING' } : i)));

  let response: Response;
  try {
    response = await fetch('/api/sync/batch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((i) => ({ localId: i.id, type: i.type, payload: i.payload, idempotencyKey: i.idempotencyKey })) }),
    });
  } catch {
    updateItems(userId, (all) => all.map((i) => (ids.has(i.id) ? { ...i, status: 'PENDING' } : i)));
    return { synced: 0, failed: 0, networkError: true };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = body.error || `Server returned HTTP ${response.status}`;
    // 5xx: transient — keep pending. 4xx: the batch itself was refused.
    const status = response.status >= 500 ? 'PENDING' : 'FAILED';
    updateItems(userId, (all) => all.map((i) => (ids.has(i.id) ? { ...i, status, lastError: error, retryCount: i.retryCount + 1 } : i)));
    if (response.status === 401) window.location.assign('/login?expired=1&next=/field');
    return { synced: 0, failed: items.length, networkError: response.status >= 500 };
  }

  const { results = [] } = (await response.json()) as { results: { localId: string; status: string; error?: string }[] };
  const byId = new Map(results.map((r) => [r.localId, r]));
  let synced = 0;
  let failed = 0;
  updateItems(userId, (all) =>
    all.flatMap((i) => {
      if (!ids.has(i.id)) return [i];
      const r = byId.get(i.id);
      if (r?.status === 'SYNCED') {
        synced++;
        return [];
      }
      failed++;
      return [{ ...i, status: 'FAILED' as const, lastError: r?.error || 'Not processed by server', retryCount: i.retryCount + 1 }];
    })
  );
  return { synced, failed, networkError: false };
}
