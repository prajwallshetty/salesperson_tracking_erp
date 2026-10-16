'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Navigation2,
  Users,
  CalendarCheck,
  TrendingUp,
  Building2,
  Calendar,
  Package,
  ShoppingCart,
  CreditCard,
  FileBarChart,
  Settings,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  LogOut,
  ChevronsUpDown,
  Receipt,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface NavLinkItem {
  title: string;
  href: string;
  icon: any;
  badge?: string | number;
}

interface NavGroup {
  groupName: string;
  items: {
    title: string;
    href?: string;
    icon: any;
    badge?: string | number;
    children?: { title: string; href: string; badge?: string | number }[];
  }[];
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({
    Salespersons: true,
    Clients: false,
    Orders: false,
    Payments: false,
    Expenses: false,
  });

  const toggleSubmenu = (title: string) => {
    setOpenSubmenus((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const navGroups: NavGroup[] = [
    {
      groupName: 'OPERATIONS',
      items: [
        {
          title: 'Dashboard',
          href: '/dashboard',
          icon: LayoutDashboard,
        },
        {
          title: 'Live Tracking',
          href: '/salespersons/live',
          icon: Navigation2,
          badge: 'Live',
        },
        {
          title: 'Salespersons',
          icon: Users,
          children: [
            { title: 'All Salespersons', href: '/salespersons' },
            { title: 'Access Codes', href: '/salespersons/access-codes' },
            { title: 'Attendance', href: '/salespersons/attendance' },
            { title: 'Performance', href: '/salespersons/performance' },
            { title: 'Route History', href: '/salespersons/route' },
          ],
        },
        {
          title: 'Clients',
          icon: Building2,
          children: [
            { title: 'All Clients', href: '/clients' },
            { title: 'Assignments', href: '/clients/assignments' },
            { title: 'Client Visits', href: '/clients/visits' },
          ],
        },
      ],
    },
    {
      groupName: 'COMMERCIAL',
      items: [
        {
          title: 'Products',
          href: '/products',
          icon: Package,
        },
        {
          title: 'Orders',
          icon: ShoppingCart,
          badge: 3,
          children: [
            { title: 'All Orders', href: '/orders' },
            { title: 'Pending Approval', href: '/orders?status=SUBMITTED' },
            { title: 'Confirmed Orders', href: '/orders?status=CONFIRMED' },
          ],
        },
        {
          title: 'Collections',
          icon: CreditCard,
          badge: 2,
          children: [
            { title: 'All Collections', href: '/payments' },
            { title: 'Pending Verification', href: '/payments?status=PENDING' },
          ],
        },
        {
          title: 'Expenses',
          icon: Receipt,
          children: [
            { title: 'All Claims', href: '/expenses' },
            { title: 'Pending Approval', href: '/expenses?status=SUBMITTED' },
            { title: 'Reimbursements', href: '/expenses?status=APPROVED' },
          ],
        },
        {
          title: 'Reports',
          href: '/reports',
          icon: FileBarChart,
        },
      ],
    },
    {
      groupName: 'OTHER',
      items: [
        {
          title: 'Settings',
          href: '/settings',
          icon: Settings,
        },
        {
          title: 'Audit Logs',
          href: '/audit-logs',
          icon: ShieldAlert,
        },
      ],
    },
  ];

  return (
    <aside className="w-[236px] bg-[#E8EDEF] border-r border-[#D8DFE4] flex flex-col h-screen fixed left-0 top-0 z-30 select-none">
      {/* Brand Header */}
      <div className="h-[72px] flex items-center px-5 gap-3 border-b border-[#D8DFE4]/80">
        <div className="w-8 h-8 rounded-lg bg-[#081224] flex items-center justify-center text-white shrink-0">
          <div className="w-4 h-4 border-2 border-white/90 rounded-[3px] flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-[#B4E39C] rounded-[1px]" />
          </div>
        </div>
        <div className="leading-tight">
          <h1 className="font-semibold text-[#0B1320] text-[13px] tracking-tight">FieldTrack</h1>
          <p className="text-[11px] text-[#586570]">Operations Hub</p>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {navGroups.map((group) => (
          <div key={group.groupName}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold tracking-wider text-[#7E8B95] uppercase">
              {group.groupName}
            </div>

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const hasChildren = Boolean(item.children && item.children.length > 0);
                const isOpen = openSubmenus[item.title];
                const isActive = item.href ? pathname === item.href : false;

                if (!hasChildren) {
                  return (
                    <Link
                      key={item.title}
                      href={item.href || '#'}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-[13px] transition-all ${
                        isActive
                          ? 'bg-white text-[#0B1320] font-medium border border-[#CBD2D7] shadow-none'
                          : 'text-[#586570] hover:text-[#0B1320] hover:bg-[#DFE5E8]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={`w-4 h-4 stroke-[1.75] ${
                            isActive ? 'text-[#0B1320]' : 'text-[#586570]'
                          }`}
                        />
                        <span>{item.title}</span>
                      </div>

                      {item.badge && (
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            item.badge === 'Live'
                              ? 'bg-[#E6F4DD] text-[#2E6819]'
                              : 'bg-[#CFDDE5] text-[#2C4656]'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                }

                // Item with dropdown children
                const isChildActive =
                  item.children?.some((c) => pathname === c.href.split('?')[0]) || false;

                return (
                  <div key={item.title} className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => toggleSubmenu(item.title)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] transition-all ${
                        isChildActive && !isOpen
                          ? 'bg-white/70 text-[#0B1320] font-medium border border-[#CBD2D7]'
                          : 'text-[#586570] hover:text-[#0B1320] hover:bg-[#DFE5E8]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4 stroke-[1.75] text-[#586570]" />
                        <span>{item.title}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {item.badge && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#CFDDE5] text-[#2C4656]">
                            {item.badge}
                          </span>
                        )}
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#7E8B95]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#7E8B95]" />
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="pl-8 pr-1 py-1 space-y-0.5">
                        {item.children!.map((sub) => {
                          const isSubActive = pathname === sub.href.split('?')[0];
                          return (
                            <Link
                              key={sub.title}
                              href={sub.href}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                isSubActive
                                  ? 'bg-white text-[#0B1320] font-semibold border border-[#CBD2D7]'
                                  : 'text-[#586570] hover:text-[#0B1320] hover:bg-[#DFE5E8]'
                              }`}
                            >
                              <span>{sub.title}</span>
                              {sub.badge && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-[#CFDDE5] text-[#2C4656]">
                                  {sub.badge}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* User Footer Profile (Reference: Sarah Milley style bottom card) */}
      <div className="p-3 border-t border-[#D8DFE4] bg-[#E8EDEF]">
        <div className="flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-[#DFE5E8] transition-colors group">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-7 h-7 rounded-full bg-[#081224] text-[#B4E39C] flex items-center justify-center font-semibold text-[11px] shrink-0">
              {user?.name?.slice(0, 2).toUpperCase() || 'AD'}
            </div>
            <div className="truncate">
              <p className="text-[13px] font-medium text-[#0B1320] truncate leading-tight">
                {user?.name || 'Administrator'}
              </p>
              <p className="text-[10px] text-[#586570] uppercase tracking-wider">
                {user?.role?.replace('_', ' ') || 'Admin'}
              </p>
            </div>
          </div>

          <button
            onClick={logout}
            title="Sign out"
            className="p-1 text-[#7E8B95] hover:text-[#991B1B] hover:bg-white/80 rounded-md transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
