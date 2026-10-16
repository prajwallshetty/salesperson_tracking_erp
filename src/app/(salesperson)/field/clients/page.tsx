'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Navigation, Phone, Search } from 'lucide-react';
import { useSession } from '@/components/shared/SessionProvider';
import { useField } from '@/features/field/FieldProvider';
import { enqueue } from '@/features/field/outbox';
import { newId, readJson, writeJson } from '@/features/field/storage';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { calculateHaversineDistanceMeters } from '@/lib/domain/geo';
import { VISIT_OUTCOMES } from '@/lib/domain/constants';
import { Card, Chip, EmptyState, Field, Notice, PrimaryButton, SecondaryButton, Sheet, SkeletonList, inputClass } from '@/components/sales/mobile';
import { formatAge, formatTime, humanize, inr } from '@/lib/client/format';

interface ActiveVisit {
  visitId: string;
  local: boolean;
  clientId: string;
  clientName: string;
  startedAt: string;
  distanceMeters: number | null;
  isException: boolean;
}

const fmtDistance = (m?: number | null) => (m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

export default function FieldClients() {
  const { user } = useSession();
  const { tracking, currentFix, settings, submit, syncNow } = useField();
  const userId = user!.id;
  const visitKey = `sg_visit_${userId}`;
  const cacheKey = `sg_cache_${userId}_clients`;

  const [clients, setClients] = useState<any[] | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [active, setActive] = useState<ActiveVisit | null>(null);

  // Start-visit sheet state
  const [visitClient, setVisitClient] = useState<any | null>(null);
  const [evidence, setEvidence] = useState<{ distance: number | null; accuracy: number | null; lat?: number; lng?: number; error?: string } | null>(null);
  const [exceptionReason, setExceptionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  // Complete-visit sheet state
  const [completing, setCompleting] = useState(false);
  const [outcome, setOutcome] = useState<string>('ORDER_TAKEN');
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);

  const radius = Number(settings.visit_radius_meters || 100);

  const load = useCallback(async () => {
    setLoadError(null);
    const fix = tracking.lastFix;
    const qs = new URLSearchParams({ limit: '500' });
    if (fix) {
      qs.set('lat', String(fix.latitude));
      qs.set('lng', String(fix.longitude));
    }
    try {
      const res = await apiJson<{ data: any[] }>(`/api/clients?${qs}`);
      setClients(res.data);
      setCachedAt(null);
      writeJson(cacheKey, { at: new Date().toISOString(), data: res.data });
    } catch (err) {
      const cached = readJson<{ at: string; data: any[] } | null>(cacheKey, null);
      if (cached) {
        setClients(cached.data);
        setCachedAt(cached.at);
      } else setClients([]);
      setLoadError(errorMessage(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  useEffect(() => {
    load();
    setActive(readJson<ActiveVisit | null>(visitKey, null));
  }, [load, visitKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clients || []).filter((c) => {
      const match = !q || [c.name, c.contactPerson, c.city, c.phone].some((v: string) => v?.toLowerCase().includes(q));
      return match && (!dueOnly || c.currentOutstanding > 0);
    });
  }, [clients, search, dueOnly]);

  const openStartVisit = async (client: any) => {
    setVisitClient(client);
    setEvidence(null);
    setExceptionReason('');
    setSheetError(null);
    const { fix, error } = await currentFix();
    if (!fix) return setEvidence({ distance: null, accuracy: null, error: error || 'Location unavailable' });
    setEvidence({
      distance: calculateHaversineDistanceMeters(fix.latitude, fix.longitude, client.latitude, client.longitude),
      accuracy: fix.accuracy,
      lat: fix.latitude,
      lng: fix.longitude,
    });
  };

  const breach = evidence?.distance != null && evidence.distance > radius;

  const confirmStart = async () => {
    if (!visitClient || evidence?.lat == null || evidence.lng == null) return;
    if (breach && exceptionReason.trim().length < 3) return setSheetError('Please explain why you are outside the visit radius.');
    setBusy(true);
    const localVisitId = `lv-${newId()}`;
    const body = {
      clientId: visitClient.id,
      latitude: evidence.lat,
      longitude: evidence.lng,
      isException: breach,
      exceptionReason: breach ? exceptionReason.trim() : undefined,
      localVisitId,
      startedAt: new Date().toISOString(),
    };
    const res = await submit<{ data: { visitId: string; distanceMeters: number; isException: boolean } }>({
      url: '/api/visits/start',
      body,
      type: 'VISIT_START',
      label: `Visit start — ${visitClient.name}`,
      idempotencyKey: `visit-start-${localVisitId}`,
    });
    setBusy(false);
    if (!res.ok) return setSheetError(res.error);
    const visit: ActiveVisit = res.offline
      ? { visitId: localVisitId, local: true, clientId: visitClient.id, clientName: visitClient.name, startedAt: body.startedAt, distanceMeters: evidence.distance, isException: breach }
      : {
          visitId: res.data!.data.visitId,
          local: false,
          clientId: visitClient.id,
          clientName: visitClient.name,
          startedAt: body.startedAt,
          distanceMeters: res.data!.data.distanceMeters,
          isException: res.data!.data.isException,
        };
    writeJson(visitKey, visit);
    setActive(visit);
    setVisitClient(null);
    setToast(res.offline ? { tone: 'warning', text: 'Offline — visit start saved on device and will sync.' } : { tone: 'success', text: `Visit started at ${visitClient.name}.` });
  };

  const completeVisit = async () => {
    if (!active) return;
    setBusy(true);
    setSheetError(null);
    const body = { outcome, notes: notes.trim() || undefined, endedAt: new Date().toISOString() };
    let offline = false;
    if (active.local) {
      // The visit itself is still queued: the end must be queued after it (same order on sync).
      enqueue(userId, 'VISIT_END', { ...body, visitId: active.visitId }, `Visit end — ${active.clientName}`, `visit-end-${newId()}`);
      offline = true;
      syncNow();
    } else {
      const res = await submit({ url: `/api/visits/${active.visitId}/end`, body: { ...body, visitId: active.visitId }, type: 'VISIT_END', label: `Visit end — ${active.clientName}`, idempotencyKey: `visit-end-${newId()}` });
      if (!res.ok) {
        setBusy(false);
        return setSheetError(res.error);
      }
      offline = res.offline;
    }
    setBusy(false);
    writeJson(visitKey, null);
    const done = active;
    setActive(null);
    setCompleting(false);
    setNotes('');
    setToast(offline ? { tone: 'warning', text: 'Offline — visit outcome saved and will sync.' } : { tone: 'success', text: `Visit to ${done.clientName} recorded.` });
  };

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-[#0B1320]">My clients</h1>

      {active && (
        <Card className="border-[#081224]">
          <p className="text-[11px] font-bold tracking-wider text-[#80909D] uppercase">Visit in progress</p>
          <p className="text-sm font-bold text-[#0B1320] mt-0.5">{active.clientName}</p>
          <p className="text-xs text-[#586570]">
            Started {formatTime(active.startedAt)}
            {active.distanceMeters != null && ` · ${fmtDistance(active.distanceMeters)} from client`}
            {active.isException && ' · outside radius'}
            {active.local && ' · pending sync'}
          </p>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <Link href={`/field/orders?new=1&clientId=${active.clientId}`} className="min-h-[44px] flex items-center justify-center rounded-xl border border-[#CBD2D7] text-xs font-semibold">Order</Link>
            <Link href={`/field/collect?clientId=${active.clientId}`} className="min-h-[44px] flex items-center justify-center rounded-xl border border-[#CBD2D7] text-xs font-semibold">Collect</Link>
            <PrimaryButton onClick={() => setCompleting(true)} className="text-xs">Complete</PrimaryButton>
          </div>
        </Card>
      )}

      {toast && <Notice tone={toast.tone}>{toast.text}</Notice>}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
          <input aria-label="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, contact, city" className={`${inputClass} pl-9`} />
        </div>
        <Chip active={dueOnly} onClick={() => setDueOnly(!dueOnly)}>Due balances</Chip>
      </div>

      {cachedAt && <Notice tone="warning">Showing clients saved {formatAge(cachedAt)} — {loadError}</Notice>}
      {!cachedAt && loadError && <Notice tone="error">{loadError}</Notice>}

      {clients === null ? (
        <SkeletonList />
      ) : filtered.length === 0 ? (
        <EmptyState title={clients.length ? 'No clients match your search' : 'No clients assigned yet'} hint={clients.length ? undefined : 'Your manager assigns clients to you from the console.'} />
      ) : (
        <ul className="space-y-3">
          {filtered.map((c) => (
            <li key={c.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0B1320] truncate">{c.name}</p>
                    <p className="text-xs text-[#586570] truncate">{c.contactPerson} · {c.phone}</p>
                  </div>
                  {c.distanceMeters != null && <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F3F5F6] border border-[#E2E7EC]">{fmtDistance(c.distanceMeters)}</span>}
                </div>
                <p className="text-xs text-[#586570] mt-1">{c.address}, {c.city}</p>
                <div className="flex justify-between items-center mt-2 text-xs">
                  <span className="text-[#586570]">Outstanding</span>
                  <span className={`font-bold ${c.currentOutstanding > 0 ? 'text-[#92400E]' : 'text-[#0B1320]'}`}>{inr(c.currentOutstanding)}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <a href={`tel:${c.phone}`} className="min-h-[44px] flex flex-col items-center justify-center rounded-xl border border-[#CBD2D7] text-[11px] font-semibold" aria-label={`Call ${c.name}`}>
                    <Phone className="w-4 h-4" />Call
                  </a>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] flex flex-col items-center justify-center rounded-xl border border-[#CBD2D7] text-[11px] font-semibold"
                    aria-label={`Navigate to ${c.name}`}
                  >
                    <Navigation className="w-4 h-4" />Navigate
                  </a>
                  <Link href={`/field/orders?new=1&clientId=${c.id}`} className="min-h-[44px] flex items-center justify-center rounded-xl border border-[#CBD2D7] text-[11px] font-semibold">Order</Link>
                  <button
                    onClick={() => openStartVisit(c)}
                    disabled={Boolean(active)}
                    title={active ? 'Complete the current visit first' : undefined}
                    className="min-h-[44px] rounded-xl bg-[#081224] text-white text-[11px] font-semibold disabled:opacity-40"
                  >
                    Visit
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={visitClient !== null}
        title={`Start visit — ${visitClient?.name || ''}`}
        onClose={() => setVisitClient(null)}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => setVisitClient(null)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={confirmStart} loading={busy} disabled={evidence?.lat == null}>Begin visit</PrimaryButton>
          </div>
        }
      >
        <p className="text-[11px] font-bold tracking-wider text-[#80909D] uppercase">GPS verification</p>
        {!evidence ? (
          <p className="text-sm text-[#586570] mt-2">Getting your location…</p>
        ) : evidence.error ? (
          <div className="mt-2 space-y-2">
            <Notice tone="error">{evidence.error}</Notice>
            <p className="text-xs text-[#586570]">A visit needs your real location as evidence. Enable location and try again.</p>
            <SecondaryButton onClick={() => openStartVisit(visitClient)}>Retry location</SecondaryButton>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-[#0B1320]">
              You are <strong>{fmtDistance(evidence.distance)}</strong> from the client&apos;s registered location
              {evidence.accuracy != null && <span className="text-[#586570]"> (GPS accuracy ±{Math.round(evidence.accuracy)} m)</span>}.
            </p>
            {breach ? (
              <>
                <Notice tone="warning">This is outside the allowed {radius} m visit radius. The visit will be flagged as an exception for review.</Notice>
                <Field label="Reason (required)" htmlFor="exception">
                  <input id="exception" className={inputClass} value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} placeholder="e.g. Met at the client's warehouse" />
                </Field>
              </>
            ) : (
              <Notice tone="success">Within the {radius} m client radius.</Notice>
            )}
          </div>
        )}
        {sheetError && <div className="mt-3"><Notice tone="error">{sheetError}</Notice></div>}
      </Sheet>

      <Sheet
        open={completing}
        title={`Complete visit — ${active?.clientName || ''}`}
        onClose={() => setCompleting(false)}
        footer={<PrimaryButton onClick={completeVisit} loading={busy}>Record visit</PrimaryButton>}
      >
        <p className="text-xs font-semibold text-[#0B1320] mb-2">Outcome</p>
        <div className="flex flex-wrap gap-2">
          {Object.values(VISIT_OUTCOMES).map((o) => (
            <Chip key={o} active={outcome === o} onClick={() => setOutcome(o)}>{humanize(o)}</Chip>
          ))}
        </div>
        <div className="mt-4">
          <Field label="Notes & follow-up" htmlFor="visit-notes">
            <textarea id="visit-notes" rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Discussion, requirements, next follow-up date…" />
          </Field>
        </div>
        {sheetError && <div className="mt-3"><Notice tone="error">{sheetError}</Notice></div>}
      </Sheet>
    </div>
  );
}
