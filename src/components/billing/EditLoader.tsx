'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import DocumentEditor, { type DocKind } from './DocumentEditor';

/** Loads a saved document and opens it in the editor — only drafts can be edited. */
export default function EditLoader({ kind, id }: { kind: DocKind; id: string }) {
  const base = kind === 'quotation' ? 'quotations' : 'invoices';
  const [doc, setDoc] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiJson<{ data: any }>(`/api/${base}/${id}`).then((r) => setDoc(r.data)).catch((e) => setError(errorMessage(e)));
  }, [base, id]);
  if (error) return <p role="alert" className="text-sm text-[#991B1B]">{error}</p>;
  if (!doc) return <p className="text-sm text-[#80909D]">Loading…</p>;
  if (doc.status !== 'DRAFT') {
    return (
      <div className="max-w-xl bg-white border border-[#CBD2D7] rounded-xl p-5 text-sm">
        <p className="font-semibold text-[#0B1320]">This {kind} can no longer be edited.</p>
        <p className="text-[#586570] mt-1">
          {kind === 'quotation' ? 'Sent quotations are kept as they were. Use “Revise” to create a new editable revision.' : 'Issued invoices are never changed. Use “Correct invoice” to cancel it and open an editable copy.'}
        </p>
        <Link className="underline mt-3 inline-block" href={`/${base}/${id}`}>Back to the {kind}</Link>
      </div>
    );
  }
  return <DocumentEditor kind={kind} initial={doc} />;
}
