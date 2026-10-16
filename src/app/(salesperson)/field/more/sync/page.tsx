'use client';

import React, { useState } from 'react';
import { useField } from '@/features/field/FieldProvider';
import BackHeader from '@/components/sales/BackHeader';
import { Card, EmptyState, Notice, PrimaryButton, StatusPill } from '@/components/sales/mobile';
import { formatDateTime } from '@/lib/client/format';

export default function SyncQueue() {
  const { outbox, syncNow, syncing, discardOutboxItem, online, tracking } = useField();
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setResult(null);
    const r = await syncNow(true);
    setResult(r.networkError ? 'Server unreachable — records stay safely queued on this device.' : `Synced ${r.synced}${r.failed ? `, ${r.failed} still need attention` : ''}.`);
  };

  return (
    <div className="space-y-3">
      <BackHeader title="Offline sync queue" />
      <p className="text-xs text-[#586570]">Records created without a connection are stored on this device and sent automatically when you are back online.</p>
      <PrimaryButton onClick={run} loading={syncing} disabled={!outbox.length}>{online ? 'Sync now' : 'Sync now (offline)'}</PrimaryButton>
      {result && <Notice tone="info">{result}</Notice>}
      {tracking.buffered > 0 && <Notice tone="info">{tracking.buffered} GPS point(s) buffered — uploaded separately while you are on duty.</Notice>}
      {outbox.length === 0 ? (
        <EmptyState title="Everything is synced" />
      ) : (
        <ul className="space-y-2">
          {outbox.map((i) => (
            <li key={i.id}>
              <Card className="p-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{i.label}</p>
                    <p className="text-[11px] text-[#80909D]">Queued {formatDateTime(i.createdAt)}{i.retryCount ? ` · ${i.retryCount} attempt(s)` : ''}</p>
                  </div>
                  <StatusPill status={i.status} />
                </div>
                {i.status === 'FAILED' && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-[#991B1B]">Server response: {i.lastError}</p>
                    <button
                      className="text-xs font-semibold text-[#991B1B] underline"
                      onClick={() => {
                        if (window.confirm('Discard this record? It will be permanently removed from this device and never reach the server.')) discardOutboxItem(i.id);
                      }}
                    >
                      Discard record
                    </button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
