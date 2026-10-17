'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { pushOverlay } from '@/lib/client/overlayStack';
import Sidebar from './Sidebar';
import Header from './Header';

/**
 * Console page frame for admins and managers. Session and role checks already ran on the
 * server (layout) and in middleware; each API call is authorized independently.
 */
export default function AdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const close = useCallback(() => setNavOpen(false), []);
  // Android back button closes the phone navigation drawer first.
  useEffect(() => (navOpen ? pushOverlay(close) : undefined), [navOpen, close]);
  return (
    <div className="min-h-screen bg-[#F5F7F8]">
      <Suspense fallback={null}>
        <Sidebar open={navOpen} onClose={close} />
      </Suspense>
      <div className="lg:pl-[248px] flex flex-col min-w-0 min-h-screen">
        <Header title={title} onMenu={() => setNavOpen(true)} />
        <main id="main" className="flex-1 p-4 md:p-8 min-w-0">{children}</main>
      </div>
    </div>
  );
}
