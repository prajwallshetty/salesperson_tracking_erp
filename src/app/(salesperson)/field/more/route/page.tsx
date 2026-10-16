'use client';

import React, { useEffect, useState } from 'react';
import BackHeader from '@/components/sales/BackHeader';
import TrackingStatus from '@/components/sales/TrackingStatus';
import RouteMap, { acceptedSegments } from '@/components/maps/RouteMap';
import { Card, Notice } from '@/components/sales/mobile';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { useField } from '@/features/field/FieldProvider';
import { formatTime } from '@/lib/client/format';

export default function MyRoute() {
  const { tracking } = useField();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson('/api/location/history')
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [tracking.lastUploadAt]);

  const segments = acceptedSegments(data?.segments);
  return (
    <div className="space-y-3">
      <BackHeader title="Today's route & GPS" />
      <Card>
        <TrackingStatus />
      </Card>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="h-[50vh] min-h-[280px] rounded-2xl overflow-hidden border border-[#CBD2D7] bg-white">
        <RouteMap segments={segments} events={data?.events} />
      </div>
      {data && (
        <Card>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-[11px] text-[#586570]">Estimated distance</dt><dd className="font-bold">{data.estimatedDistanceKm} km</dd></div>
            <div><dt className="text-[11px] text-[#586570]">GPS points</dt><dd className="font-bold">{data.filteredPointsCount}{data.rejectedPointsCount ? ` (+${data.rejectedPointsCount} rejected)` : ''}</dd></div>
            <div><dt className="text-[11px] text-[#586570]">Visits</dt><dd className="font-bold">{data.events.visits.length}</dd></div>
            <div><dt className="text-[11px] text-[#586570]">Tracking gaps</dt><dd className="font-bold">{Math.max(0, segments.length - 1)}</dd></div>
          </dl>
          {data.attendance && <p className="text-xs text-[#586570] mt-3">Shift started {formatTime(data.attendance.loginAt)}{data.attendance.logoutAt ? `, ended ${formatTime(data.attendance.logoutAt)}` : ''}.</p>}
          <p className="text-[11px] text-[#80909D] mt-2">{data.disclaimer}</p>
        </Card>
      )}
    </div>
  );
}
