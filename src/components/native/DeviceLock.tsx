'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { isNativeApp } from '@/lib/native/platform';
import { shouldLock } from '@/lib/native/logic';

/**
 * Biometric lock screen (Android app only, when the signed-in user turned it on for this device).
 * Locks on a cold start and after 5 minutes in the background. "Sign out" is always offered, so a
 * failed sensor can never trap the user; the server session is untouched by the lock itself.
 */
export default function DeviceLock({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const enabledRef = useRef(false);
  const backgroundedAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setError('');
    try {
      const { authenticateBiometric } = await import('@/lib/native/biometric');
      await authenticateBiometric();
      setLocked(false);
    } catch (e) {
      setError((e as Error).message || 'Not recognised. Try again.');
    }
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    let active = true;
    const onPause = () => {
      backgroundedAt.current = Date.now();
    };
    const onResume = () => {
      if (shouldLock({ enabled: enabledRef.current, coldStart: false, backgroundedAt: backgroundedAt.current, now: Date.now() })) {
        setLocked(true);
        void unlock();
      }
      backgroundedAt.current = null;
    };
    (async () => {
      const [{ isBiometricLockEnabled }, { APP_PAUSE_EVENT, APP_RESUME_EVENT }] = await Promise.all([
        import('@/lib/native/biometric'),
        import('@/lib/native/bridge'),
      ]);
      enabledRef.current = await isBiometricLockEnabled(userId);
      if (!active) return;
      window.addEventListener(APP_PAUSE_EVENT, onPause);
      window.addEventListener(APP_RESUME_EVENT, onResume);
      // A cold start is detected once per app process (sessionStorage is per WebView process).
      const coldStart = !sessionStorage.getItem('salesgrid:unlocked');
      if (shouldLock({ enabled: enabledRef.current, coldStart, backgroundedAt: null, now: Date.now() })) {
        setLocked(true);
        void unlock();
      }
      sessionStorage.setItem('salesgrid:unlocked', '1');
    })().catch(() => undefined);
    const enabledChanged = (e: Event) => {
      enabledRef.current = Boolean((e as CustomEvent).detail);
    };
    window.addEventListener('salesgrid:biometric-lock', enabledChanged);
    return () => {
      active = false;
      window.removeEventListener('salesgrid:biometric-lock', enabledChanged);
      import('@/lib/native/bridge').then(({ APP_PAUSE_EVENT, APP_RESUME_EVENT }) => {
        window.removeEventListener(APP_PAUSE_EVENT, onPause);
        window.removeEventListener(APP_RESUME_EVENT, onResume);
      });
    };
  }, [userId, unlock]);

  if (!locked) return null;
  return (
    <div role="alertdialog" aria-label="Bharath Interior Decor is locked" className="fixed inset-0 z-[95] bg-[#000000] text-white flex flex-col items-center justify-center p-6 text-center">
      <Fingerprint className="w-12 h-12 text-[#D4AF37]" aria-hidden="true" />
      <p className="text-lg font-bold mt-3">Bharath Interior Decor is locked</p>
      <p className="text-sm text-white/75 mt-1">Use your fingerprint, face or device PIN to continue.</p>
      {error && <p className="text-xs text-[#FCA5A5] mt-3 max-w-xs">{error}</p>}
      <button onClick={unlock} className="mt-6 px-5 py-2.5 rounded-xl bg-[#D4AF37] text-[#000000] font-semibold min-h-[44px]">Unlock</button>
      <button onClick={onSignOut} className="mt-3 px-5 py-2.5 rounded-xl border border-white/30 text-sm min-h-[44px]">Sign out</button>
    </div>
  );
}
