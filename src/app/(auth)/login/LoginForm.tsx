'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Building2, KeyRound, Lock, User, ShieldCheck, Briefcase, Smartphone, Zap } from 'lucide-react';
import { BrandMark } from '@/components/shared/Brand';
import { homePathForRole, type Role } from '@/lib/permissions';
import { apiJson, errorMessage, ApiError } from '@/lib/client/apiFetch';
import { forgetQuickAccess, readQuickAccess, saveQuickAccess } from '@/lib/client/quickAccess';
import { isNativeApp } from '@/lib/native/platform';

type Mode = 'PASSWORD' | 'ACCESS_CODE';

/** Only same-origin paths that belong to the signed-in role's interface are honoured. */
function safeNext(next: string | null, role: Role): string {
  const home = homePathForRole(role);
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/api/')) return home;
  const isField = next === '/field' || next.startsWith('/field/') || next.startsWith('/field?');
  return (role === 'SALESPERSON') === isField ? next : home;
}

interface DevAccount {
  id: string;
  name: string;
  role: Role;
  label: string;
}
const ROLE_LABEL: Record<Role, string> = { SUPER_ADMIN: 'Super admin', MANAGER: 'Manager', SALESPERSON: 'Salesperson' };

const inputCls =
  'w-full pl-9 pr-3 py-2.5 text-base sm:text-sm bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] placeholder:text-[#8C9BA5] focus:ring-2 focus:ring-[#000000]/20 focus:border-[#000000] focus:outline-none';

