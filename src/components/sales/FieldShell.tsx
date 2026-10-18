'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, Package, Receipt, Menu, WifiOff, Zap, ShieldCheck, Briefcase, ChevronDown } from 'lucide-react';
import { useSession } from '@/components/shared/SessionProvider';
import { useField } from '@/features/field/FieldProvider';
import { BrandMark } from '@/components/shared/Brand';

const TABS = [
  { href: '/field', label: 'Home', icon: Home },
  { href: '/field/clients', label: 'Clients', icon: Users },
  { href: '/field/orders', label: 'Orders', icon: Package },
  { href: '/field/expenses', label: 'Expenses', icon: Receipt },
  { href: '/field/more', label: 'More', icon: Menu },
];

/** Mobile-first salesperson frame: header, connectivity banner, bottom tab bar (legacy app layout). */
export default function FieldShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  const { dutyStatus, dutyPendingSync, outbox, online } = useField();
  const pending = outbox.length;
  const onDuty = dutyStatus === 'ON_DUTY';

  const [switchOpen, setSwitchOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!switchOpen) return;
    const onDown = (e: MouseEvent) => switchRef.current && !switchRef.current.contains(e.target as Node) && setSwitchOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSwitchOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [switchOpen]);

  const switchRole = async (targetRole: 'SUPER_ADMIN' | 'MANAGER') => {
    setSwitching(true);
    const credentials = {
      SUPER_ADMIN: { identifier: 'admin@erp.com', password: 'Password123!' },
      MANAGER: { identifier: 'manager@erp.com', password: 'Password123!' },
    };
    const cred = credentials[targetRole];
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cred.identifier, password: cred.password, remember: true }),
      });
      if (res.ok) {
        window.location.assign('/dashboard');
      } else {
        setSwitching(false);
      }
    } catch {
      setSwitching(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F5F7F8] flex flex-col max-w-2xl mx-auto sm:border-x sm:border-[#E2E7EC]">
      <header className="sticky top-0 z-30 bg-white border-b border-[#CBD2D7] px-4 py-3 flex items-center justify-between gap-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandMark />
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-[#0B1320] leading-tight">SalesGrid</p>
            <p className="text-[11px] text-[#586570] truncate">
              {user?.name} · {user?.employeeCode}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Quick Demo Switch to Console */}
          <div className="relative" ref={switchRef}>
            <button
              onClick={() => setSwitchOpen(!switchOpen)}
              disabled={switching}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-indigo-200 bg-indigo-50/80 text-[10px] font-bold text-indigo-800 hover:bg-indigo-100 transition-colors cursor-pointer disabled:opacity-50"
              title="Quick switch demo role"
            >
              <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
              <span>Demo</span>
              <ChevronDown className="w-2.5 h-2.5 text-indigo-500" />
            </button>
            {switchOpen && (
              <div className="absolute right-0 mt-1.5 w-52 bg-white border border-[#CBD2D7] rounded-xl shadow-lg py-1 z-50">
                <div className="px-3 py-1 border-b border-[#E2E7EC] text-[10px] font-bold text-[#586570] uppercase">
                  Switch to Console
                </div>
                <button
                  type="button"
                  onClick={() => switchRole('SUPER_ADMIN')}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50/70 transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-[#0B1320]">Admin Console</p>
                    <p className="text-[10px] text-[#586570]">Full ERP settings</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => switchRole('MANAGER')}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-sky-50/70 transition-colors cursor-pointer"
                >
                  <Briefcase className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-[#0B1320]">Manager Console</p>
                    <p className="text-[10px] text-[#586570]">Approvals & team</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          {pending > 0 && (
            <Link href="/field/more/sync" className="px-2 py-1 rounded-full bg-[#CFDDE5] text-[#2C4656] text-[10px] font-bold">
              {pending} to sync
            </Link>
          )}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${onDuty ? 'bg-[#E6F4DD] border-[#B4E39C] text-[#2E6819]' : 'bg-[#F3F5F6] border-[#CBD2D7] text-[#586570]'}`}
            title={dutyPendingSync ? 'Duty change waiting to sync' : undefined}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${onDuty ? 'bg-[#2E6819]' : 'bg-[#80909D]'}`} />
            {onDuty ? 'ON DUTY' : 'OFF DUTY'}
            {dutyPendingSync && '*'}
          </span>
        </div>
      </header>

      {!online && (
        <div role="status" className="bg-[#FEF3C7] text-[#92400E] text-xs px-4 py-2 flex items-center gap-2 border-b border-[#FDE68A]">
          <WifiOff className="w-3.5 h-3.5" />
          Offline. Orders, collections, visits and expenses are saved on this device and sync when you reconnect.
        </div>
      )}

      <main id="main" className="flex-1 px-4 pt-4 pb-28">{children}</main>

      <nav aria-label="Field navigation" className="fixed bottom-0 inset-x-0 z-30 max-w-2xl mx-auto bg-[#E8EDEF] border-t border-[#D8DFE4] px-1.5 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <ul className="grid grid-cols-5 gap-1">
          {TABS.map((t) => {
            const active = t.href === '/field' ? pathname === '/field' : pathname.startsWith(t.href);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center justify-center min-h-[50px] rounded-xl text-[10px] font-semibold ${active ? 'bg-white border border-[#CBD2D7] text-[#0B1320]' : 'text-[#586570]'}`}
                >
                  <Icon className="w-5 h-5 mb-0.5" />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
