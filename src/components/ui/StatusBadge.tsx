import React from 'react';

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export default function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  const norm = (status || '').toUpperCase();
  const text = label || norm.replace(/_/g, ' ');

  let styles = 'bg-[#F3F5F6] text-[#586570] border-[#CBD2D7]';

  if (['VERIFIED', 'COMPLETED', 'ON_DUTY', 'DELIVERED', 'CONFIRMED', 'ACTIVE', 'ORDER_TAKEN', 'PAID', 'ACCEPTED'].includes(norm)) {
    styles = 'bg-[#F6EBC8] text-[#6B5413] border-[#D4AF37]';
  } else if (['PENDING', 'SUBMITTED', 'DRAFT', 'FOLLOW_UP_REQUIRED'].includes(norm)) {
    styles = 'bg-[#F3F5F6] text-[#475569] border-[#CBD2D7]';
  } else if (['PROCESSING', 'DISPATCHED', 'SYNCING', 'PAYMENT_COLLECTED', 'SENT', 'ISSUED'].includes(norm)) {
    styles = 'bg-[#EBF5FA] text-[#1E738E] border-[#BCE1EE]';
  } else if (['REJECTED', 'CANCELLED', 'OFF_DUTY', 'FAILED', 'INACTIVE', 'CLIENT_CLOSED', 'OVERDUE', 'EXPIRED', 'VOIDED'].includes(norm)) {
    styles = 'bg-[#FDF2F2] text-[#991B1B] border-[#F8C4C4]';
  }

  if (norm === 'PARTIALLY_PAID') styles = 'bg-[#FFF7E0] text-[#8A5A00] border-[#F0D58C]';

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${styles} ${className}`}
    >
      {text}
    </span>
  );
}
