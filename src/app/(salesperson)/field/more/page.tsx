'use client';

import Link from 'next/link';
import { Bell, ChevronRight, Clock, CreditCard, MapPin, Package, RefreshCw, User } from 'lucide-react';
import { useField } from '@/features/field/FieldProvider';

export default function FieldMore() {
  const { outbox, dutyStatus } = useField();
  const items = [
    { href: '/field/collect', title: 'Collections & receipts', sub: 'Record payments, download receipts', icon: CreditCard },
    { href: '/field/more/route', title: "Today's route & GPS", sub: 'Tracking status and route map', icon: MapPin },
    { href: '/field/more/attendance', title: 'Attendance history', sub: 'Shift times and duty hours', icon: Clock },
    { href: '/field/more/notifications', title: 'Notifications', sub: 'Approvals, verifications, assignments', icon: Bell },
    { href: '/field/more/catalogue', title: 'Product catalogue', sub: 'Prices, GST and stock', icon: Package },
    { href: '/field/more/sync', title: 'Offline sync queue', sub: outbox.length ? `${outbox.length} waiting` : 'Everything synced', icon: RefreshCw },
    { href: '/field/more/profile', title: 'Profile & sign out', sub: 'Account, privacy, device data', icon: User },
  ];
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-[#0B1320]">More</h1>
      <ul className="bg-white border border-[#CBD2D7] rounded-2xl divide-y divide-[#E2E7EC] overflow-hidden">
        {items.map(({ href, title, sub, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-[#F3F5F6] min-h-[56px]">
              <span className="w-9 h-9 rounded-xl bg-[#F3F5F6] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-[#0B1320]">{title}</span>
                <span className="block text-[11px] text-[#586570] truncate">{sub}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-[#80909D]" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-[#80909D] px-1">Start / End Day controls are on the Home tab. You are currently {dutyStatus === 'ON_DUTY' ? 'on duty' : 'off duty'}.</p>
    </div>
  );
}
