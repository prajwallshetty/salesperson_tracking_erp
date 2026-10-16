'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, User, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/ui/Button';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('admin@erp.com');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuth();

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      login(data.token, data.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Unable to connect to ERP server');
    } finally {
      setLoading(false);
    }
  };

  const setDemoCredentials = (id: string) => {
    setIdentifier(id);
    setPassword('Password123!');
  };

  return (
    <div className="min-h-screen bg-[#F5F7F8] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#CBD2D7] rounded-xl shadow-none p-8">
        {/* Brand Block */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-[#081224] flex items-center justify-center text-white mb-3">
            <div className="w-5 h-5 border-2 border-white/90 rounded-[3px] flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-[#B4E39C] rounded-[1px]" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-[#0B1320] tracking-tight">FieldTrack ERP</h1>
          <p className="text-xs text-[#586570] mt-1">Sales Management & GPS Tracking Suite</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-[#FDF2F2] border border-[#F8C4C4] flex items-start gap-2.5 text-xs text-[#991B1B]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#0B1320] mb-1.5">
              Employee Code, Mobile, or Email
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin@erp.com"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0B1320] mb-1.5">
              Security Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={loading}
              className="w-full py-2.5"
              icon={<ArrowRight className="w-4 h-4" />}
            >
              {loading ? 'Authenticating...' : 'Sign In to Workspace'}
            </Button>
          </div>
        </form>

        {/* Demo Credentials Quick-Fill */}
        <div className="mt-8 pt-6 border-t border-[#E2E7EC]">
          <p className="text-[11px] font-semibold text-[#586570] uppercase tracking-wider mb-2.5 text-center">
            Quick-Fill Seed Accounts
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDemoCredentials('admin@erp.com')}
              className="p-2 rounded-lg bg-[#F3F5F6] border border-[#CBD2D7] hover:border-[#081224] text-left transition-colors"
            >
              <p className="text-[11px] font-bold text-[#0B1320]">Super Admin</p>
              <p className="text-[10px] text-[#586570]">Full organization</p>
            </button>
            <button
              type="button"
              onClick={() => setDemoCredentials('manager@erp.com')}
              className="p-2 rounded-lg bg-[#F3F5F6] border border-[#CBD2D7] hover:border-[#081224] text-left transition-colors"
            >
              <p className="text-[11px] font-bold text-[#0B1320]">Team Manager</p>
              <p className="text-[10px] text-[#586570]">Mangalore cluster</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
