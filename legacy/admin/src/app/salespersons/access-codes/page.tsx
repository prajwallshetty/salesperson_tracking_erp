'use client';

import React, { useState, useEffect } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import { useAuth } from '@/context/AuthContext';
import {
  KeyRound,
  ShieldAlert,
  Copy,
  Check,
  RotateCcw,
  Ban,
  Clock,
  User,
  Search,
  AlertTriangle,
  Lock,
  Calendar,
  Sparkles,
  Info,
} from 'lucide-react';

export default function AccessCodesPage() {
  const { token, user } = useAuth();
  const [accessCodes, setAccessCodes] = useState<any[]>([]);
  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Generation Modal
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(30);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // One-time delivery display modal
  const [oneTimeCodeData, setOneTimeCodeData] = useState<{
    code: string;
    userName: string;
    employeeCode: string;
    expiresAt?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Revoke modal
  const [revokeTarget, setRevokeTarget] = useState<any | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  const fetchData = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const [codesRes, spRes] = await Promise.all([
        fetch('/api/access-codes', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/salespersons?limit=100', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (codesRes.ok) {
        const cData = await codesRes.json();
        setAccessCodes(cData.data || []);
      }

      if (spRes.ok) {
        const sData = await spRes.json();
        setSalespersons(sData.data || []);
      }
    } catch (err) {
      console.error('Failed to load access codes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  // Handle Generate
  const handleGenerate = async () => {
    if (!selectedUserId) {
      setGenerateError('Please select a staff member.');
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch('/api/access-codes/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: selectedUserId,
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setGenerateError(data.error || 'Failed to generate code');
      } else {
        setShowGenerateModal(false);
        setOneTimeCodeData({
          code: data.plainAccessCode,
          userName: data.userName,
          employeeCode: data.employeeCode,
          expiresAt: data.expiresAt,
        });
        setSelectedUserId('');
        fetchData();
      }
    } catch (err: any) {
      setGenerateError(err.message || 'Connection error');
    } finally {
      setGenerating(false);
    }
  };

  // Handle Revoke
  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch('/api/access-codes/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          codeId: revokeTarget.id,
          reason: revokeReason.trim() || undefined,
        }),
      });

      if (res.ok) {
        setRevokeTarget(null);
        setRevokeReason('');
        fetchData();
      }
    } catch (err) {
      console.error('Failed to revoke code:', err);
    } finally {
      setRevoking(false);
    }
  };

  // Copy code to clipboard
  const handleCopyCode = () => {
    if (!oneTimeCodeData) return;
    navigator.clipboard.writeText(oneTimeCodeData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const filteredCodes = accessCodes.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = item.user?.name?.toLowerCase() || '';
    const empCode = item.user?.salespersonProfile?.employeeCode?.toLowerCase() || '';
    const phone = item.user?.phone?.toLowerCase() || '';
    return name.includes(q) || empCode.includes(q) || phone.includes(q);
  });

  return (
    <AdminShell title="Salesperson Access Codes">
      <div className="space-y-6">
        {/* Security Overview Header */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-[#0B1320]" />
              <h3 className="text-base font-bold text-[#0B1320]">Single-Employee Access Codes</h3>
            </div>
            <p className="text-xs text-[#586570] max-w-2xl">
              Cryptographically unique credentials for field staff mobile login. Each code is one-way hashed with bcrypt, bounded by rate-limiting, and automatically locks after 5 consecutive failed attempts.
            </p>
          </div>

          <button
            onClick={() => {
              setShowGenerateModal(true);
              setGenerateError(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#081224] text-white rounded-lg hover:bg-black transition-colors shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#B4E39C]" />
            <span>Generate New Access Code</span>
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] p-4 flex items-center justify-between">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#8C9BA5]" />
            <input
              type="text"
              placeholder="Search by staff name, employee code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:outline-none focus:border-[#081224]"
            />
          </div>
          <span className="text-xs text-[#586570] font-medium">
            Showing {filteredCodes.length} active and historic credentials
          </span>
        </div>

        {/* Credentials Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F5F7F8] border-b border-[#CBD2D7] text-[#586570] font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4">Salesperson</th>
                  <th className="py-3.5 px-4">Employee ID / Phone</th>
                  <th className="py-3.5 px-4">Code Hint</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Issued At</th>
                  <th className="py-3.5 px-4">Expires At</th>
                  <th className="py-3.5 px-4">Last Login</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CBD2D7]/60">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-[#586570]">
                      Loading access credentials...
                    </td>
                  </tr>
                ) : filteredCodes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center">
                      <div className="w-12 h-12 rounded-full bg-[#F5F7F8] border border-[#CBD2D7] flex items-center justify-center mx-auto text-[#8C9BA5] mb-2">
                        <KeyRound className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-[#0B1320]">No access codes found</p>
                      <p className="text-xs text-[#586570] mt-0.5">Click "Generate New Access Code" to grant a staff member mobile login access.</p>
                    </td>
                  </tr>
                ) : (
                  filteredCodes.map((item) => {
                    const isLocked = item.lockedUntil && new Date(item.lockedUntil) > new Date();

                    return (
                      <tr key={item.id} className="hover:bg-[#F5F7F8]/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#0B1320]">{item.user?.name}</div>
                          <div className="text-[11px] text-[#586570]">{item.user?.email}</div>
                        </td>
                        <td className="py-3 px-4 font-mono">
                          <span className="font-semibold text-[#0B1320]">
                            {item.user?.salespersonProfile?.employeeCode || 'N/A'}
                          </span>
                          <div className="text-[11px] text-[#586570]">{item.user?.phone}</div>
                        </td>
                        <td className="py-3 px-4 font-mono font-medium text-[#0B1320]">
                          <span className="px-2 py-0.5 rounded bg-gray-100 border border-gray-200 text-xs">
                            {item.displayHint || 'TRK-***-***'}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isLocked ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                              <Lock className="w-3 h-3 text-rose-600" />
                              Locked (5 Failed)
                            </span>
                          ) : item.status === 'ACTIVE' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#E6F4DD] text-[#2E6819] border border-[#B4E39C]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#2E6819]" />
                              Active
                            </span>
                          ) : item.status === 'EXPIRED' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                              Expired
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                              Revoked
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[#586570] whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-3 px-4 text-[#586570] whitespace-nowrap">
                          {item.expiresAt ? (
                            new Date(item.expiresAt).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })
                          ) : (
                            <span className="text-gray-400">Never</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[#586570] whitespace-nowrap">
                          {item.lastUsedAt ? (
                            new Date(item.lastUsedAt).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          ) : (
                            <span className="text-gray-400">Never</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {item.status === 'ACTIVE' && (
                            <button
                              onClick={() => setRevokeTarget(item)}
                              className="px-2.5 py-1 rounded text-xs font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50 transition-colors"
                            >
                              Revoke Code
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* GENERATE CODE MODAL */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl border border-[#CBD2D7] w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#CBD2D7] bg-[#F5F7F8]">
              <h3 className="text-base font-bold text-[#0B1320]">Generate Access Code</h3>
              <p className="text-xs text-[#586570]">Issue a secure, individual mobile access code</p>
            </div>

            <div className="p-6 space-y-4">
              {generateError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {generateError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0B1320] mb-1">
                  Select Salesperson <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full text-xs p-2.5 bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg focus:outline-none focus:border-[#081224]"
                >
                  <option value="">-- Choose Staff Member --</option>
                  {salespersons.map((sp) => (
                    <option key={sp.user.id} value={sp.user.id}>
                      {sp.user.name} ({sp.employeeCode || sp.user.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B1320] mb-1">
                  Validity Duration
                </label>
                <select
                  value={expiresInDays === undefined ? 'never' : expiresInDays}
                  onChange={(e) =>
                    setExpiresInDays(e.target.value === 'never' ? undefined : Number(e.target.value))
                  }
                  className="w-full text-xs p-2.5 bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg focus:outline-none focus:border-[#081224]"
                >
                  <option value="7">7 Days</option>
                  <option value="30">30 Days (Recommended)</option>
                  <option value="90">90 Days</option>
                  <option value="365">1 Year</option>
                  <option value="never">No Expiration</option>
                </select>
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 text-xs text-blue-800 rounded-lg flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
                <p>
                  Any previously active access code for this user will be revoked immediately upon generating a new one.
                </p>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-[#CBD2D7] bg-[#F5F7F8] flex justify-end gap-3">
              <button
                onClick={() => setShowGenerateModal(false)}
                className="px-4 py-2 text-xs font-semibold bg-white border border-[#CBD2D7] text-[#0B1320] rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-2 text-xs font-semibold bg-[#081224] text-white rounded-lg hover:bg-black disabled:opacity-50"
              >
                {generating ? 'Generating...' : 'Generate Code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ONE-TIME DELIVERY MODAL */}
      {oneTimeCodeData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl border border-[#CBD2D7] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95">
            <div className="px-6 py-4 border-b border-[#CBD2D7] bg-[#E6F4DD]">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-[#2E6819]" />
                <h3 className="text-base font-bold text-[#2E6819]">Access Code Generated Successfully</h3>
              </div>
              <p className="text-xs text-[#2E6819]/80 mt-0.5">
                Deliver this credential directly to {oneTimeCodeData.userName}
              </p>
            </div>

            <div className="p-6 space-y-5">
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-800">
                  <span className="font-bold block">One-Time Plaintext Delivery</span>
                  This access code is shown now and will <strong className="font-bold underline">never be displayed again</strong>. Plaintext codes are not stored on our servers. Copy it before closing this window.
                </div>
              </div>

              {/* Code Box */}
              <div className="text-center p-6 bg-[#F5F7F8] border border-[#CBD2D7] rounded-xl relative">
                <span className="text-xs uppercase font-semibold text-[#586570] tracking-wider block mb-1">
                  Access Code
                </span>
                <span className="text-3xl font-extrabold font-mono tracking-widest text-[#081224] select-all">
                  {oneTimeCodeData.code}
                </span>

                <div className="mt-4 flex items-center justify-center">
                  <button
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold bg-[#081224] text-white rounded-lg hover:bg-black transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-[#B4E39C]" />
                        <span>Copied to Clipboard!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy Access Code</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-[#586570] bg-gray-50 p-4 rounded-xl border border-gray-200">
                <p className="font-bold text-[#0B1320]">How the staff member logs in:</p>
                <p>1. Open the mobile app and choose <strong>"Access Code Login"</strong>.</p>
                <p>2. Enter Employee ID: <strong className="font-mono text-[#0B1320]">{oneTimeCodeData.employeeCode}</strong></p>
                <p>3. Enter the Access Code above: <strong className="font-mono text-[#0B1320]">{oneTimeCodeData.code}</strong></p>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-[#CBD2D7] bg-[#F5F7F8] flex justify-end">
              <button
                onClick={() => setOneTimeCodeData(null)}
                className="px-5 py-2 text-xs font-bold bg-[#081224] text-white rounded-lg hover:bg-black"
              >
                I Have Securely Saved the Code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REVOKE MODAL */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl border border-[#CBD2D7] w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#CBD2D7] bg-[#F5F7F8]">
              <h3 className="text-base font-bold text-rose-700">Revoke Access Code</h3>
              <p className="text-xs text-[#586570]">Staff: {revokeTarget.user?.name}</p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0B1320] mb-1">
                  Reason for Revocation (Optional)
                </label>
                <input
                  type="text"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g. Lost mobile device or role change"
                  className="w-full text-xs p-2.5 bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg focus:outline-none focus:border-[#081224]"
                />
              </div>

              <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800 rounded-lg">
                Revoking this code terminates all active mobile sessions for {revokeTarget.user?.name} immediately.
              </div>
            </div>

            <div className="px-6 py-3 border-t border-[#CBD2D7] bg-[#F5F7F8] flex justify-end gap-3">
              <button
                onClick={() => setRevokeTarget(null)}
                className="px-4 py-2 text-xs font-semibold bg-white border border-[#CBD2D7] text-[#0B1320] rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {revoking ? 'Revoking...' : 'Confirm Revocation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
