'use client';

import React, { useId, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { uploadFile } from '@/lib/client/upload';
import DocLink from '@/components/shared/DocLink';

/** Camera/file picker that uploads immediately; the stored URL is what gets submitted. */
export default function FileAttach({ label, value, onChange, disabled }: { label: string; value: string; onChange: (url: string) => void; disabled?: boolean }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    setError(null);
    const r = await uploadFile(f);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onChange(r.url);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-[#0B1320]">{label}</p>
      {value ? (
        <div className="flex items-center justify-between rounded-xl border border-[#B4E39C] bg-[#E6F4DD] px-3 py-2 text-xs text-[#2E6819]">
          <DocLink href={value} className="underline font-semibold">Attached — view</DocLink>
          <button type="button" onClick={() => onChange('')} className="font-semibold">Remove</button>
        </div>
      ) : (
        <label htmlFor={id} className={`flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-dashed border-[#A9B5BE] text-xs font-semibold text-[#0B1320] ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-[#F3F5F6]'}`}>
          <Paperclip className="w-4 h-4" />
          {busy ? 'Uploading…' : 'Take photo or choose file'}
          <input id={id} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={onFile} disabled={disabled || busy} />
        </label>
      )}
      {error && <p role="alert" className="text-[11px] text-[#991B1B]">{error}</p>}
      {disabled && !value && <p className="text-[11px] text-[#80909D]">Attachments need a connection. You can save now and attach later.</p>}
    </div>
  );
}
