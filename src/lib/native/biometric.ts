'use client';

import { isNativeApp } from './platform';

/**
 * Biometric unlock for the Android app. It is a device-level lock in front of an existing session:
 * the session itself stays in the httpOnly cookie and is still checked by the server on every
 * request. Nothing secret is stored; the preference only records that this user enabled the lock.
 */
const key = (userId: string) => `salesgrid.biometricLock.${userId}`;

async function plugins() {
  const [{ BiometricAuth }, { Preferences }] = await Promise.all([
    import('@aparajita/capacitor-biometric-auth'),
    import('@capacitor/preferences'),
  ]);
  return { BiometricAuth, Preferences };
}

export interface BiometricStatus {
  available: boolean;
  /** Human-readable reason when not available (no sensor, nothing enrolled, no screen lock…). */
  reason: string;
}

export async function biometricStatus(): Promise<BiometricStatus> {
  if (!isNativeApp()) return { available: false, reason: 'Only available in the Bharath Interior Decor Android app.' };
  try {
    const { BiometricAuth } = await plugins();
    const r = await BiometricAuth.checkBiometry();
    return { available: r.isAvailable, reason: r.isAvailable ? '' : r.reason || 'Biometric unlock is not set up on this device.' };
  } catch (e) {
    return { available: false, reason: (e as Error).message };
  }
}

export async function isBiometricLockEnabled(userId: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  const { Preferences } = await plugins();
  return (await Preferences.get({ key: key(userId) })).value === '1';
}

/** Shows the system prompt (fingerprint/face, or the device PIN as fallback). Throws on cancel/failure. */
export async function authenticateBiometric(reason = 'Unlock Bharath Interior Decor'): Promise<void> {
  const { BiometricAuth } = await plugins();
  await BiometricAuth.authenticate({
    reason,
    androidTitle: 'Unlock Bharath Interior Decor',
    androidSubtitle: reason,
    allowDeviceCredential: true,
    cancelTitle: 'Cancel',
  });
}

/** Enabling requires one successful authentication first, so a lock can't be set up by accident. */
export async function setBiometricLock(userId: string, enabled: boolean): Promise<void> {
  const { Preferences } = await plugins();
  if (enabled) {
    await authenticateBiometric('Confirm to turn on biometric unlock');
    await Preferences.set({ key: key(userId), value: '1' });
  } else {
    await Preferences.remove({ key: key(userId) });
  }
}

export async function clearBiometricLock(userId: string): Promise<void> {
  if (!isNativeApp()) return;
  const { Preferences } = await plugins();
  await Preferences.remove({ key: key(userId) });
}
