/**
 * What the admin console may truthfully say about a salesperson's location right now.
 * Combines two independent facts: when the last REAL, accepted fix arrived, and what the device
 * itself reported about its permission / GPS. Nothing is extrapolated: a person is never shown
 * as "moving" or "live" unless a fresh fix says so.
 */
export const LIVE_MAX_AGE_MINUTES = 5;

export type LiveState = 'live' | 'stale' | 'unavailable' | 'permission_denied' | 'gps_disabled' | 'off_duty';

export interface LiveStateInput {
  dutyStatus: string;
  lastFixAt?: Date | string | null;
  deviceState?: string | null;
  deviceStateAt?: Date | string | null;
  now?: Date;
}

export interface LiveStateResult {
  state: LiveState;
  label: string;
  /** Foreground-only: the phone reports while the app is open but not in the background. */
  backgroundLimited: boolean;
}

const ms = (d?: Date | string | null) => (d ? new Date(d).getTime() : null);

export function computeLiveState(input: LiveStateInput): LiveStateResult {
  const now = (input.now ?? new Date()).getTime();
  const lastFix = ms(input.lastFixAt);
  const deviceAt = ms(input.deviceStateAt);
  const backgroundLimited = input.deviceState === 'BACKGROUND_DENIED';

  if (input.dutyStatus !== 'ON_DUTY') return { state: 'off_duty', label: 'Off duty — tracking not expected', backgroundLimited: false };

  // A device-reported problem counts only while it is newer than the last fix: once a fix arrives
  // afterwards, the device has evidently recovered.
  const problemIsCurrent = deviceAt !== null && (lastFix === null || deviceAt >= lastFix);
  if (problemIsCurrent && input.deviceState === 'PERMISSION_DENIED') {
    return { state: 'permission_denied', label: 'Location permission denied on the phone', backgroundLimited };
  }
  if (problemIsCurrent && input.deviceState === 'GPS_DISABLED') {
    return { state: 'gps_disabled', label: 'Phone location services are switched off', backgroundLimited };
  }

  if (lastFix === null) return { state: 'unavailable', label: 'No location received yet', backgroundLimited };
  const ageMin = Math.max(0, Math.floor((now - lastFix) / 60000));
  if (ageMin <= LIVE_MAX_AGE_MINUTES) return { state: 'live', label: ageMin < 1 ? 'Live · just now' : `Live · ${ageMin} min ago`, backgroundLimited };
  return {
    state: 'stale',
    label: backgroundLimited ? `Stale · last fix ${formatAgo(ageMin)} (phone reports only while the app is open)` : `Stale · last fix ${formatAgo(ageMin)}`,
    backgroundLimited,
  };
}

function formatAgo(min: number): string {
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}
