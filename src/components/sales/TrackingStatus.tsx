'use client';

import React, { useEffect, useState } from 'react';
import { useField } from '@/features/field/FieldProvider';
import { formatAge } from '@/lib/client/format';

/** Honest GPS state: permission, freshness of the last real fix, and buffered uploads. */
export default function TrackingStatus({ compact = false }: { compact?: boolean }) {
  const { tracking, dutyStatus, setWakeLock } = useField();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const fix = tracking.lastFix;
  const ageSec = fix ? (Date.now() - new Date(fix.timestamp).getTime()) / 1000 : null;
  const stale = ageSec !== null && ageSec > 180;

  let tone = 'text-[#586570]';
  let text = 'Tracking paused (off duty)';
  if (dutyStatus === 'ON_DUTY') {
    if (tracking.status === 'unsupported') {
      tone = 'text-[#991B1B]';
      text = 'This browser cannot provide location. Use Chrome or Safari on a phone with GPS.';
    } else if (tracking.status === 'denied' || tracking.permission === 'denied') {
      tone = 'text-[#991B1B]';
      text = 'Location permission is blocked. Allow location for this site in your browser settings, then reload.';
    } else if (!fix) {
      tone = 'text-[#92400E]';
      text = tracking.lastError || 'Waiting for the first GPS fix…';
    } else if (stale) {
      tone = 'text-[#92400E]';
      text = `Last fix ${formatAge(fix.timestamp)} — signal weak or app was in the background`;
    } else {
      tone = 'text-[#2E6819]';
      text = `GPS live · last fix ${formatAge(fix.timestamp)}${fix.accuracy != null ? ` · ±${Math.round(fix.accuracy)} m` : ''}`;
    }
  }

  return (
    <div className="space-y-1.5">
      <p className={`text-xs font-semibold ${tone}`} role="status">
        {text}
      </p>
      {dutyStatus === 'ON_DUTY' && tracking.buffered > 0 && (
        <p className="text-[11px] text-[#586570]">{tracking.buffered} location point{tracking.buffered > 1 ? 's' : ''} saved on device, uploading when connected.</p>
      )}
      {!compact && dutyStatus === 'ON_DUTY' && tracking.wakeLockSupported && (
        <label className="flex items-center gap-2 text-xs text-[#0B1320] pt-1">
          <input type="checkbox" className="w-4 h-4" checked={tracking.wakeLock} onChange={(e) => setWakeLock(e.target.checked)} />
          Keep screen on while working (improves tracking continuity)
        </label>
      )}
      {!compact && (
        <p className="text-[11px] text-[#80909D]">
          Browsers only provide location while SalesGrid is open. If you switch apps or lock the screen, gaps appear in your route and are shown as gaps — never filled in.
        </p>
      )}
    </div>
  );
}
