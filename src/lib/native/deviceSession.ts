'use client';

import { forgetQuickAccess } from '@/lib/client/quickAccess';
import { clearBiometricLock } from './biometric';

/**
 * Local cleanup on sign-out. The session cookie itself is cleared by the server response.
 *  - always: this user's biometric-lock preference on this device;
 *  - "sign out everywhere": also the remembered sign-in name.
 */
export async function clearDeviceSession(userId: string | undefined, opts: { everywhere?: boolean } = {}) {
  if (opts.everywhere) forgetQuickAccess();
  if (userId) await clearBiometricLock(userId).catch(() => undefined);
}
