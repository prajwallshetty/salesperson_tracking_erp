'use client';

import { isNativeApp } from './platform';

/**
 * Opens a server document (receipt PDF, CSV export, uploaded receipt/proof).
 * Browser: a new tab, as before. Android app: the WebView cannot show PDFs or handle downloads, so
 * the file is fetched with the session cookie, written to the app cache and handed to the Android
 * share sheet ("Open with" a PDF viewer, Drive, WhatsApp…). Throws with the server's message on error.
 */
export async function openDocument(url: string, fallbackName = 'document'): Promise<void> {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    window.location.assign(`/login?expired=1&next=${encodeURIComponent(window.location.pathname)}`);
    return;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not open the document (HTTP ${res.status}).`);
  }
  const name = fileNameFrom(res.headers.get('content-disposition')) || fallbackName;
  await shareBlob(await res.blob(), name);
}

/** Saves text generated in the page (e.g. a CSV export) — download in a browser, share sheet in the app. */
export async function saveTextFile(content: string, filename: string, mime = 'text/csv;charset=utf-8'): Promise<void> {
  const blob = new Blob([content], { type: mime });
  if (!isNativeApp()) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return;
  }
  await shareBlob(blob, filename);
}

async function shareBlob(blob: Blob, name: string) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const data = await blobToBase64(blob);
  const safe = name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'document';
  const written = await Filesystem.writeFile({ path: `documents/${safe}`, data, directory: Directory.Cache, recursive: true });
  await Share.share({ title: safe, files: [written.uri], dialogTitle: 'Open or share' });
}

function fileNameFrom(disposition: string | null): string | null {
  const m = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}
