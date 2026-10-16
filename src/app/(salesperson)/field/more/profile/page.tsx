'use client';

import React, { useState } from 'react';
import BackHeader from '@/components/sales/BackHeader';
import { Card, Notice, PrimaryButton, SecondaryButton, Sheet } from '@/components/sales/mobile';
import { useSession } from '@/components/shared/SessionProvider';
import { useField, clearFieldData } from '@/features/field/FieldProvider';

export default function Profile() {
  const { user, logout, logoutEverywhere } = useSession();
  const { outbox, dutyStatus } = useField();
  const [confirm, setConfirm] = useState(false);
  const [everywhere, setEverywhere] = useState(false);
  const [error, setError] = useState('');

  const signOut = async () => {
    setError('');
    if (everywhere) {
      try {
        // Server must confirm before local data is cleared.
        await logoutEverywhere();
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      clearFieldData(user!.id);
      return;
    }
    clearFieldData(user!.id);
    await logout();
  };

  return (
    <div className="space-y-3">
      <BackHeader title="Profile" />
      <Card className="text-center">
        <div className="w-14 h-14 rounded-full bg-[#081224] text-[#B4E39C] font-bold flex items-center justify-center mx-auto">{user?.name?.slice(0, 2).toUpperCase()}</div>
        <p className="text-base font-bold mt-2">{user?.name}</p>
        <p className="text-xs text-[#586570]">{user?.employeeCode} · {user?.territory}</p>
        <p className="text-xs text-[#586570]">{user?.phone} · {user?.email}</p>
      </Card>
      <Card>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#80909D]">Location privacy</p>
        <ul className="text-xs text-[#0B1320] mt-2 space-y-1.5 list-disc pl-4">
          <li>Location is recorded only while you are on duty and SalesGrid is open on this device.</li>
          <li>Tracking stops immediately when you tap End Day or sign out.</li>
          <li>Locations are used for route distance, visit verification and territory operations.</li>
        </ul>
      </Card>
      <SecondaryButton className="w-full text-[#991B1B]" onClick={() => setConfirm(true)}>Sign out</SecondaryButton>

      <Sheet
        open={confirm}
        title="Sign out?"
        onClose={() => setConfirm(false)}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => setConfirm(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={signOut}>Sign out</PrimaryButton>
          </div>
        }
      >
        <div className="space-y-2 text-sm">
          {dutyStatus === 'ON_DUTY' && <Notice tone="warning">You are still on duty. Location tracking stops when you sign out; your shift stays open until you end the day.</Notice>}
          {outbox.length > 0 && <Notice tone="error">{outbox.length} record(s) have not synced yet and will be removed from this device if you sign out now. Sync first from More → Offline sync queue.</Notice>}
          <p>Signing out clears your cached data from this device.</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
            <span>Also sign out on every other device (use this if a phone was lost or shared)</span>
          </label>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Sheet>
    </div>
  );
}
