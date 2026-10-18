'use client';

import React, { useState } from 'react';
import { Download, Eye, Mail, MessageCircle, Printer, Share2 } from 'lucide-react';
import { isNativeApp } from '@/lib/native/platform';
import { openDocument } from '@/lib/native/documents';
import { inr, whatsappNumber } from './format';

interface Props {
  /** e.g. /api/invoices/<id>/pdf */
  pdfPath: string;
  filename: string;
  /** "Invoice INV-0001" — used in the share message. */
  label: string;
  customerName: string;
  phone?: string | null;
  email?: string | null;
  total: number;
  businessName: string;
}

const linkCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#CBD2D7] bg-white text-xs font-medium text-[#0B1320] hover:bg-[#F3F5F6] disabled:opacity-50';

/**
 * PDF preview / download / print / share for a saved document. The PDF is always rendered by the server
 * from the saved record. WhatsApp and email here are *manual* sharing: in a browser they open a prefilled
 * message (attach the downloaded PDF yourself); in the Android app the system share sheet sends the PDF
 * file itself to WhatsApp, email or any other app. No message is sent automatically.
 */
export default function PdfActions({ pdfPath, filename, label, customerName, phone, email, total, businessName }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const native = typeof window !== 'undefined' && isNativeApp();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || 'Could not open the PDF');
    } finally {
      setBusy(false);
    }
  };

  const preview = () => run(() => openDocument(pdfPath, filename));
  const download = () => run(() => openDocument(`${pdfPath}${pdfPath.includes('?') ? '&' : '?'}download=1`, filename));

  const print = () =>
    run(async () => {
      if (native) return openDocument(pdfPath, filename); // the share sheet offers the system print service
      const res = await fetch(pdfPath, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Could not load the PDF to print');
      const url = URL.createObjectURL(await res.blob());
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      frame.src = url;
      frame.onload = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 60_000);
      };
      document.body.appendChild(frame);
    });

  const message = `Hello ${customerName}, please find ${label} from ${businessName} for ${inr(total)}.`;
  const wa = `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`;
  const mail = `mailto:${email ?? ''}?subject=${encodeURIComponent(`${label} — ${businessName}`)}&body=${encodeURIComponent(`${message}\n\n(Attach the downloaded PDF.)`)}`;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={linkCls} onClick={preview} disabled={busy}>
          <Eye className="w-3.5 h-3.5" /> {native ? 'Open PDF' : 'Preview'}
        </button>
        <button type="button" className={linkCls} onClick={download} disabled={busy}>
          <Download className="w-3.5 h-3.5" /> {native ? 'Save / share PDF' : 'Download'}
        </button>
        <button type="button" className={linkCls} onClick={print} disabled={busy}>
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
        {native ? (
          <button type="button" className={linkCls} onClick={download} disabled={busy}>
            <Share2 className="w-3.5 h-3.5" /> WhatsApp / Email
          </button>
        ) : (
          <>
            <a className={linkCls} href={wa} target="_blank" rel="noopener noreferrer" title="Opens WhatsApp with a message. Attach the downloaded PDF.">
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
            <a className={linkCls} href={mail} title="Opens your email app with a message. Attach the downloaded PDF.">
              <Mail className="w-3.5 h-3.5" /> Email
            </a>
          </>
        )}
      </div>
      {error && <p className="text-xs text-[#991B1B] mt-2" role="alert">{error}</p>}
    </div>
  );
}
