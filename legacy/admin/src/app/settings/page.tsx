'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import Button from '@/components/ui/Button';
import { Settings, Shield, Sliders, Check, Save } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function SettingsPage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'system' | 'roles'>('system');
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const fetchSettings = async () => {
    if (!token) return;
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/settings', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
        fetch('/api/settings/permissions', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      ]);
      setSettings(sRes.data || []);
      setPermissions(pRes.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [token]);

  const handleSettingChange = (key: string, value: string) => {
    setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setStatusMsg('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        setStatusMsg('System settings saved successfully!');
        setTimeout(() => setStatusMsg(''), 4000);
      }
    } catch (e: any) {
      alert(e.message || 'Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePermission = async (userId: string, permKey: string, currentValue: boolean) => {
    try {
      const updated = { [permKey]: !currentValue };
      await fetch(`/api/settings/permissions/${userId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      fetchSettings();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <AdminShell title="System Configuration">
      <div className="space-y-6 max-w-4xl">
        {/* Header Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Administration
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              ERP Settings & Security Roles
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Configure geofence tolerance, tracking frequencies, timezone policies, and role-based permissions.
            </p>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('system')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              activeTab === 'system'
                ? 'bg-[#081224] text-white border-[#081224]'
                : 'bg-white text-[#586570] border-[#CBD2D7] hover:bg-[#F3F5F6]'
            }`}
          >
            System Parameters
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              activeTab === 'roles'
                ? 'bg-[#081224] text-white border-[#081224]'
                : 'bg-white text-[#586570] border-[#CBD2D7] hover:bg-[#F3F5F6]'
            }`}
          >
            Manager & User Permissions
          </button>
        </div>

        {/* System Settings Form */}
        {activeTab === 'system' && (
          <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 space-y-6">
            {statusMsg && (
              <div className="p-3 bg-[#E6F4DD] border border-[#B4E39C] text-[#2E6819] text-xs font-medium rounded-lg flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>{statusMsg}</span>
              </div>
            )}

            <div className="divide-y divide-[#E2E7EC] text-xs">
              {settings.map((s) => (
                <div key={s.key} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="max-w-md">
                    <p className="font-semibold text-[#0B1320] font-mono text-[13px]">{s.key}</p>
                    <p className="text-[#586570] mt-0.5">{s.description || 'System policy threshold parameter.'}</p>
                  </div>

                  <div className="w-full sm:w-64">
                    {s.value === 'true' || s.value === 'false' ? (
                      <select
                        value={s.value}
                        onChange={(e) => handleSettingChange(s.key, e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-[#CBD2D7] rounded-lg text-xs font-semibold text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
                      >
                        <option value="true">Enabled (true)</option>
                        <option value="false">Disabled (false)</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={s.value}
                        onChange={(e) => handleSettingChange(s.key, e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-[#CBD2D7] rounded-lg text-xs text-[#0B1320] font-semibold focus:ring-1 focus:ring-[#081224] focus:outline-none"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-[#E2E7EC] flex justify-end">
              <Button
                variant="primary"
                onClick={handleSaveSettings}
                disabled={saving}
                icon={<Save className="w-4 h-4" />}
              >
                {saving ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
          </div>
        )}

        {/* Roles & Permissions */}
        {activeTab === 'roles' && (
          <div className="bg-white border border-[#CBD2D7] rounded-xl p-6">
            <h3 className="text-sm font-bold text-[#0B1320] mb-1">Granular Role Permissions</h3>
            <p className="text-xs text-[#586570] mb-6">
              Configure access control permissions for managerial and administrative staff.
            </p>

            <div className="space-y-4">
              {permissions.map((p) => (
                <div key={p.id} className="p-4 rounded-xl border border-[#CBD2D7] bg-[#F3F5F6] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-[#0B1320] text-sm">{p.userName}</p>
                      <p className="text-xs text-[#586570]">{p.email} • Role: {p.role}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-2 border-t border-[#E2E7EC]">
                    {Object.entries(p.permissions || {}).map(([perm, val]) => (
                      <label key={perm} className="flex items-center gap-2 cursor-pointer text-[#0B1320] select-none">
                        <input
                          type="checkbox"
                          checked={Boolean(val)}
                          onChange={() => handleTogglePermission(p.userId, perm, Boolean(val))}
                          className="rounded text-[#081224] focus:ring-[#081224]"
                        />
                        <span className="capitalize">{perm.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
