/**
 * "Quick access": with Remember me on, the sign-in name (email / phone / employee code, never a
 * password or access code) and the chosen method are kept on this device to prefill the form.
 * Session secrets live only in the httpOnly cookie, which scripts cannot read.
 */
const KEY = 'salesgrid:quick-access';

export interface QuickAccess {
  /** Company code (not secret): which company this device signs in to. */
  company: string;
  identifier: string;
  mode: 'PASSWORD' | 'ACCESS_CODE';
  remember: boolean;
}

export function readQuickAccess(): QuickAccess | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.identifier !== 'string' || (v.mode !== 'PASSWORD' && v.mode !== 'ACCESS_CODE')) return null;
    return { company: typeof v.company === 'string' ? v.company : '', identifier: v.identifier, mode: v.mode, remember: true };
  } catch {
    return null;
  }
}

export function saveQuickAccess(v: QuickAccess) {
  try {
    if (v.remember) window.localStorage.setItem(KEY, JSON.stringify({ company: v.company, identifier: v.identifier, mode: v.mode }));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: nothing is remembered */
  }
}

export function forgetQuickAccess() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
