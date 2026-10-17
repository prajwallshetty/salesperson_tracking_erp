import type { Metadata } from 'next';
import { Suspense } from 'react';
import LoginForm from './LoginForm';
import { devQuickLoginEnabled } from '@/lib/auth/devLogin';

export const metadata: Metadata = { title: 'Sign in' };
// Reads DEV_QUICK_LOGIN at request time, not at build time.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="min-h-[100dvh] bg-[#F5F7F8] flex items-center justify-center p-4">
      <Suspense fallback={null}>
        <LoginForm devQuickLogin={devQuickLoginEnabled()} />
      </Suspense>
    </main>
  );
}
