'use client';

import React, { useCallback, useEffect, useState } from 'react';
import BackHeader from '@/components/sales/BackHeader';
import { Card, EmptyState, Notice, SkeletonList } from '@/components/sales/mobile';
import { apiFetch, apiJson, errorMessage } from '@/lib/client/apiFetch';
import { useSocket } from '@/components/shared/RealtimeProvider';
import { formatDateTime } from '@/lib/client/format';

export default function Notifications() {
  const { lastEvent } = useSocket();
  const [data, setData] = useState<{ unreadCount: number; data: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiJson<{ unreadCount: number; data: any[] }>('/api/notifications')
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load, lastEvent]);

  const markAll = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'PUT' });
    load();
  };
  const markOne = async (id: string) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' });
    load();
  };

  return (
    <div className="space-y-3">
      <BackHeader title="Notifications" />
      {error && <Notice tone="error">{error}</Notice>}
      {data && data.unreadCount > 0 && (
        <button onClick={markAll} className="text-xs font-semibold text-[#259DC3]">Mark all as read ({data.unreadCount})</button>
      )}
      {!data ? (
        <SkeletonList />
      ) : data.data.length === 0 ? (
        <EmptyState title="All caught up" hint="Order approvals, payment verifications and new client assignments appear here." />
      ) : (
        <ul className="space-y-2">
          {data.data.map((n) => (
            <li key={n.id}>
              <button className="w-full text-left" onClick={() => !n.read && markOne(n.id)}>
                <Card className={`p-3 ${n.read ? '' : 'border-[#081224]'}`}>
                  <p className="text-sm font-semibold">{!n.read && <span className="inline-block w-2 h-2 rounded-full bg-[#081224] mr-1.5" aria-label="Unread" />}{n.title}</p>
                  <p className="text-xs text-[#586570] mt-0.5">{n.message}</p>
                  <p className="text-[10px] text-[#80909D] mt-1">{formatDateTime(n.createdAt)}</p>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
