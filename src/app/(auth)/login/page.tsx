import type { Metadata } from 'next';
import { Suspense } from 'react';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="min-h-[100dvh] bg-[#F5F7F8] flex items-center justify-center p-4">
      <Suspense fallback={null}>
        <LoginForm showDemo={process.env.SHOW_DEMO_LOGINS === 'true'} />
      </Suspense>
    </main>
  );
}