export default function LoginForm({ devQuickLogin }: { devQuickLogin: boolean }) {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>('PASSWORD');
  const [company, setCompany] = useState('');
  const [companyRequired, setCompanyRequired] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [remember, setRemember] = useState(false);
  const [rememberedName, setRememberedName] = useState(false);
  const [error, setError] = useState(params.get('expired') ? 'Your session has expired. Please sign in again.' : '');
  const [loading, setLoading] = useState(false);
  const [devAccounts, setDevAccounts] = useState<DevAccount[]>([]);

  // Quick access: prefill the remembered sign-in name. In the Android app (a personal device)
  // Remember me starts checked; in a browser it starts unchecked unless chosen before.
  useEffect(() => {
    const saved = readQuickAccess();
    if (saved) {
      setMode(saved.mode);
      setCompany(saved.company);
      setIdentifier(saved.identifier);
      setRememberedName(true);
      setRemember(true);
    } else {
      setRemember(isNativeApp());
    }
  }, []);

  // The company code is only asked for when the deployment hosts several companies.
  useEffect(() => {
    apiJson<{ companyRequired: boolean }>('/api/auth/login-config')
      .then((r) => setCompanyRequired(r.companyRequired))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!devQuickLogin) return;
    apiJson<{ data: DevAccount[] }>('/api/auth/dev-login')
      .then((r) => setDevAccounts(r.data))
      .catch(() => setDevAccounts([]));
  }, [devQuickLogin]);

  const finish = (role: Role) => {
    // Full navigation so the server layout renders with the new session cookie.
    window.location.assign(safeNext(params.get('next'), role));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiJson<{ user: { role: Role } }>(mode === 'PASSWORD' ? '/api/auth/login' : '/api/auth/access-code-login', {
        method: 'POST',
        json:
          mode === 'PASSWORD'
            ? { company: company.trim() || undefined, identifier: identifier.trim(), password: secret, remember }
            : { company: company.trim() || undefined, identifier: identifier.trim(), accessCode: secret.trim().toUpperCase(), remember },
      });
      saveQuickAccess({ company: company.trim().toLowerCase(), identifier: identifier.trim(), mode, remember });
      finish(res.user.role);
    } catch (err) {
      // The server asks for a company code when the deployment hosts several companies.
      if (err instanceof ApiError && err.code === 'COMPANY_REQUIRED') setCompanyRequired(true);
      setError(errorMessage(err, 'Sign-in failed'));
      setLoading(false);
    }
  };

  const devSignIn = async (account: DevAccount) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiJson<{ user: { role: Role } }>('/api/auth/dev-login', { method: 'POST', json: { userId: account.id, remember } });
      finish(res.user.role);
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed'));
      setLoading(false);
    }
  };

  const quickDemoSignIn = async (role: Role) => {
    setError('');
    setLoading(true);

    const account = devAccounts.find((a) => a.role === role);
    if (devQuickLogin && account) {
      return devSignIn(account);
    }

    const credentials: Record<Role, { identifier: string; secret: string }> = {
      SUPER_ADMIN: { identifier: 'admin@erp.com', secret: 'Password123!' },
      MANAGER: { identifier: 'manager@erp.com', secret: 'Password123!' },
      SALESPERSON: { identifier: 'rahul@erp.com', secret: 'Password123!' },
    };
    const cred = credentials[role];
    setMode('PASSWORD');
    setIdentifier(cred.identifier);
    setSecret(cred.secret);

    try {
      const res = await apiJson<{ user: { role: Role } }>('/api/auth/login', {
        method: 'POST',
        json: { company: company.trim() || undefined, identifier: cred.identifier, password: cred.secret, remember: true },
      });
      saveQuickAccess({ company: company.trim().toLowerCase(), identifier: cred.identifier, mode: 'PASSWORD', remember: true });
      finish(res.user.role);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COMPANY_REQUIRED') setCompanyRequired(true);
      setError(errorMessage(err, 'Demo sign-in failed'));
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white border border-[#CBD2D7] rounded-2xl p-6 sm:p-8">
      <div className="flex flex-col items-center text-center mb-6">
        <BrandMark size={96} />
        <h1 className="text-xl font-bold text-[#0B1320] tracking-tight mt-3">Bharath Interior Decor</h1>
        <p className="text-xs text-[#586570] mt-1">Field sales, tracking & collections</p>
      </div>

      <div className="mb-5 p-3.5 rounded-xl bg-gradient-to-br from-indigo-50/80 via-white to-sky-50/80 border border-indigo-100/80 shadow-xs">
        <div className="flex items-center justify-between mb-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B1320]">
            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            1-Click Demo Login
          </span>
          <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200/60">
            Instant Access
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => quickDemoSignIn('SUPER_ADMIN')}
            className="flex flex-col items-center justify-center p-2 rounded-lg bg-white border border-indigo-200/70 hover:border-indigo-500 hover:shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="w-7 h-7 rounded-full bg-indigo-100/70 flex items-center justify-center mb-1 group-hover:bg-indigo-600 group-hover:text-white text-indigo-600 transition-colors">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-[#0B1320]">Admin</span>
            <span className="text-[10px] text-[#586570]">Full ERP</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => quickDemoSignIn('MANAGER')}
            className="flex flex-col items-center justify-center p-2 rounded-lg bg-white border border-sky-200/70 hover:border-sky-500 hover:shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="w-7 h-7 rounded-full bg-sky-100/70 flex items-center justify-center mb-1 group-hover:bg-sky-600 group-hover:text-white text-sky-600 transition-colors">
              <Briefcase className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-[#0B1320]">Manager</span>
            <span className="text-[10px] text-[#586570]">Approvals</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => quickDemoSignIn('SALESPERSON')}
            className="flex flex-col items-center justify-center p-2 rounded-lg bg-white border border-emerald-200/70 hover:border-emerald-500 hover:shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="w-7 h-7 rounded-full bg-emerald-100/70 flex items-center justify-center mb-1 group-hover:bg-emerald-600 group-hover:text-white text-emerald-600 transition-colors">
              <Smartphone className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-[#0B1320]">Field Sales</span>
            <span className="text-[10px] text-[#586570]">Mobile App</span>
          </button>
        </div>
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
        {(companyRequired || company) && (
          <div>
            <label htmlFor="company" className="block text-xs font-semibold text-[#0B1320] mb-1.5">
              Company code
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
              <input
                id="company"
                name="organization"
                autoComplete="organization"
                autoCapitalize="none"
                required={companyRequired}
                value={company}
                onChange={(e) => setCompany(e.target.value.toLowerCase())}
                placeholder="e.g. acme"
                className={inputCls}
              />
            </div>
            <p className="text-[11px] text-[#80909D] mt-1.5">Given to you by your administrator.</p>
          </div>
        )}
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
        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-[#0B1320]">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 accent-[#000000]" />
            Remember me
          </label>
          {rememberedName && (
            <button
              type="button"
              onClick={() => {
                forgetQuickAccess();
                setIdentifier('');
                setCompany('');
                setRememberedName(false);
                setRemember(isNativeApp());
              }}
              className="text-[11px] font-semibold text-[#259DC3]"
            >
              Not you?
            </button>
          )}
        </div>
        <p className="text-[11px] text-[#80909D] -mt-2">
          {remember ? 'Stay signed in on this device for 7 days.' : 'You will be signed out when you close the browser or app (at most 12 hours).'}
        </p>
        <button
          type="submit"
          disabled={loading || !identifier.trim() || !secret || (companyRequired && !company.trim())}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#000000] text-white text-sm font-semibold hover:bg-[#111F36] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in…' : 'Sign in'}
          {!loading && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>

      <p className="text-[11px] text-[#80909D] text-center mt-5">Forgot your password or code? Contact your administrator — they can issue a new access code.</p>

      {devQuickLogin && (
        <div className="mt-6 pt-5 border-t border-[#E2E7EC]">
          <p className="text-[11px] font-semibold text-[#586570] uppercase tracking-wider mb-2.5 text-center">Development quick login</p>
          {devAccounts.length === 0 ? (
            <p className="text-[11px] text-[#80909D] text-center">No active accounts in this database.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {devAccounts.map((d) => {
                const badgeStyle =
                  d.role === 'SUPER_ADMIN'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : d.role === 'MANAGER'
                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={loading}
                    onClick={() => devSignIn(d)}
                    className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#CBD2D7] hover:border-[#000000] hover:bg-white hover:shadow-xs transition-all text-left disabled:opacity-50 group cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <p className="text-[11px] font-bold text-[#0B1320] truncate group-hover:text-indigo-600 transition-colors">{d.name}</p>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${badgeStyle} shrink-0`}>
                        {ROLE_LABEL[d.role]}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#586570] truncate">
                      {d.label}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-[#80909D] text-center mt-2.5">Shown because DEV_QUICK_LOGIN=true. Never available in production.</p>
        </div>
      )}
    </div>
  );
}
