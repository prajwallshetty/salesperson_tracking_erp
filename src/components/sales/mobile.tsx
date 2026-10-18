'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { pushOverlay } from '@/lib/client/overlayStack';

/** Bottom sheet dialog (full-height on phones, centred card on larger screens). */
export function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const popOverlay = pushOverlay(onClose); // Android back button closes the sheet
    return () => {
      popOverlay();
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-[#0B1320]/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full sm:max-w-lg max-h-[92dvh] bg-white rounded-t-2xl sm:rounded-2xl flex flex-col outline-none"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E7EC]">
          <h2 className="text-sm font-bold text-[#0B1320]">{title}</h2>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg hover:bg-[#F3F5F6]" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-[#E2E7EC] pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function PrimaryButton({ children, loading, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-[#000000] text-white text-sm font-semibold hover:bg-[#111F36] disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-white border border-[#CBD2D7] text-[#0B1320] text-sm font-semibold hover:bg-[#F3F5F6] disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-[#0B1320]">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[#80909D]">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'w-full min-h-[44px] px-3 py-2 text-base bg-white border border-[#CBD2D7] rounded-xl text-[#0B1320] placeholder:text-[#8C9BA5] focus:outline-none focus:ring-2 focus:ring-[#000000]/20 focus:border-[#000000]';

export function Chip({ active, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...rest}
      className={`shrink-0 min-h-[36px] px-3 rounded-full text-xs font-semibold border ${active ? 'bg-[#000000] text-white border-[#000000]' : 'bg-white text-[#586570] border-[#CBD2D7]'}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-[#CBD2D7] rounded-2xl p-4 ${className}`}>{children}</div>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-10 px-6">
      <p className="text-sm font-semibold text-[#0B1320]">{title}</p>
      {hint && <p className="text-xs text-[#586570] mt-1">{hint}</p>}
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-24 rounded-2xl bg-white border border-[#E2E7EC] animate-pulse" />
      ))}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success' | 'warning'; children: React.ReactNode }) {
  const cls = {
    info: 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E3A8A]',
    error: 'bg-[#FDF2F2] border-[#F8C4C4] text-[#991B1B]',
    success: 'bg-[#E6F4DD] border-[#D4AF37] text-[#2E6819]',
    warning: 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`text-xs rounded-xl border px-3 py-2.5 ${cls}`}>
      {children}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    CONFIRMED: 'bg-[#E6F4DD] text-[#2E6819] border-[#D4AF37]',
    DELIVERED: 'bg-[#E6F4DD] text-[#2E6819] border-[#D4AF37]',
    VERIFIED: 'bg-[#E6F4DD] text-[#2E6819] border-[#D4AF37]',
    REIMBURSED: 'bg-[#E6F4DD] text-[#2E6819] border-[#D4AF37]',
    COMPLETED: 'bg-[#E6F4DD] text-[#2E6819] border-[#D4AF37]',
    APPROVED: 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]',
    PROCESSING: 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]',
    DISPATCHED: 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]',
    SUBMITTED: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
    PENDING: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
    ON_DUTY: 'bg-[#E6F4DD] text-[#2E6819] border-[#D4AF37]',
    REJECTED: 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]',
    CANCELLED: 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]',
    FAILED: 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${map[status] || 'bg-[#F3F5F6] text-[#4B5563] border-[#E5E7EB]'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
