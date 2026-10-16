'use client';

import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, KeyRound, Lock, User } from 'lucide-react';
import { BrandMark } from '@/components/shared/Brand';
import { homePathForRole, type Role } from '@/lib/permissions';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';

type Mode = 'PASSWORD' | 'ACCESS_CODE';

/** Only same-origin paths that belong to the signed-in role's interface are honoured. */
function safeNext(next: string | null, role: Role): string {
  const home = homePathForRole(role);
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/api/')) return home;
  const isField = next === '/field' || next.startsWith('/field/') || next.startsWith('/field?');
  return (role === 'SALESPERSON') === isField ? next : home;
}

const DEMO = [
  { label: 'Super Admin', id: 'admin@erp.com', mode: 'PASSWORD' as Mode, secret: 'Password123!' },
  { label: 'Manager', id: 'manager@erp.com', mode: 'PASSWORD' as Mode, secret: 'Password123!' },
  { label: 'Salesperson', id: 'rahul@erp.com', mode: 'PASSWORD' as Mode, secret: 'Password123!' },
  { label: 'Access code', id: 'EMP-001', mode: 'ACCESS_CODE' as Mode, secret: 'RAHUL12345' },
];

const inputCls =
  'w-full pl-9 pr-3 py-2.5 text-base sm:text-sm bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] placeholder:text-[#8C9BA5] focus:ring-2 focus:ring-[#081224]/20 focus:border-[#081224] focus:outline-none';

export default function LoginForm({ showDemo }: { showDemo: boolean }) {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>('PASSWORD');
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState(params.get('expired') ? 'Your session has expired. Please sign in again.' : '');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiJson<{ user: { role: Role } }>(mode === 'PASSWORD' ? '/api/auth/login' : '/api/auth/access-code-login', {
        method: 'POST',
        json: mode === 'PASSWORD' ? { identifier: identifier.trim(), password: secret } : { identifier: identifier.trim(), accessCode: secret.trim().toUpperCase() },
      });
      // Full navigation so the server layout renders with the new session cookie.
      window.location.assign(safeNext(params.get('next'), res.user.role));
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed'));
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white border border-[#CBD2D7] rounded-2xl p-6 sm:p-8">
      <div className="flex flex-col items-center text-center mb-6">
        <BrandMark size={44} />
        <h1 className="text-xl font-bold text-[#0B1320] tracking-tight mt-3">SalesGrid</h1>
        <p className="text-xs text-[#586570] mt-1">Field sales, tracking & collections</p>
      </div>

      <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 p-1 bg-[#F3F5F6] rounded-lg mb-5">
        {(['PASSWORD', 'ACCESS_CODE'] as Mode[]).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setSecret('');
              setError('');
            }}
            className={`py-2 rounded-md text-xs font-semibold transition-colors ${mode === m ? 'bg-white text-[#0B1320] border border-[#CBD2D7]' : 'text-[#586570] hover:text-[#0B1320]'}`}
          >
            {m === 'PASSWORD' ? 'Password' : 'Access code'}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-4 p-3 rounded-lg bg-[#FDF2F2] border border-[#F8C4C4] flex items-start gap-2.5 text-xs text-[#991B1B]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="identifier" className="block text-xs font-semibold text-[#0B1320] mb-1.5">
            {mode === 'PASSWORD' ? 'Email, mobile number or employee code' : 'Employee code or mobile number'}
          </label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
            <input
              id="identifier"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label htmlFor="secret" className="block text-xs font-semibold text-[#0B1320] mb-1.5">
            {mode === 'PASSWORD' ? 'Password' : 'Personal access code'}
          </label>
          <div className="relative">
            {mode === 'PASSWORD' ? (
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
            ) : (
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
            )}
            <input
              id="secret"
              name={mode === 'PASSWORD' ? 'password' : 'access-code'}
              type={mode === 'PASSWORD' ? 'password' : 'text'}
              autoComplete={mode === 'PASSWORD' ? 'current-password' : 'one-time-code'}
              autoCapitalize={mode === 'PASSWORD' ? 'none' : 'characters'}
              required
              value={secret}
              onChange={(e) => setSecret(mode === 'ACCESS_CODE' ? e.target.value.toUpperCase() : e.target.value)}
              className={`${inputCls} ${mode === 'ACCESS_CODE' ? 'font-mono tracking-widest' : ''}`}
            />
          </div>
          {mode === 'ACCESS_CODE' && <p className="text-[11px] text-[#80909D] mt-1.5">Issued by your administrator. Locks for 15 minutes after 5 wrong attempts.</p>}
        </div>
        <button
          type="submit"
          disabled={loading || !identifier.trim() || !secret}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#081224] text-white text-sm font-semibold hover:bg-[#111F36] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in…' : 'Sign in'}
          {!loading && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>

      <p className="text-[11px] text-[#80909D] text-center mt-5">Forgot your password or code? Contact your administrator — they can issue a new access code.</p>

      {showDemo && (
        <div className="mt-6 pt-5 border-t border-[#E2E7EC]">
          <p className="text-[11px] font-semibold text-[#586570] uppercase tracking-wider mb-2 text-center">Demo accounts (seeded data)</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => {
                  setMode(d.mode);
                  setIdentifier(d.id);
                  setSecret(d.secret);
                  setError('');
                }}
                className="p-2 rounded-lg bg-[#F3F5F6] border border-[#CBD2D7] hover:border-[#081224] text-left"
              >
                <p className="text-[11px] font-bold text-[#0B1320]">{d.label}</p>
                <p className="text-[10px] text-[#586570] truncate">{d.id}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
