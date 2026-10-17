'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { WifiOff } from 'lucide-react';
import { isNativeApp } from '@/lib/native/platform';
import { isBelowMinimumBuild } from '@/lib/native/logic';

/**
 * Mounted once in the root layout.
 *  - Android app: back button, splash/status bar, and the "update required" gate.
 *  - Everywhere: an offline banner on screens that do not have their own (the field app shows its
 *    own sync state).
 */
export default function NativeShell() {
  const pathname = usePathname() || '/';
  const [online, setOnline] = useState(true);
  const [update, setUpdate] = useState<{ url: string | null } | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    (async () => {
      const { startNativeBridge } = await import('@/lib/native/bridge');
      const info = await startNativeBridge();
      const cfg = await fetch('/api/app/config', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!cancelled && cfg && isBelowMinimumBuild(info.build, cfg.android?.minBuild)) setUpdate({ url: cfg.android.updateUrl });
    })().catch((e) => console.warn('SalesGrid native bridge:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  if (update) {
    return (
      <div role="alertdialog" aria-label="Update required" className="fixed inset-0 z-[100] bg-[#081224] text-white flex flex-col items-center justify-center p-6 text-center">
        <p className="text-lg font-bold">Update required</p>
        <p className="text-sm text-white/80 mt-2 max-w-xs">This version of the SalesGrid app is no longer supported. Install the latest version to continue.</p>
        {update.url ? (
          <a href={update.url} className="mt-5 px-5 py-2.5 rounded-xl bg-[#B4E39C] text-[#081224] font-semibold">Get the update</a>
        ) : (
          <p className="text-xs text-white/60 mt-5">Ask your administrator for the new app.</p>
        )}
      </div>
    );
  }

  if (online || pathname.startsWith('/field')) return null;
  return (
    <div role="status" className="fixed top-0 inset-x-0 z-[90] bg-[#991B1B] text-white text-xs font-semibold px-4 py-2 flex items-center justify-center gap-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
      You are offline. Changes cannot be saved until the connection returns.
    </div>
  );
}
