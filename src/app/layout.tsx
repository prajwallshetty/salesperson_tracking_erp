import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: { default: 'SalesGrid', template: '%s · SalesGrid' },
  description: 'Field sales, GPS tracking, orders and collections — one platform for admins, managers and salespeople.',
  applicationName: 'SalesGrid',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#081224',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F5F7F8] text-[#0B1320] antialiased min-h-screen">{children}</body>
    </html>
  );
}
