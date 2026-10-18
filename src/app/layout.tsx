import './globals.css';
import type { Metadata, Viewport } from 'next';
import NativeShell from '@/components/native/NativeShell';

export const metadata: Metadata = {
  title: { default: 'Bharath Interior Decor', template: '%s · Bharath Interior Decor' },
  description: 'Field sales, GPS tracking, orders and collections — one platform for admins, managers and salespeople.',
  applicationName: 'Bharath Interior Decor',
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: 'Bharath Interior Decor',
    title: 'Bharath Interior Decor',
    description: 'Field sales, GPS tracking, orders and collections.',
  },
  appleWebApp: { capable: true, title: 'Bharath Interior Decor', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F5F7F8] text-[#0B1320] antialiased min-h-screen">
        {children}
        <NativeShell />
      </body>
    </html>
  );
}
