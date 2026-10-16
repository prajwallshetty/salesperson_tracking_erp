'use client';

import React, { useEffect, useState } from 'react';
import BackHeader from '@/components/sales/BackHeader';
import { Card, EmptyState, Notice, SkeletonList, StatusPill } from '@/components/sales/mobile';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { formatTime } from '@/lib/client/format';

/** Legacy screen read startTime/endTime/totalHours, which the API never returned. */
export default function AttendanceHistory() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiJson<{ data: any[] }>('/api/attendance/history?limit=60')
      .then((r) => setRows(r.data))
      .catch((e) => {
        setRows([]);
        setError(errorMessage(e));
      });
  }, []);
  return (
    <div className="space-y-3">
      <BackHeader title="Attendance history" />
      {error && <Notice tone="error">{error}</Notice>}
      {rows === null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState title="No attendance yet" hint="Start your day on the Home tab." />
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id}>
              <Card className="p-3">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-bold">{new Date(a.date).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</p>
                  <StatusPill status={a.status} />
                </div>
                <p className="text-xs text-[#586570] mt-1">
                  {formatTime(a.loginAt)} – {a.logoutAt ? formatTime(a.logoutAt) : 'in progress'}
                  {a.status === 'COMPLETED' && ` · ${Math.floor(a.workingMinutes / 60)}h ${a.workingMinutes % 60}m · ${a.distanceKm} km`}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
