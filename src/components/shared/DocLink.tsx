'use client';

import React from 'react';
import { isNativeApp } from '@/lib/native/platform';
import { openDocument } from '@/lib/native/documents';

/**
 * Link to a server document (PDF receipt, uploaded file). A normal new-tab link in browsers; in the
 * Android app it opens through the share sheet, because the WebView cannot display PDFs.
 */
export default function DocLink({ href, filename, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; filename?: string }) {
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || !isNativeApp()) return;
        e.preventDefault();
        openDocument(href, filename).catch((err) => window.alert((err as Error).message));
      }}
    >
      {children}
    </a>
  );
}
