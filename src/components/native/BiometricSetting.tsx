'use client';

import React, { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/native/platform';

/** "Unlock with fingerprint" toggle. Renders only in the Android app. */
export default function BiometricSetting({ userId }: { userId: string }) {
  const [state, setState] = useState<{ available: boolean; reason: string; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isNativeApp()) return;
    (async () => {
      const b = await import('@/lib/native/biometric');
      const [status, enabled] = await Promise.all([b.biometricStatus(), b.isBiometricLockEnabled(userId)]);
      setState({ ...status, enabled });
    })().catch((e) => setError((e as Error).message));
  }, [userId]);

  if (!isNativeApp() || (!state && !error)) return null;

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError('');
    try {
      const { setBiometricLock } = await import('@/lib/native/biometric');
      await setBiometricLock(userId, next);
      setState((s) => (s ? { ...s, enabled: next } : s));
      window.dispatchEvent(new CustomEvent('salesgrid:biometric-lock', { detail: next }));
    } catch (e) {
      setError((e as Error).message || 'Biometric confirmation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#E2E7EC] bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#80909D]">Security on this phone</p>
      {state?.available ? (
        <label className="flex items-start gap-3 mt-2 text-sm">
          <input type="checkbox" className="mt-1 w-4 h-4" checked={state.enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
          <span>
            Unlock with fingerprint or face
            <span className="block text-xs text-[#586570]">Asked when the app opens and after 5 minutes in the background. Your session stays protected by the server as usual.</span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-[#586570] mt-2">Biometric unlock is not available: {state?.reason || error}</p>
      )}
      {error && state?.available && <p className="text-xs text-[#991B1B] mt-2">{error}</p>}
    </div>
  );
}
