'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useField } from '@/features/field/FieldProvider';
import { newId } from '@/features/field/storage';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { EXPENSE_CATEGORIES } from '@/lib/domain/constants';
import { Card, Chip, EmptyState, Field, Notice, PrimaryButton, SecondaryButton, Sheet, SkeletonList, StatusPill, inputClass } from '@/components/sales/mobile';
import FileAttach from '@/components/sales/FileAttach';
import { formatDate, formatDateTime, humanize, inr } from '@/lib/client/format';

const METHODS = ['UPI', 'CASH', 'PERSONAL_CARD', 'COMPANY_CARD'];
const FILTERS = ['ALL', 'SUBMITTED', 'APPROVED', 'REIMBURSED', 'REJECTED', 'DRAFT'];

interface Draft {
  id: string | null;
  category: string;
  amount: string;
  description: string;
  businessPurpose: string;
  merchantName: string;
  paymentMethod: string;
  receiptUrl: string;
}
const emptyDraft = (): Draft => ({ id: null, category: 'AUTO_RICKSHAW', amount: '', description: '', businessPurpose: '', merchantName: '', paymentMethod: 'UPI', receiptUrl: '' });

export default function FieldExpenses() {
  const { submit, online, tracking } = useField();
  const [expenses, setExpenses] = useState<any[] | null>(null);
  const [summary, setSummary] = useState<Record<string, { count: number; totalAmount: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const offlineId = useRef(`exp-${newId()}`);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (filter !== 'ALL') qs.set('status', filter);
      const r = await apiJson<{ data: any[]; summary: any }>(`/api/expenses?${qs}`);
      setExpenses(r.data);
      setSummary(r.summary);
      setError(null);
    } catch (err) {
      setExpenses((e) => e ?? []);
      setError(errorMessage(err));
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (submitNow: boolean) => {
    if (!draft) return;
    setFormError(null);
    const amount = Number(draft.amount);
    if (!amount || amount <= 0) return setFormError('Enter a valid amount greater than zero.');
    if (draft.description.trim().length < 3) return setFormError('Description must be at least 3 characters.');
    setBusy(true);
    const fields = {
      category: draft.category,
      amount,
      description: draft.description.trim(),
      businessPurpose: draft.businessPurpose.trim() || undefined,
      merchantName: draft.merchantName.trim() || undefined,
      paymentMethod: draft.paymentMethod,
      receiptUrl: draft.receiptUrl || undefined,
    };
    try {
      if (draft.id) {
        // Editing a draft or rejected claim requires a connection (server enforces state rules).
        await apiJson(`/api/expenses/${draft.id}`, { method: 'PUT', json: fields });
        if (submitNow) await apiJson(`/api/expenses/${draft.id}/submit`, { method: 'POST', json: {} });
        setNotice({ tone: 'success', text: submitNow ? 'Claim resubmitted for approval.' : 'Draft updated.' });
      } else {
        const fix = tracking.lastFix;
        const res = await submit({
          url: '/api/expenses',
          body: { ...fields, expenseDate: new Date().toISOString(), latitude: fix?.latitude, longitude: fix?.longitude, status: submitNow ? 'SUBMITTED' : 'DRAFT', offlineId: offlineId.current },
          type: 'EXPENSE',
          label: `Expense ${inr(amount)} — ${humanize(draft.category)}`,
          idempotencyKey: offlineId.current,
        });
        if (!res.ok) throw new Error(res.error);
        setNotice(
          res.offline
            ? { tone: 'warning', text: 'No connection — claim saved on this device and will sync automatically.' }
            : { tone: 'success', text: submitNow ? 'Claim submitted for approval.' : 'Draft saved.' }
        );
        offlineId.current = `exp-${newId()}`;
      }
      setDraft(null);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (e: any) => {
    setDetail(e);
    try {
      const r = await apiJson<{ data: any }>(`/api/expenses/${e.id}`);
      setDetail({ ...e, history: r.data.history });
    } catch {
      /* summary view still shown */
    }
  };

  const edit = (e: any) => {
    setDetail(null);
    setFormError(null);
    setDraft({
      id: e.id,
      category: e.category,
      amount: String(e.amount),
      description: e.description || '',
      businessPurpose: e.businessPurpose || '',
      merchantName: e.merchantName || '',
      paymentMethod: e.paymentMethod || 'UPI',
      receiptUrl: e.receiptUrl || '',
    });
  };

  const kpi = (k: string) => summary[k]?.totalAmount ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#0B1320]">Expenses</h1>
          <p className="text-[11px] text-[#586570]">Travel, fuel, meals and other field costs</p>
        </div>
        <button
          onClick={() => {
            setFormError(null);
            setDraft(emptyDraft());
          }}
          className="min-h-[40px] px-4 rounded-xl bg-[#081224] text-white text-xs font-bold"
        >
          + New claim
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ['Pending', kpi('SUBMITTED'), 'text-[#92400E]'],
          ['Approved', kpi('APPROVED'), 'text-[#1E40AF]'],
          ['Reimbursed', kpi('REIMBURSED'), 'text-[#2E6819]'],
        ].map(([label, value, cls]) => (
          <Card key={String(label)} className="p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#80909D]">{label}</p>
            <p className={`text-sm font-bold ${cls}`}>{inr(value)}</p>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f === 'ALL' ? 'All' : humanize(f)}
          </Chip>
        ))}
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {expenses === null ? (
        <SkeletonList />
      ) : expenses.length === 0 ? (
        <EmptyState title="No expense claims" hint="Tap “New claim” to record travel, fuel or meal expenses." />
      ) : (
        <ul className="space-y-3">
          {expenses.map((e) => (
            <li key={e.id}>
              <button className="w-full text-left" onClick={() => openDetail(e)}>
                <Card>
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className="text-sm font-bold">{e.expenseNumber}</p>
                      <p className="text-[11px] text-[#80909D]">{formatDate(e.expenseDate)}</p>
                    </div>
                    <StatusPill status={e.status} />
                  </div>
                  <div className="flex justify-between items-end mt-2 gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">{humanize(e.category)}</p>
                      <p className="text-xs text-[#586570] truncate">{e.description}</p>
                    </div>
                    <p className="text-sm font-bold shrink-0">{inr(e.amount, 2)}</p>
                  </div>
                  {e.status === 'REJECTED' && (
                    <p className="mt-2 text-xs text-[#991B1B] bg-[#FEE2E2] rounded-lg px-2 py-1.5">
                      Rejected: {e.rejectionReason} — tap to edit and resubmit
                    </p>
                  )}
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        title={draft?.id ? 'Edit expense claim' : 'New expense claim'}
        onClose={() => setDraft(null)}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => save(false)} disabled={busy || (Boolean(draft?.id) && !online)}>Save draft</SecondaryButton>
            <PrimaryButton onClick={() => save(true)} loading={busy} disabled={Boolean(draft?.id) && !online}>
              {draft?.id ? 'Resubmit' : 'Submit claim'}
            </PrimaryButton>
          </div>
        }
      >
        {draft && (
          <div className="space-y-4">
            {draft.id && !online && <Notice tone="warning">Editing an existing claim needs a connection.</Notice>}
            <div>
              <p className="text-xs font-semibold mb-1.5">Category</p>
              <div className="flex flex-wrap gap-2">
                {Object.values(EXPENSE_CATEGORIES).map((c) => (
                  <Chip key={c} active={draft.category === c} onClick={() => setDraft({ ...draft, category: c })}>
                    {humanize(c)}
                  </Chip>
                ))}
              </div>
            </div>
            <Field label="Amount (₹)" htmlFor="exp-amount">
              <input id="exp-amount" inputMode="decimal" className={inputClass} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 350" />
            </Field>
            <Field label="Description" htmlFor="exp-desc">
              <input id="exp-desc" className={inputClass} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. Auto fare from client office to depot" />
            </Field>
            <Field label="Business purpose" htmlFor="exp-purpose">
              <input id="exp-purpose" className={inputClass} value={draft.businessPurpose} onChange={(e) => setDraft({ ...draft, businessPurpose: e.target.value })} />
            </Field>
            <Field label="Vendor / merchant" htmlFor="exp-merchant">
              <input id="exp-merchant" className={inputClass} value={draft.merchantName} onChange={(e) => setDraft({ ...draft, merchantName: e.target.value })} />
            </Field>
            <div>
              <p className="text-xs font-semibold mb-1.5">Paid with</p>
              <div className="flex flex-wrap gap-2">
                {METHODS.map((m) => (
                  <Chip key={m} active={draft.paymentMethod === m} onClick={() => setDraft({ ...draft, paymentMethod: m })}>
                    {humanize(m)}
                  </Chip>
                ))}
              </div>
            </div>
            <FileAttach label="Receipt" value={draft.receiptUrl} onChange={(url) => setDraft({ ...draft, receiptUrl: url })} disabled={!online} />
            {formError && <Notice tone="error">{formError}</Notice>}
          </div>
        )}
      </Sheet>

      <Sheet
        open={detail !== null}
        title={detail?.expenseNumber || 'Expense'}
        onClose={() => setDetail(null)}
        footer={
          detail && (detail.status === 'REJECTED' || detail.status === 'DRAFT') ? (
            <PrimaryButton onClick={() => edit(detail)}>{detail.status === 'REJECTED' ? 'Edit and resubmit' : 'Edit draft'}</PrimaryButton>
          ) : (
            <SecondaryButton className="w-full" onClick={() => setDetail(null)}>Close</SecondaryButton>
          )
        }
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <p className="text-xl font-bold">{inr(detail.amount, 2)}</p>
              <StatusPill status={detail.status} />
            </div>
            {detail.status === 'REJECTED' && <Notice tone="error">Manager feedback: {detail.rejectionReason}</Notice>}
            <dl className="divide-y divide-[#E2E7EC]">
              {[
                ['Category', humanize(detail.category)],
                ['Date', formatDate(detail.expenseDate)],
                ['Description', detail.description],
                ['Purpose', detail.businessPurpose],
                ['Merchant', detail.merchantName],
                ['Paid with', humanize(detail.paymentMethod)],
                ['Reimbursement', detail.reimbursementRef ? `${detail.reimbursementMethod} · ${detail.reimbursementRef}` : null],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between gap-4 py-2">
                    <dt className="text-[#586570] shrink-0">{k}</dt>
                    <dd className="text-right break-words">{v}</dd>
                  </div>
                ))}
            </dl>
            {detail.receiptUrl && (
              <a href={detail.receiptUrl} target="_blank" rel="noopener noreferrer" className="block text-[#259DC3] font-semibold">
                View attached receipt
              </a>
            )}
            {detail.history?.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#80909D] mb-1">History</p>
                <ol className="space-y-1.5">
                  {detail.history.map((h: any) => (
                    <li key={h.id} className="text-xs">
                      <span className="font-semibold">{humanize(h.action)}</span> · {formatDateTime(h.createdAt)}
                      {h.comment && <span className="block text-[#586570]">{h.comment}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
