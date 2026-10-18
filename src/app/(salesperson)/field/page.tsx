'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { CreditCard, MapPin, RefreshCw } from 'lucide-react';
import { useSession } from '@/components/shared/SessionProvider';
import { useField } from '@/features/field/FieldProvider';
import { Card, Notice, PrimaryButton, SecondaryButton, Sheet } from '@/components/sales/mobile';
import TrackingStatus from '@/components/sales/TrackingStatus';
import { formatTime, inr } from '@/lib/client/format';
import { TRACKING_DISCLOSURE, acceptTrackingConsent, needsTrackingConsent } from '@/features/field/trackingConsent';
import { isNativeApp } from '@/lib/native/platform';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function FieldHome() {
  const { user } = useSession();
  const { dashboard, dashboardError, dutyStatus, dutyPendingSync, outbox, syncing, syncNow, startDay, endDay, refreshDashboard } = useField();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'warning' | 'info'; text: string } | null>(null);
  const [askNoLocation, setAskNoLocation] = useState<string | null>(null);
  const [summary, setSummary] = useState<any | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const onDuty = dutyStatus === 'ON_DUTY';

  // Android app, first time: explain background location before anything is requested or recorded.
  const requestStart = async () => {
    if (user && (await needsTrackingConsent(user.id))) return setShowDisclosure(true);
    void doStart();
  };
  const acceptAndStart = async () => {
    if (user) await acceptTrackingConsent(user.id);
    setShowDisclosure(false);
    void doStart();
  };

  const doStart = async (allowWithoutLocation = false) => {
    setBusy(true);
    setMessage(null);
    const res = await startDay({ allowWithoutLocation });
    setBusy(false);
    if (!res.ok) {
      if (res.locationError && !allowWithoutLocation) return setAskNoLocation(res.locationError);
      return setMessage({ tone: 'error', text: res.error });
    }
    setAskNoLocation(null);
    setMessage(
      res.offline
        ? { tone: 'warning', text: 'No connection — your Start Day is saved on this device and will sync automatically. GPS points are buffered meanwhile.' }
        : { tone: 'success', text: res.locationError ? 'Day started without a location fix. Tracking will begin once GPS is available.' : 'You are on duty. Location tracking is active while Bharath Interior Decor is open.' }
    );
  };

  const doEnd = async () => {
    setConfirmEnd(false);
    setBusy(true);
    setMessage(null);
    const res = await endDay();
    setBusy(false);
    if (!res.ok) return setMessage({ tone: 'error', text: res.error });
    if (res.offline) return setMessage({ tone: 'warning', text: 'No connection — End Day is saved and will sync automatically. Your summary will be available after sync.' });
    setSummary(res.data);
  };

  const failed = outbox.filter((i) => i.status === 'FAILED').length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-[#0B1320]">
          {greeting()}, {user?.name?.split(' ')[0]}
        </h1>
        <p className="text-xs text-[#586570]">
          {user?.employeeCode} · {user?.territory}
        </p>
      </div>

      {outbox.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3">
          <p className="text-xs text-[#1E3A8A]">
            <strong>{outbox.length}</strong> record{outbox.length > 1 ? 's' : ''} waiting to sync{failed ? ` (${failed} need attention)` : ''}.
          </p>
          <div className="flex gap-2">
            {failed > 0 && (
              <Link href="/field/more/sync" className="text-xs font-semibold text-[#1E3A8A] underline">
                Review
              </Link>
            )}
            <button onClick={() => syncNow()} disabled={syncing} className="text-xs font-semibold text-[#1E3A8A] inline-flex items-center gap-1">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync now
            </button>
          </div>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-[#80909D] uppercase">Duty status</p>
            <p className="text-base font-bold text-[#0B1320] mt-0.5">
              {onDuty ? 'On duty' : 'Off duty'}
              {dutyPendingSync && <span className="text-xs font-normal text-[#92400E]"> · pending sync</span>}
            </p>
            {onDuty && dashboard?.loginTime && <p className="text-xs text-[#586570]">Since {formatTime(dashboard.loginTime)}</p>}
          </div>
          <MapPin className={`w-6 h-6 ${onDuty ? 'text-[#2E6819]' : 'text-[#80909D]'}`} />
        </div>
        {onDuty && (
          <div className="mt-3">
            <TrackingStatus compact />
          </div>
        )}
        <div className="mt-4">
          {onDuty ? (
            <SecondaryButton className="w-full" onClick={() => setConfirmEnd(true)} disabled={busy || !dashboard}>
              {busy ? 'Ending day…' : 'End day & close shift'}
            </SecondaryButton>
          ) : (
            <PrimaryButton onClick={requestStart} loading={busy} disabled={!dashboard}>
              Start day (enables GPS tracking)
            </PrimaryButton>
          )}
        </div>
        {!onDuty && (
          <p className="text-[11px] text-[#80909D] mt-2">
            {isNativeApp()
              ? 'Your location is recorded only while you are on duty, including when the app is in the background. A notification shows while it is on, and it stops the moment you end your day.'
              : 'Your location is recorded only while you are on duty and Bharath Interior Decor is open. It stops the moment you end your day.'}
          </p>
        )}
      </Card>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {dashboardError && (
        <Notice tone="error">
          Could not load today&apos;s figures: {dashboardError}{' '}
          <button className="underline font-semibold" onClick={refreshDashboard}>Retry</button>
        </Notice>
      )}

      <Card>
        <p className="text-[11px] font-bold tracking-wider text-[#80909D] uppercase mb-3">Today&apos;s performance</p>
        {!dashboard ? (
          <div className="h-24 bg-[#F3F5F6] rounded-xl animate-pulse" aria-busy="true" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-[#586570]">Sales</p>
                <p className="text-xl font-bold text-[#0B1320]">{inr(dashboard.todaySales)}</p>
              </div>
              <div>
                <p className="text-xs text-[#586570]">Orders</p>
                <p className="text-xl font-bold text-[#0B1320]">{dashboard.ordersCount}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-[#E2E7EC]">
              <div>
                <p className="text-[11px] text-[#586570]">Verified collections</p>
                <p className="text-sm font-bold text-[#2E6819]">{inr(dashboard.verifiedCollections)}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#586570]">Pending collections</p>
                <p className="text-sm font-bold text-[#92400E]">{inr(dashboard.pendingCollections)}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#586570]">Clients visited</p>
                <p className="text-sm font-bold text-[#0B1320]">
                  {dashboard.clientsVisited} / {dashboard.totalAssignedClients}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-[#586570] mt-3">Outstanding across your clients: <strong>{inr(dashboard.totalAssignedOutstanding)}</strong></p>
          </>
        )}
      </Card>

      <Link href="/field/collect" className="flex items-center justify-center gap-2 min-h-[48px] rounded-2xl bg-[#E6F4DD] border border-[#D4AF37] text-[#2E6819] text-sm font-bold">
        <CreditCard className="w-4 h-4" /> Collect customer payment
      </Link>

      <div className="grid grid-cols-2 gap-3">
        {[
          { href: '/field/clients', title: 'My clients', sub: `${dashboard?.totalAssignedClients ?? '—'} assigned` },
          { href: '/field/orders?new=1', title: 'New order', sub: 'Catalogue & cart' },
          { href: '/field/expenses', title: 'Expenses', sub: 'Travel, meals, fuel' },
          { href: '/field/more/route', title: "Today's route", sub: 'GPS & visits' },
        ].map((a) => (
          <Link key={a.href} href={a.href} className="bg-white border border-[#CBD2D7] rounded-2xl p-4 hover:border-[#000000]">
            <p className="text-sm font-bold text-[#0B1320]">{a.title}</p>
            <p className="text-[11px] text-[#586570] mt-0.5">{a.sub}</p>
          </Link>
        ))}
      </div>

      <Sheet
        open={showDisclosure}
        title="Location tracking while you work"
        onClose={() => setShowDisclosure(false)}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => setShowDisclosure(false)}>Not now</SecondaryButton>
            <PrimaryButton onClick={acceptAndStart}>I understand — continue</PrimaryButton>
          </div>
        }
      >
        <ul className="space-y-2 text-sm text-[#0B1320] list-disc pl-5">
          {TRACKING_DISCLOSURE.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="text-xs text-[#586570] mt-3">Android will now ask for permission to use your location (and to show the tracking notification). You can change this later in Android settings.</p>
      </Sheet>

      <Sheet
        open={askNoLocation !== null}
        title="Location unavailable"
        onClose={() => setAskNoLocation(null)}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => doStart()}>Try again</SecondaryButton>
            <PrimaryButton onClick={() => doStart(true)} loading={busy}>Start without GPS</PrimaryButton>
          </div>
        }
      >
        <p className="text-sm text-[#0B1320]">{askNoLocation}</p>
        <p className="text-xs text-[#586570] mt-3">
          You can still start your day: attendance will be recorded without a start location, and route tracking begins as soon as your device provides a location.
        </p>
      </Sheet>

      <Sheet
        open={confirmEnd}
        title="End your day?"
        onClose={() => setConfirmEnd(false)}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => setConfirmEnd(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={doEnd} loading={busy}>End day</PrimaryButton>
          </div>
        }
      >
        <p className="text-sm text-[#0B1320]">Location tracking will stop and your shift summary will be calculated.</p>
      </Sheet>

      <Sheet open={summary !== null} title="Today's summary" onClose={() => setSummary(null)} footer={<PrimaryButton onClick={() => setSummary(null)}>Done</PrimaryButton>}>
        {summary && (
          <dl className="divide-y divide-[#E2E7EC] text-sm">
            {[
              ['Working time', summary.workingTimeFormatted],
              ['Distance travelled (GPS estimate)', `${summary.distanceKm} km`],
              ['Clients visited', summary.clientsVisited],
              ['Orders booked', summary.ordersCount],
              ['Total sales', inr(summary.totalSales)],
              ['Verified collections', inr(summary.verifiedCollections)],
              ['Pending collections', inr(summary.pendingCollections)],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between py-2.5">
                <dt className="text-[#586570]">{k}</dt>
                <dd className="font-semibold text-[#0B1320]">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Sheet>
    </div>
  );
}
