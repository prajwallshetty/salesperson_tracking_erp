'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard, Navigation2, Users, Building2, Package, ShoppingCart, CreditCard, FileBarChart,
  Settings, ShieldAlert, ChevronDown, ChevronRight, LogOut, Receipt, X, MonitorSmartphone,
} from 'lucide-react';
import { useSession } from '@/components/shared/SessionProvider';
import { useSocket } from '@/components/shared/RealtimeProvider';
import { apiFetch } from '@/lib/client/apiFetch';
import type { ManagerPermissionKey } from '@/lib/permissions';
import { BrandMark } from '@/components/shared/Brand';

interface NavChild {
  title: string;
  href: string;
  badgeKey?: BadgeKey;
  permission?: ManagerPermissionKey;
}
interface NavItem {
  title: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  live?: boolean;
  permission?: ManagerPermissionKey;
  adminOnly?: boolean;
  children?: NavChild[];
}
type BadgeKey = 'orders' | 'payments' | 'expenses';

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'OPERATIONS',
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'canViewDashboard' },
      { title: 'Live Tracking', href: '/salespersons/live', icon: Navigation2, live: true, permission: 'canViewGps' },
      {
        title: 'Salespersons',
        icon: Users,
        children: [
          { title: 'All Salespersons', href: '/salespersons' },
          { title: 'Access Codes', href: '/salespersons/access-codes' },
          { title: 'Attendance', href: '/salespersons/attendance' },
          { title: 'Performance', href: '/salespersons/performance' },
          { title: 'Route History', href: '/salespersons/route', permission: 'canViewGps' },
        ],
      },
      {
        title: 'Clients',
        icon: Building2,
        children: [
          { title: 'All Clients', href: '/clients' },
          { title: 'Assignments', href: '/clients/assignments', permission: 'canAssignClients' },
          { title: 'Client Visits', href: '/clients/visits' },
        ],
      },
    ],
  },
  {
    group: 'COMMERCIAL',
    items: [
      { title: 'Products', href: '/products', icon: Package },
      {
        title: 'Orders',
        icon: ShoppingCart,
        permission: 'canViewOrders',
        children: [
          { title: 'All Orders', href: '/orders' },
          { title: 'Pending Approval', href: '/orders?status=SUBMITTED', badgeKey: 'orders' },
          { title: 'Confirmed Orders', href: '/orders?status=CONFIRMED' },
        ],
      },
      {
        title: 'Collections',
        icon: CreditCard,
        permission: 'canViewPayments',
        children: [
          { title: 'All Collections', href: '/payments' },
          { title: 'Pending Verification', href: '/payments?status=PENDING', badgeKey: 'payments' },
        ],
      },
      {
        title: 'Expenses',
        icon: Receipt,
        children: [
          { title: 'All Claims', href: '/expenses' },
          { title: 'Pending Approval', href: '/expenses?status=SUBMITTED', badgeKey: 'expenses' },
          { title: 'Reimbursements', href: '/expenses?status=APPROVED' },
        ],
      },
      { title: 'Reports', href: '/reports', icon: FileBarChart, permission: 'canViewReports' },
    ],
  },
  {
    group: 'ADMINISTRATION',
    items: [
      { title: 'Settings', href: '/settings', icon: Settings, adminOnly: true },
      { title: 'Audit Logs', href: '/audit-logs', icon: ShieldAlert },
    ],
  },
];

