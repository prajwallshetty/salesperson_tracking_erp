'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuth } from '@/context/AuthContext';

export default function AdminShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7F8]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-[#081224] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-[#586570] font-medium">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen flex bg-[#F5F7F8]">
      <Sidebar />
      <div className="flex-1 flex flex-col pl-[236px] min-w-0">
        <Header title={title} />
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