/** Real pending counts (legacy sidebar showed hard-coded numbers). */
function usePendingCounts(enabled: Record<BadgeKey, boolean>) {
  const { lastEvent } = useSocket();
  const [counts, setCounts] = useState<Record<BadgeKey, number>>({ orders: 0, payments: 0, expenses: 0 });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const read = async (url: string, pick: (j: any) => number) => {
        try {
          const r = await apiFetch(url);
          return r.ok ? pick(await r.json()) : 0;
        } catch {
          return 0;
        }
      };
      const [orders, payments, expenses] = await Promise.all([
        enabled.orders ? read('/api/orders?status=SUBMITTED&limit=1', (j) => j.total ?? 0) : 0,
        enabled.payments ? read('/api/payments?status=PENDING&limit=1', (j) => j.total ?? 0) : 0,
        enabled.expenses ? read('/api/expenses?status=SUBMITTED&limit=1', (j) => j.meta?.total ?? 0) : 0,
      ]);
      if (!cancelled) setCounts({ orders, payments, expenses });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent?.eventName, lastEvent?.timestamp]);
  return counts;
}

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { user, logout, logoutEverywhere, hasPermission } = useSession();
  const [confirmAll, setConfirmAll] = useState(false);
  const [allError, setAllError] = useState('');
  const [allBusy, setAllBusy] = useState(false);
  const signOutEverywhere = async () => {
    setAllBusy(true);
    setAllError('');
    try {
      await logoutEverywhere();
    } catch (e) {
      setAllError((e as Error).message);
      setAllBusy(false);
    }
  };
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});

  const allowed = (perm?: ManagerPermissionKey, adminOnly?: boolean) => (adminOnly ? isAdmin : !perm || hasPermission(perm));
  const counts = usePendingCounts({
    orders: allowed('canViewOrders'),
    payments: allowed('canViewPayments'),
    expenses: true,
  });

  const isHrefActive = (href: string) => {
    const [path, query] = href.split('?');
    if (pathname !== path) return false;
    if (!query) return !search.get('status');
    const q = new URLSearchParams(query);
    return Array.from(q.entries()).every(([k, v]) => search.get(k) === v);
  };

  // Close the mobile drawer on navigation.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  return (
    <>
      {open && <div className="fixed inset-0 bg-[#0B1320]/40 z-30 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        id="console-nav"
        className={`w-[248px] bg-[#E8EDEF] border-r border-[#D8DFE4] flex flex-col h-[100dvh] fixed left-0 top-0 z-40 select-none transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-[64px] lg:h-[72px] flex items-center px-5 gap-3 border-b border-[#D8DFE4]/80">
          <BrandMark />
          <div className="leading-tight flex-1 min-w-0">
            <p className="font-semibold text-[#0B1320] text-[13px] tracking-tight">Bharath Interior Decor</p>
            <p className="text-[11px] text-[#586570]">{isAdmin ? 'Admin Console' : 'Manager Console'}</p>
          </div>
          <button className="lg:hidden p-1.5 rounded-md hover:bg-[#DFE5E8]" onClick={onClose} aria-label="Close navigation">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {NAV.map((group) => {
            const items = group.items.filter((i) => allowed(i.permission, i.adminOnly));
            if (!items.length) return null;
            return (
              <div key={group.group}>
                <div className="px-3 pb-1.5 text-[10px] font-semibold tracking-wider text-[#7E8B95]">{group.group}</div>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const children = item.children?.filter((c) => allowed(c.permission));
                    if (!children?.length) {
                      const active = item.href ? pathname === item.href : false;
                      return (
                        <li key={item.title}>
                          <Link
                            href={item.href || '#'}
                            aria-current={active ? 'page' : undefined}
                            className={`flex items-center justify-between px-3 py-2 rounded-xl text-[13px] transition-all ${
                              active ? 'bg-white text-[#0B1320] font-medium border border-[#CBD2D7]' : 'text-[#586570] hover:text-[#0B1320] hover:bg-[#DFE5E8]'
                            }`}
                          >
                            <span className="flex items-center gap-2.5">
                              <Icon className="w-4 h-4 stroke-[1.75]" />
                              {item.title}
                            </span>
                            {item.live && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E6F4DD] text-[#2E6819]">Live</span>}
                          </Link>
                        </li>
                      );
                    }
                    const childActive = children.some((c) => pathname === c.href.split('?')[0]);
                    const isOpen = openMenus[item.title] ?? childActive;
                    const total = children.reduce((s, c) => s + (c.badgeKey ? counts[c.badgeKey] : 0), 0);
                    return (
                      <li key={item.title}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpenMenus((p) => ({ ...p, [item.title]: !isOpen }))}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] transition-all ${
                            childActive && !isOpen ? 'bg-white/70 text-[#0B1320] font-medium border border-[#CBD2D7]' : 'text-[#586570] hover:text-[#0B1320] hover:bg-[#DFE5E8]'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <Icon className="w-4 h-4 stroke-[1.75]" />
                            {item.title}
                          </span>
                          <span className="flex items-center gap-1.5">
                            {total > 0 && !isOpen && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#CFDDE5] text-[#2C4656]" aria-label={`${total} pending`}>{total}</span>
                            )}
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-[#7E8B95]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#7E8B95]" />}
                          </span>
                        </button>
                        {isOpen && (
                          <ul className="pl-8 pr-1 py-1 space-y-0.5">
                            {children.map((sub) => {
                              const active = isHrefActive(sub.href);
                              const count = sub.badgeKey ? counts[sub.badgeKey] : 0;
                              return (
                                <li key={sub.title}>
                                  <Link
                                    href={sub.href}
                                    aria-current={active ? 'page' : undefined}
                                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                      active ? 'bg-white text-[#0B1320] font-semibold border border-[#CBD2D7]' : 'text-[#586570] hover:text-[#0B1320] hover:bg-[#DFE5E8]'
                                    }`}
                                  >
                                    <span>{sub.title}</span>
                                    {count > 0 && <span className="text-[10px] font-semibold px-1.5 rounded-full bg-[#CFDDE5] text-[#2C4656]">{count}</span>}
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#D8DFE4]">
          {confirmAll && (
            <div role="dialog" aria-label="Sign out of all devices" className="mb-2 p-3 rounded-xl bg-white border border-[#D8DFE4] text-[12px] text-[#0B1320] space-y-2">
              <p>Sign out of Bharath Interior Decor on every browser and device, including this one?</p>
              {allError && <p className="text-[#991B1B]">{allError}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmAll(false)} className="px-2.5 py-1 rounded-md border border-[#D8DFE4]">Cancel</button>
                <button onClick={signOutEverywhere} disabled={allBusy} className="px-2.5 py-1 rounded-md bg-[#991B1B] text-white disabled:opacity-60">
                  {allBusy ? 'Signing out…' : 'Sign out everywhere'}
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between px-2 py-1.5 rounded-xl">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-[#000000] text-[#D4AF37] flex items-center justify-center font-semibold text-[11px] shrink-0">
                {user?.name?.slice(0, 2).toUpperCase()}
              </div>
              <div className="truncate">
                <p className="text-[13px] font-medium text-[#0B1320] truncate leading-tight">{user?.name}</p>
                <p className="text-[10px] text-[#586570] uppercase tracking-wider">{user?.role?.replace('_', ' ')}</p>
              </div>
            </div>
            <div className="flex shrink-0">
              <button onClick={() => setConfirmAll(true)} title="Sign out of all devices" aria-label="Sign out of all devices" className="p-2 text-[#7E8B95] hover:text-[#991B1B] hover:bg-white/80 rounded-md">
                <MonitorSmartphone className="w-4 h-4" />
              </button>
              <button onClick={() => logout()} title="Sign out" aria-label="Sign out" className="p-2 text-[#7E8B95] hover:text-[#991B1B] hover:bg-white/80 rounded-md">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
